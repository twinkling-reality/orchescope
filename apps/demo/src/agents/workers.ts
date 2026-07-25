import { type Conversation, noteFault, type RequestContext } from '../context.ts';
import { DemoFailure } from '../failures.ts';
import { callModel } from '../model.ts';
import { ATTR, SPAN_KIND_INTERNAL, type Span, sourceFile } from '../telemetry.ts';
import type { AgentDefinition, DelegationStep, WorkerField } from './definitions.ts';

/**
 * The worker tier and the coordinator tier above it.
 *
 * A worker reads exactly one field of the conversation. The prompt it receives contains the entire
 * conversation anyway: see `workerPrompt`, which is intentional issue 7. Its cost is real and visible,
 * because the token counts on the model spans are computed from the prompt that was actually sent.
 *
 * A `worker_unavailable` fault is handled by the caller as a degraded finding rather than a failed request,
 * which is the opposite of how the orchestrator handles a `check_inventory` timeout (issue 9).
 */

const site = sourceFile('apps/demo/src/agents/workers.ts');

export type WorkerFinding = {
  readonly agent: string;
  readonly summary: string;
  readonly degraded: boolean;
};

type NextStep = (span: Span) => Promise<readonly WorkerFinding[]>;

const agentAttributes = (context: RequestContext, name: string) => ({
  [ATTR.operationName]: 'invoke_agent',
  [ATTR.agentName]: name,
  [ATTR.conversationId]: context.conversationId,
});

const fieldValue = (field: WorkerField, conversation: Conversation): string => {
  const account = conversation.account;
  const inventory = conversation.inventory;
  switch (field) {
    case 'account':
      return account === undefined
        ? 'no account record'
        : `${account.accountId} tier=${account.tier} openTickets=${account.openTickets}`;
    case 'inventory':
      return inventory === undefined
        ? 'no inventory record'
        : `${inventory.sku} onHand=${inventory.onHand}`;
    case 'shipping':
      return inventory === undefined
        ? 'no inventory record'
        : `${inventory.warehouse} restockDays=${inventory.restockDays}`;
    case 'billing':
      return account === undefined
        ? 'no account record'
        : `${account.refundAmount} ${account.currency}`;
    default:
      return conversation.request;
  }
};

/**
 * INTENTIONAL ISSUE 7: the full conversation, including every retrieved policy document and the whole
 * transcript, is serialised into every worker prompt even though the worker reads one field of it.
 */
const workerPrompt = (definition: AgentDefinition, conversation: Conversation): string =>
  [
    definition.instructions,
    `The only field you may use is "${definition.field}".`,
    'Full conversation state, passed verbatim:',
    JSON.stringify(conversation),
  ].join('\n');

const coordinatorPrompt = (
  definition: AgentDefinition,
  findings: readonly WorkerFinding[],
): string =>
  [
    definition.instructions,
    'Findings from the workers assigned to you:',
    ...findings.map((finding) => `- ${finding.agent}: ${finding.summary}`),
  ].join('\n');

const runWorker = (
  context: RequestContext,
  parent: Span,
  definition: AgentDefinition,
  conversation: Conversation,
  next: NextStep | undefined,
): Promise<readonly WorkerFinding[]> =>
  context.trace.run(
    {
      name: `invoke_agent ${definition.name}`,
      kind: SPAN_KIND_INTERNAL,
      site: site('runWorker', 92),
      attributes: agentAttributes(context, definition.name),
    },
    parent,
    async (span) => {
      const unavailable = context.faults.decide('worker_unavailable', definition.name, 1);
      if (unavailable !== undefined) {
        noteFault(span, unavailable);
        throw new DemoFailure('unavailable', `${definition.name} did not accept the handoff`);
      }
      const reply = await callModel(context, span, definition.name, {
        purpose: 'delegate',
        prompt: workerPrompt(definition, conversation),
        structured: false,
      });
      const summary = `${reply.text} [${definition.field}=${fieldValue(definition.field, conversation)}]`;
      await context.memory.remember(span, `worker:${definition.name}`, summary);
      const nested = next === undefined ? [] : await next(span);
      return [{ agent: definition.name, summary, degraded: false }, ...nested];
    },
  );

