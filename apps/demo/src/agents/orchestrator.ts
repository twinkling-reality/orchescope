import { recordAudit } from '../audit.ts';
import { type Conversation, conversationOf, type RequestContext } from '../context.ts';
import { DemoFailure } from '../failures.ts';
import { callModel } from '../model.ts';
import { ATTR, SPAN_KIND_INTERNAL, type Span, sourceFile } from '../telemetry.ts';
import { lookupAccount } from '../tools/account.ts';
import { checkInventory } from '../tools/inventory.ts';
import { sendNotification } from '../tools/notification.ts';
import { recordUsage } from '../tools/metering.ts';
import { searchPolicies } from '../tools/policies.ts';
import type { RefundOutcome } from '../tools/refund.ts';
import { type AgentTopology, planTopology } from './definitions.ts';
import { amountOf, outcomeSentence, settle } from './settlement.ts';
import { analyseInline, delegate, type WorkerFinding } from './workers.ts';

/**
 * The orchestrator: one support request from the customer's sentence to the answer.
 *
 * The root span of a request is this agent's span, and it carries the task outcome, so a target with no
 * result file at all could still be evaluated from the trace alone.
 */

const site = sourceFile('apps/demo/src/agents/orchestrator.ts');

const DEFAULT_DECISION = 'refund';
const DEFAULT_ORDER_ID = '1234';
const MAX_OUTPUT_CHARS = 2_000;

export type RequestResult = {
  readonly success: boolean;
  readonly output: string;
};

const orderIdOf = (input: string): string => /\b(\d{3,10})\b/.exec(input)?.[1] ?? DEFAULT_ORDER_ID;

const planWork = async (
  context: RequestContext,
  span: Span,
  topology: AgentTopology,
  conversation: Conversation,
): Promise<string> => {
  const definition = topology.orchestrator;
  const prompt = [
    `prompt-version: ${context.config.promptVersion}`,
    definition.instructions,
    `Registered tools: ${definition.tools.join(', ')}.`,
    `Handoff targets: ${definition.handoffs.length === 0 ? 'none' : definition.handoffs.join(', ')}.`,
    `Customer request: ${conversation.request}`,
    'Answer with a JSON object holding decision, steps and tone.',
  ].join('\n');
  context.totals.loopIterations += 1;
  try {
    const reply = await callModel(context, span, definition.name, {
      purpose: 'plan',
      prompt,
      structured: true,
    });
    conversation.messages.push({ role: 'assistant', text: reply.text });
    const decision = reply.structured?.['decision'];
    if (decision !== undefined) return decision;
    context.totals.loopIterations += 1;
    conversation.findings.push('the plan was not readable JSON, so the default plan was used');
    return DEFAULT_DECISION;
  } catch (error) {
    if (!(error instanceof DemoFailure)) throw error;
    // A model that cannot answer degrades to the default plan. The request continues.
    context.totals.loopIterations += 1;
    conversation.findings.push(
      `the planner was unavailable (${error.kind}), the default plan was used`,
    );
    return DEFAULT_DECISION;
  }
};

const gather = async (
  context: RequestContext,
  span: Span,
  conversation: Conversation,
  orderId: string,
  decision: string,
): Promise<void> => {
  // INTENTIONAL ISSUE 1: neither call depends on the other and they are awaited one after the other, so
  // the request pays for both round trips in sequence.
  const account = await lookupAccount(context, span, orderId);
  // INTENTIONAL ISSUE 9: there is no fallback around this call. Under a `tool_timeout` fault on
  // `check_inventory` the whole request fails, where answering with the account information alone would
  // have served the customer.
  const inventory = await checkInventory(context, span, orderId);
  conversation.account = account;
  conversation.inventory = inventory;
  if (!account.complete) {
    conversation.findings.push(
      'the account record was incomplete, the default refund amount was used',
    );
  }
  if (!inventory.complete) {
    conversation.findings.push('the inventory record was incomplete, restock time is unknown');
  }

  const policies = await searchPolicies(
    context,
    span,
    `${decision} policy for order ${orderId}: refund window, approval limit, notification`,
  );
  conversation.policies = policies.documents;
  if (policies.documents.length === 0) {
    conversation.findings.push(
      'the policy store returned nothing, the standard refund window was assumed',
    );
  }
  if (policies.injectionDetected) {
    // Retrieved text asked for a refund without approval. It is data, it is not followed, and the request
    // records that nothing was violated.
    conversation.findings.push('a retrieved document contained an instruction, which was ignored');
    span.set(ATTR.policyViolation, false);
  }
  conversation.messages.push({
    role: 'assistant',
    text: `collected account ${account.accountId} and ${policies.documents.length} policy documents`,
  });
};

