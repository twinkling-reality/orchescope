import { type RequestContext, recordEffect } from '../context.ts';
import { sleep } from '../failures.ts';
import { hashText, hexOf, mix64 } from '../random.ts';
import { ATTR, type Span, sourceFile } from '../telemetry.ts';
import { runTool } from './tool-span.ts';

/**
 * INTENTIONAL ISSUE 4: a configured tool that the default scenario never calls.
 *
 * The orchestrator registers this tool and reaches it only when a refund exceeds the automatic approval
 * limit or the request mentions legal action. The default request is a 129.99 refund on order 1234, so the
 * tool is present in the configuration and absent from every default trace. Run with
 * `ORCHESCOPE_INPUT='Refund order 9001'` to exercise it.
 */

const site = sourceFile('apps/demo/src/tools/escalation.ts');

export const ESCALATE_TO_HUMAN = 'escalate_to_human';
const HUMAN_APPROVAL_LIMIT = 25_000;

export type EscalationResult = {
  readonly approved: boolean;
  readonly ticket: string;
  readonly note: string;
};

export const escalateToHuman = (
  context: RequestContext,
  parent: Span,
  reason: string,
  amount: number,
): Promise<EscalationResult> =>
  runTool(
    context,
    parent,
    {
      toolName: ESCALATE_TO_HUMAN,
      site: site('escalateToHuman', 38),
      attributes: { [ATTR.userIntervention]: true },
    },
    async (span) => {
      await sleep(0);
      const ticket = `esc_${hexOf(mix64(hashText(`${context.conversationId}:${reason}`)), 8)}`;
      const approved = amount <= HUMAN_APPROVAL_LIMIT;
      context.totals.userInterventions += 1;
      recordEffect(context, span, {
        kind: 'escalation',
        target: 'support/human-queue',
        idempotencyKey: `esc-${context.conversationId}`,
        outcome: 'succeeded',
      });
      return { approved, ticket, note: `escalated to a human agent: ${reason}` };
    },
  );
