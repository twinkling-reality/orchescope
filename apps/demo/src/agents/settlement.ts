import type { Conversation, RequestContext } from '../context.ts';
import { QUEUE_NAME } from '../queue.ts';
import { ATTR, SPAN_KIND_INTERNAL, type Span, sourceFile } from '../telemetry.ts';
import { escalateToHuman } from '../tools/escalation.ts';
import {
  AUTO_APPROVAL_LIMIT,
  issueRefund,
  type RefundApproval,
  type RefundOutcome,
} from '../tools/refund.ts';

/**
 * Settlement: deciding who may approve the refund, queueing it and reporting the result.
 *
 * The refund is not executed inline. It is submitted to the refund queue, the wait appears as a
 * `queue_wait` span, and the approval boundary and the gateway attempts are children of that span.
 */

const site = sourceFile('apps/demo/src/agents/settlement.ts');

const DEFAULT_REFUND_AMOUNT = 49.99;
const MAX_OPEN_TICKETS = 5;
const LEGAL_HINT = /legal|lawyer|court/i;

export const amountOf = (conversation: Conversation): { amount: number; currency: string } => {
  const account = conversation.account;
  return account?.complete === true
    ? { amount: account.refundAmount, currency: account.currency }
    : { amount: DEFAULT_REFUND_AMOUNT, currency: 'USD' };
};

/**
 * The only route to `escalate_to_human`. None of these conditions holds for the default request, which is
 * what makes the tool configured and never called (issue 4).
 */
const needsHumanDecision = (
  context: RequestContext,
  conversation: Conversation,
  amount: number,
): boolean =>
  amount > AUTO_APPROVAL_LIMIT ||
  (conversation.account?.openTickets ?? 0) > MAX_OPEN_TICKETS ||
  LEGAL_HINT.test(context.config.input);

export const settle = async (
  context: RequestContext,
  span: Span,
  conversation: Conversation,
  orderId: string,
): Promise<RefundOutcome> => {
  const account = conversation.account;
  const { amount, currency } = amountOf(conversation);
  let approval: RefundApproval = 'policy';
  if (needsHumanDecision(context, conversation, amount)) {
    const escalation = await escalateToHuman(
      context,
      span,
      `a refund of ${amount} ${currency} needs a human decision`,
      amount,
    );
    approval = escalation.approved ? 'human' : 'none';
    conversation.findings.push(escalation.note);
  }

  const request = {
    orderId,
    accountId: account?.accountId ?? 'acct_unknown',
    amount,
    currency,
    approval,
  };
  return await context.queue.submit(`${context.conversationId}:${orderId}`, (slot) =>
    context.trace.run(
      {
        name: `queue_wait ${QUEUE_NAME}`,
        kind: SPAN_KIND_INTERNAL,
        site: site('settle', 77),
        attributes: { [ATTR.component]: QUEUE_NAME, [ATTR.queueWaitMs]: slot.waitMs },
      },
      span,
      async (queueSpan) => {
        if (slot.injectedFault !== undefined) queueSpan.set(ATTR.faultInjected, slot.injectedFault);
        return await issueRefund(context, queueSpan, request);
      },
    ),
  );
};

export const outcomeSentence = (refund: RefundOutcome, amount: number, currency: string): string =>
  refund.status === 'refunded'
    ? `Refund ${refund.reference} of ${amount} ${currency} was issued on attempt ${refund.attempts}.`
    : `The refund of ${amount} ${currency} was not issued: the approval boundary refused it.`;