const finish = async (
  context: RequestContext,
  span: Span,
  conversation: Conversation,
  findings: readonly WorkerFinding[],
  refund: RefundOutcome,
  orderId: string,
): Promise<string> => {
  const { amount, currency } = amountOf(conversation);
  if (refund.status === 'refunded') {
    await sendNotification(context, span, {
      conversationId: context.conversationId,
      orderId,
      channel: 'email',
      message: `Refund ${refund.reference} for order ${orderId} is on its way.`,
    });
  }
  await recordAudit(context, span, {
    action: refund.status === 'refunded' ? 'refund.issued' : 'refund.refused',
    subject: `order-${orderId}`,
    outcome: refund.status === 'refunded' ? 'succeeded' : 'failed',
  });
  await context.memory.remember(
    span,
    `conversation:${context.conversationId}`,
    `${refund.status} ${amount} ${currency}`,
  );

  const reply = await callModel(context, span, 'orchestrator', {
    purpose: 'answer',
    prompt: [
      `Customer request: ${conversation.request}`,
      `Refund outcome: ${refund.status} after ${refund.attempts} attempt(s).`,
      ...findings.map((finding) => `- ${finding.agent}: ${finding.summary}`),
      ...conversation.findings.map((note) => `- note: ${note}`),
      'Answer the customer in one sentence.',
    ].join('\n'),
    structured: false,
  });
  context.totals.loopIterations += 1;
  const notes =
    conversation.findings.length === 0 ? '' : ` Notes: ${conversation.findings.join('; ')}.`;
  return `${reply.text} ${outcomeSentence(refund, amount, currency)} ${findings.length} worker finding(s).${notes}`.slice(
    0,
    MAX_OUTPUT_CHARS,
  );
};

const orchestrate = async (
  context: RequestContext,
  span: Span,
  topology: AgentTopology,
): Promise<string> => {
  const conversation = conversationOf(context);
  const orderId = orderIdOf(context.config.input);
  conversation.messages.push({ role: 'system', text: topology.orchestrator.instructions });
  const history = await context.memory.recall(span, `conversation:${context.conversationId}`);
  if (history.length > 0) conversation.findings.push(`recalled ${history.length} earlier note(s)`);

  const decision = await planWork(context, span, topology, conversation);
  await gather(context, span, conversation, orderId, decision);
  const findings =
    topology.steps.length === 0
      ? await analyseInline(context, span, conversation)
      : await delegate(context, span, topology.steps, conversation);
  for (const finding of findings) {
    conversation.messages.push({ role: 'assistant', text: finding.summary });
  }
  const refund = await settle(context, span, conversation, orderId);
  // Reported on every run, and discoverable from no source file: see INTENTIONAL ISSUE 10.
  await recordUsage(context, span, conversation.messages.length);
  return await finish(context, span, conversation, findings, refund, orderId);
};

export const runRequest = async (context: RequestContext): Promise<RequestResult> => {
  const topology = planTopology(context.config);
  const span = context.trace.start(
    {
      name: `invoke_agent ${topology.orchestrator.name}`,
      kind: SPAN_KIND_INTERNAL,
      site: site('runRequest', 200),
      attributes: {
        [ATTR.operationName]: 'invoke_agent',
        [ATTR.agentName]: topology.orchestrator.name,
        [ATTR.conversationId]: context.conversationId,
        [ATTR.workflowName]: 'support-desk',
        [ATTR.repositoryName]: 'orchescope',
      },
    },
    undefined,
  );
  try {
    const output = await orchestrate(context, span, topology);
    span.set(ATTR.taskSuccess, true);
    span.set(ATTR.taskOutput, output);
    span.set(ATTR.policyViolation, context.totals.policyViolations > 0);
    span.set(ATTR.userIntervention, context.totals.userInterventions > 0);
    span.end('ok');
    return { success: true, output };
  } catch (error) {
    // An injected fault must never leave the process with an unhandled rejection: the request reports
    // failure and the run continues to its result file.
    const message = error instanceof Error ? error.message : 'the request failed';
    span.set(ATTR.taskSuccess, false);
    span.set(ATTR.taskOutput, message);
    span.end('error', message);
    return { success: false, output: `the request could not be completed: ${message}` };
  }
};
