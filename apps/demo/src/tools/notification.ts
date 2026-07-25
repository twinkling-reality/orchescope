import { noteFault, type RequestContext, recordEffect } from '../context.ts';
import { DemoFailure, sleep, sleepBounded, withDeadline } from '../failures.ts';
import type { FaultDecision } from '../faults.ts';
import { hashText, hexOf, mix64 } from '../random.ts';
import { ATTR, type Span, sourceFile } from '../telemetry.ts';
import { runTool, TOOL_DEADLINE_MS, toolFault } from './tool-span.ts';

/**
 * INTENTIONAL CONTRAST 3: the same retry shape as the refund tool, made safe by one thing.
 *
 * Every delivery carries an idempotency key derived from the conversation and the order, and the provider
 * keeps the keys it has already accepted. A retry after a lost answer therefore reports the first delivery
 * instead of sending a second message, and the trace can prove it: both attempts carry the same key.
 */

const site = sourceFile('apps/demo/src/tools/notification.ts');

export const SEND_NOTIFICATION = 'send_notification';
const MAX_NOTIFICATION_ATTEMPTS = 2;

/** Accepted keys, as a provider's deduplication window would hold them. */
const accepted = new Map<string, string>();

export type NotificationRequest = {
  readonly conversationId: string;
  readonly orderId: string;
  readonly channel: string;
  readonly message: string;
};

export const notificationKey = (request: NotificationRequest): string =>
  `ntf-${request.conversationId}-${request.orderId}`;

const receiptFor = (key: string): string => `ntf_${hexOf(mix64(hashText(key)), 8)}`;

const deliver = async (
  context: RequestContext,
  span: Span,
  request: NotificationRequest,
  attempt: number,
  fault: FaultDecision | undefined,
): Promise<string> => {
  const key = notificationKey(request);
  const target = `notifications/${request.channel}`;
  const already = accepted.get(key);
  if (already !== undefined) {
    recordEffect(context, span, {
      kind: 'notification',
      target,
      idempotencyKey: key,
      outcome: 'succeeded',
    });
    return already;
  }
  const receipt = receiptFor(key);
  if (fault?.kind === 'tool_timeout') {
    // The provider accepted the message and the answer was lost. The key is what makes attempt two safe.
    accepted.set(key, receipt);
    recordEffect(context, span, {
      kind: 'notification',
      target,
      idempotencyKey: key,
      outcome: 'unknown',
    });
    await sleepBounded(Math.max(fault.delayMs, TOOL_DEADLINE_MS * 2));
    return receipt;
  }
  if (fault !== undefined) {
    recordEffect(context, span, {
      kind: 'notification',
      target,
      idempotencyKey: key,
      outcome: 'failed',
    });
    throw new DemoFailure('failed', `the notification provider rejected attempt ${attempt}`);
  }
  await sleep(0);
  accepted.set(key, receipt);
  recordEffect(context, span, {
    kind: 'notification',
    target,
    idempotencyKey: key,
    outcome: 'succeeded',
  });
  return receipt;
};

const attemptDelivery = (
  context: RequestContext,
  parent: Span,
  request: NotificationRequest,
  attempt: number,
): Promise<string> =>
  runTool(
    context,
    parent,
    {
      toolName: SEND_NOTIFICATION,
      site: site('attemptDelivery', 99),
      attributes: {
        [ATTR.retryAttempt]: attempt,
        [ATTR.sideEffectKey]: notificationKey(request),
      },
    },
    async (span) => {
      const fault = toolFault(context, SEND_NOTIFICATION, attempt);
      if (fault !== undefined) noteFault(span, fault);
      return await withDeadline(
        deliver(context, span, request, attempt, fault),
        TOOL_DEADLINE_MS,
        `${SEND_NOTIFICATION} exceeded its ${TOOL_DEADLINE_MS}ms deadline`,
      );
    },
  );

export const sendNotification = async (
  context: RequestContext,
  parent: Span,
  request: NotificationRequest,
): Promise<string> => {
  let failure = new DemoFailure('failed', 'the notification was never attempted');
  for (let attempt = 1; attempt <= MAX_NOTIFICATION_ATTEMPTS; attempt += 1) {
    try {
      return await attemptDelivery(context, parent, request, attempt);
    } catch (error) {
      if (!(error instanceof DemoFailure)) throw error;
      failure = error;
      await sleep(8 * attempt);
    }
  }
  throw failure;
};