const chainWorkers = (
  context: RequestContext,
  parent: Span,
  agents: readonly AgentDefinition[],
  conversation: Conversation,
): Promise<readonly WorkerFinding[]> => {
  const [head, ...rest] = agents;
  if (head === undefined) return Promise.resolve([]);
  return runWorker(
    context,
    parent,
    head,
    conversation,
    rest.length === 0 ? undefined : (span) => chainWorkers(context, span, rest, conversation),
  );
};

const fanOutWorkers = async (
  context: RequestContext,
  parent: Span,
  agents: readonly AgentDefinition[],
  conversation: Conversation,
): Promise<readonly WorkerFinding[]> => {
  if (context.config.topology === 'chain')
    return await chainWorkers(context, parent, agents, conversation);
  const batches = await Promise.all(
    agents.map((agent) => runWorker(context, parent, agent, conversation, undefined)),
  );
  return batches.flat();
};

const runCoordinator = (
  context: RequestContext,
  parent: Span,
  step: DelegationStep,
  conversation: Conversation,
  next: NextStep | undefined,
): Promise<readonly WorkerFinding[]> =>
  context.trace.run(
    {
      name: `invoke_agent ${step.agent.name}`,
      kind: SPAN_KIND_INTERNAL,
      site: site('runCoordinator', 156),
      attributes: agentAttributes(context, step.agent.name),
    },
    parent,
    async (span) => {
      const findings = await fanOutWorkers(context, span, step.assigned, conversation);
      const reply = await callModel(context, span, step.agent.name, {
        purpose: 'aggregate',
        prompt: coordinatorPrompt(step.agent, findings),
        structured: false,
      });
      await context.memory.remember(span, `coordinator:${step.agent.name}`, reply.text);
      const nested = next === undefined ? [] : await next(span);
      return [
        ...findings,
        {
          agent: step.agent.name,
          summary: reply.text,
          degraded: findings.some((finding) => finding.degraded),
        },
        ...nested,
      ];
    },
  );

const runStep = (
  context: RequestContext,
  parent: Span,
  step: DelegationStep,
  conversation: Conversation,
  next: NextStep | undefined,
): Promise<readonly WorkerFinding[]> =>
  step.agent.role === 'coordinator'
    ? runCoordinator(context, parent, step, conversation, next)
    : runWorker(context, parent, step.agent, conversation, next);

const runSafely = async (
  context: RequestContext,
  parent: Span,
  step: DelegationStep,
  conversation: Conversation,
  next: NextStep | undefined,
): Promise<readonly WorkerFinding[]> => {
  try {
    return await runStep(context, parent, step, conversation, next);
  } catch (error) {
    if (!(error instanceof DemoFailure)) throw error;
    return [{ agent: step.agent.name, summary: `unavailable: ${error.message}`, degraded: true }];
  }
};

const chainSteps = (
  context: RequestContext,
  parent: Span,
  steps: readonly DelegationStep[],
  conversation: Conversation,
): Promise<readonly WorkerFinding[]> => {
  const [head, ...rest] = steps;
  if (head === undefined) return Promise.resolve([]);
  return runSafely(
    context,
    parent,
    head,
    conversation,
    rest.length === 0 ? undefined : (span) => chainSteps(context, span, rest, conversation),
  );
};

export const delegate = async (
  context: RequestContext,
  parent: Span,
  steps: readonly DelegationStep[],
  conversation: Conversation,
): Promise<readonly WorkerFinding[]> => {
  if (context.config.topology === 'chain')
    return await chainSteps(context, parent, steps, conversation);
  const batches = await Promise.all(
    steps.map((step) => runSafely(context, parent, step, conversation, undefined)),
  );
  return batches.flat();
};

/** With `ORCHESCOPE_AGENTS=1` there is nobody to hand off to, so the orchestrator does the analysis itself. */
export const analyseInline = async (
  context: RequestContext,
  parent: Span,
  conversation: Conversation,
): Promise<readonly WorkerFinding[]> => {
  const fields: readonly WorkerField[] = ['account', 'inventory'];
  const reply = await callModel(context, parent, 'orchestrator', {
    purpose: 'delegate',
    prompt: `Assess the request without delegating.\n${JSON.stringify(conversation)}`,
    structured: false,
  });
  await context.memory.remember(parent, 'orchestrator:inline', reply.text);
  return fields.map((field) => ({
    agent: 'orchestrator',
    summary: `${reply.text} [${field}=${fieldValue(field, conversation)}]`,
    degraded: false,
  }));
};
