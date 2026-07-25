import type { FaultDecision, FaultEngine } from './faults.ts';
import { ATTR, SIDE_EFFECT_EVENT, type Span, type Trace } from './telemetry.ts';

/**
 * The shapes shared by the agents, the tools and the run entry point.
 *
 * The interfaces a request depends on are declared here rather than in the modules that implement them, so
 * that the dependency graph of this application stays acyclic in both directions.
 */

export type Topology = 'star' | 'chain';

export type RunConfig = {
  readonly seed: number;
  readonly agents: number;
  readonly workers: number;
  readonly concurrency: number;
  readonly topology: Topology;
  readonly model: string;
  readonly fallbackModel: string;
  readonly input: string;
  readonly promptVersion: string;
};

export type EffectOutcome = 'succeeded' | 'failed' | 'partial' | 'unknown';

/** One side effect that actually happened, including duplicates produced by a retry. */
export type EffectRecord = {
  readonly kind: string;
  readonly target: string;
  readonly idempotencyKey?: string;
  readonly outcome: EffectOutcome;
};

export type Totals = {
  userInterventions: number;
  policyViolations: number;
  loopIterations: number;
};

export type AccountRecord = {
  readonly accountId: string;
  readonly orderId: string;
  readonly holder: string;
  readonly tier: string;
  readonly refundAmount: number;
  readonly currency: string;
  readonly openTickets: number;
  /** False when the account service answered with a record that failed validation. */
  readonly complete: boolean;
};

export type InventoryRecord = {
  readonly sku: string;
  readonly orderId: string;
  readonly onHand: number;
  readonly restockDays: number;
  readonly warehouse: string;
  readonly complete: boolean;
};

export type PolicyDocument = {
  readonly id: string;
  readonly title: string;
  readonly text: string;
};

export type ConversationMessage = {
  readonly role: 'system' | 'user' | 'assistant';
  readonly text: string;
};

export type Conversation = {
  readonly id: string;
  readonly request: string;
  readonly messages: ConversationMessage[];
  account: AccountRecord | undefined;
  inventory: InventoryRecord | undefined;
  policies: readonly PolicyDocument[];
  readonly findings: string[];
};

export type MemoryStore = {
  readonly recall: (parent: Span, key: string) => Promise<readonly string[]>;
  readonly remember: (parent: Span, key: string, value: string) => Promise<void>;
};

export type QueueSlot = {
  readonly workerName: string;
  /** Wait derived from the seed and the queue depth, reported on the `queue_wait` span. */
  readonly waitMs: number;
  readonly injectedFault?: string;
};

export type RefundQueue = {
  readonly submit: <T>(key: string, job: (slot: QueueSlot) => Promise<T>) => Promise<T>;
};

export type RequestContext = {
  readonly config: RunConfig;
  readonly index: number;
  readonly conversationId: string;
  readonly trace: Trace;
  readonly faults: FaultEngine;
  readonly memory: MemoryStore;
  readonly queue: RefundQueue;
  readonly totals: Totals;
  readonly effects: EffectRecord[];
};

/**
 * Records a side effect twice on purpose: as a span event for the trace and in the run's effect list for the
 * result file. Orchescope compares the two, so an effect that only appears in one of them is a real finding.
 */
export const recordEffect = (context: RequestContext, span: Span, effect: EffectRecord): void => {
  span.addEvent(SIDE_EFFECT_EVENT, {
    [ATTR.sideEffectKind]: effect.kind,
    [ATTR.sideEffectTarget]: effect.target,
    ...(effect.idempotencyKey === undefined ? {} : { [ATTR.sideEffectKey]: effect.idempotencyKey }),
    [ATTR.sideEffectOutcome]: effect.outcome,
  });
  context.effects.push(effect);
};

export const noteFault = (span: Span, decision: FaultDecision): void => {
  span.set(ATTR.faultInjected, decision.kind);
};

export const conversationOf = (context: RequestContext): Conversation => ({
  id: context.conversationId,
  request: context.config.input,
  messages: [{ role: 'user', text: context.config.input }],
  account: undefined,
  inventory: undefined,
  policies: [],
  findings: [],
});
