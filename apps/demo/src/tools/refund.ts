import { noteFault, type RequestContext, recordEffect } from '../context.ts';
import { DemoFailure, sleep, sleepBounded, withDeadline } from '../failures.ts';
import type { FaultDecision } from '../faults.ts';
import { hashText, hexOf, mix64, unitOf } from '../random.ts';
import { ATTR, SPAN_KIND_INTERNAL, type Span, sourceFile } from '../telemetry.ts';
import { runTool, TOOL_DEADLINE_MS, toolFault } from './tool-span.ts';

/**
 * The refund tool: one deliberate weakness and one deliberate strength in the same file.
 *
 * GOOD ARCHITECTURE 8a: the effect cannot be reached without passing the approval boundary. The check runs
 * inside this module and emits an `approval` span with `orchescope.approval.granted`, so no caller can skip
 * it by forgetting to ask.
 *
 * INTENTIONAL ISSUE 2: the gateway call is retried without an idempotency key. The gateway records the
 * effect before it answers, so a failure followed by a retry produces two refunds with the same kind and
 * target and no key to deduplicate them. This is what an unsafe retry looks like in a trace.
 */

const site = sourceFile('apps/demo/src/tools/refund.ts');

export const ISSUE_REFUND = 'issue_refund';
export const AUTO_APPROVAL_LIMIT = 5_000;
const MAX_REFUND_ATTEMPTS = 3;
const RETRY_BACKOFF_MS: readonly number[] = [10, 20];
/** One first attempt in five is rejected by the gateway. Seeds that reject are listed in the README. */
const GATEWAY_FAILURE_RATE = 0.2;

export type RefundApproval = 'policy' | 'human' | 'none';

export type RefundRequest = {
  readonly orderId: string;
  readonly accountId: string;
  readonly amount: number;
  readonly currency: string;
  readonly approval: RefundApproval;
};

export type RefundOutcome = {
  readonly status: 'refunded' | 'refused';
  readonly attempts: number;
  readonly reference: string;
};

const approvalHolds = (request: RefundRequest): boolean =>
  request.approval === 'human' ||
  (request.approval === 'policy' && request.amount <= AUTO_APPROVAL_LIMIT);

const checkApproval = (
  context: RequestContext,
  parent: Span,
  request: RefundRequest,
): Promise<boolean> =>
  context.trace.run(
    {
      name: `approval ${ISSUE_REFUND}`,
      kind: SPAN_KIND_INTERNAL,
      site: site('checkApproval', 58),
      attributes: {
        [ATTR.component]: 'refund-approval',
        [ATTR.conversationId]: context.conversationId,
      },
    },
    parent,
    async (span) => {
      await sleep(0);
      const granted = approvalHolds(request);
      span.set(ATTR.approvalGranted, granted);
      return granted;
    },
  );

const referenceFor = (request: RefundRequest, attempt: number): string =>
  `rf_${hexOf(mix64(hashText(request.orderId) + BigInt(attempt)), 8)}`;

const gatewayRejects = (
  context: RequestContext,
  request: RefundRequest,
  attempt: number,
): boolean =>
  attempt === 1 &&
  unitOf('refund-gateway-1', context.config.seed, request.orderId) < GATEWAY_FAILURE_RATE;

const callGateway = async (
  context: RequestContext,
  span: Span,
  request: RefundRequest,
  attempt: number,
  fault: FaultDecision | undefined,
): Promise<string> => {
  const target = `payments/order-${request.orderId}`;
  const reference = referenceFor(request, attempt);
  if (fault?.kind === 'tool_timeout') {
    // The gateway took the request. Whether it committed the refund is unknown to this process, and the
    // retry below has no key with which to ask.
    recordEffect(context, span, { kind: 'refund', target, outcome: 'unknown' });
    await sleepBounded(Math.max(fault.delayMs, TOOL_DEADLINE_MS * 2));
    return reference;
  }
  if (fault !== undefined || gatewayRejects(context, request, attempt)) {
    recordEffect(context, span, { kind: 'refund', target, outcome: 'failed' });
    throw new DemoFailure('failed', `the payment gateway did not confirm refund ${reference}`);
  }
  await sleep(0);
  recordEffect(context, span, { kind: 'refund', target, outcome: 'succeeded' });
  return reference;
};

const attemptRefund = (
  context: RequestContext,
  parent: Span,
  request: RefundRequest,
  attempt: number,
): Promise<string> =>
  runTool(
    context,
    parent,
    {
      toolName: ISSUE_REFUND,
      site: site('attemptRefund', 120),
      attributes: { [ATTR.retryAttempt]: attempt },
    },
    async (span) => {
      const fault = toolFault(context, ISSUE_REFUND, attempt);
      if (fault !== undefined) noteFault(span, fault);
      return await withDeadline(
        callGateway(context, span, request, attempt, fault),
        TOOL_DEADLINE_MS,
        `${ISSUE_REFUND} exceeded its ${TOOL_DEADLINE_MS}ms deadline`,
      );
    },
  );

export const issueRefund = async (
  context: RequestContext,
  parent: Span,
  request: RefundRequest,
): Promise<RefundOutcome> => {
  const granted = await checkApproval(context, parent, request);
  if (!granted) return { status: 'refused', attempts: 0, reference: '' };

  let failure = new DemoFailure('failed', 'the refund was never attempted');
  for (let attempt = 1; attempt <= MAX_REFUND_ATTEMPTS; attempt += 1) {
    try {
      const reference = await attemptRefund(context, parent, request, attempt);
      return { status: 'refunded', attempts: attempt, reference };
    } catch (error) {
      if (!(error instanceof DemoFailure)) throw error;
      failure = error;
      await sleep(RETRY_BACKOFF_MS[attempt - 1] ?? 20);
    }
  }
  throw failure;
};
