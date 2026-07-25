import process from 'node:process';
import { unitOf } from './random.ts';

/**
 * Cooperative fault injection.
 *
 * Orchescope hands a FaultPlan to this process in `ORCHESCOPE_FAULT_PLAN` and this application applies it
 * to itself. The plan arrives as JSON from another process, so every field is parsed defensively: an
 * unreadable plan means no faults rather than a crash, unknown fault kinds are ignored, and a probability
 * outside [0, 1] is clamped.
 *
 * Decisions are a pure function of the plan seed, the fault, the target and the attempt number, so a fault
 * lands in the same place on every run of the same plan. With `ORCHESCOPE_CONCURRENCY` above one, the
 * `maxApplications` budget is consumed in the order requests reach the decision point.
 */

export type FaultKind =
  | 'model_timeout'
  | 'model_rate_limited'
  | 'model_server_error'
  | 'model_malformed_structured_output'
  | 'tool_timeout'
  | 'tool_exception'
  | 'tool_malformed_result'
  | 'retrieval_empty'
  | 'worker_unavailable'
  | 'queue_delay'
  | 'prompt_injection_in_content';

const SUPPORTED_KINDS: readonly FaultKind[] = [
  'model_timeout',
  'model_rate_limited',
  'model_server_error',
  'model_malformed_structured_output',
  'tool_timeout',
  'tool_exception',
  'tool_malformed_result',
  'retrieval_empty',
  'worker_unavailable',
  'queue_delay',
  'prompt_injection_in_content',
];

export type FaultDecision = {
  readonly kind: FaultKind;
  readonly delayMs: number;
  readonly payload: string | undefined;
};

export type FaultEngine = {
  /** Returns the fault to apply to this attempt, or undefined when the attempt runs unharmed. */
  readonly decide: (kind: FaultKind, target: string, attempt: number) => FaultDecision | undefined;
  readonly appliedKinds: () => readonly FaultKind[];
};

type NormalizedSpec = {
  readonly kind: FaultKind;
  readonly target: string;
  readonly probability: number;
  readonly attempts: readonly number[];
  readonly delayMs: number;
  readonly payload: string | undefined;
  readonly maxApplications: number;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const asPositiveInts = (value: unknown): readonly number[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is number => Number.isInteger(entry) && entry > 0)
    : [];

const clampProbability = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
};

const normalizeSpec = (value: unknown): NormalizedSpec | undefined => {
  const record = asRecord(value);
  const kind = record['kind'];
  const target = record['target'];
  if (typeof kind !== 'string' || typeof target !== 'string' || target.length === 0)
    return undefined;
  if (!SUPPORTED_KINDS.includes(kind as FaultKind)) return undefined;
  const delay = record['delayMs'];
  const maximum = record['maxApplications'];
  const payload = record['payload'];
  return {
    kind: kind as FaultKind,
    target,
    probability: clampProbability(record['probability']),
    attempts: asPositiveInts(record['attempts']),
    delayMs:
      typeof delay === 'number' && Number.isFinite(delay) && delay > 0 ? Math.trunc(delay) : 0,
    payload: typeof payload === 'string' ? payload : undefined,
    maxApplications:
      typeof maximum === 'number' && Number.isInteger(maximum) && maximum > 0
        ? maximum
        : Number.MAX_SAFE_INTEGER,
  };
};

const parsePlan = (raw: string | undefined): { seed: number; specs: readonly NormalizedSpec[] } => {
  if (raw === undefined || raw.length === 0) return { seed: 0, specs: [] };
  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    return { seed: 0, specs: [] };
  }
  const record = asRecord(payload);
  const seed = record['seed'];
  const faults = record['faults'];
  const specs: NormalizedSpec[] = [];
  if (Array.isArray(faults)) {
    for (const entry of faults) {
      const spec = normalizeSpec(entry);
      if (spec !== undefined) specs.push(spec);
    }
  }
  return { seed: typeof seed === 'number' && Number.isFinite(seed) ? Math.trunc(seed) : 0, specs };
};

const specApplies = (
  spec: NormalizedSpec,
  kind: FaultKind,
  target: string,
  attempt: number,
): boolean => {
  if (spec.kind !== kind) return false;
  if (spec.target !== '*' && spec.target !== target) return false;
  return spec.attempts.length === 0 || spec.attempts.includes(attempt);
};

export const createFaultEngine = (raw = process.env['ORCHESCOPE_FAULT_PLAN']): FaultEngine => {
  const plan = parsePlan(raw);
  const applications = new Map<number, number>();
  /**
   * How many operations each fault has had the chance to affect. The draw is keyed on this counter rather
   * than on the number of applications, so that every matching operation gets an independent decision: a
   * probability of 0.5 affects about half of the matches, instead of stopping at the first one it spares.
   */
  const opportunities = new Map<number, number>();
  const applied: FaultKind[] = [];

  const decide = (kind: FaultKind, target: string, attempt: number): FaultDecision | undefined => {
    for (const [index, spec] of plan.specs.entries()) {
      if (!specApplies(spec, kind, target, attempt)) continue;
      const seen = opportunities.get(index) ?? 0;
      opportunities.set(index, seen + 1);
      const used = applications.get(index) ?? 0;
      if (used >= spec.maxApplications) continue;
      if (unitOf(plan.seed, spec.kind, spec.target, attempt, seen) >= spec.probability) continue;
      applications.set(index, used + 1);
      applied.push(spec.kind);
      return { kind: spec.kind, delayMs: spec.delayMs, payload: spec.payload };
    }
    return undefined;
  };

  return { decide, appliedKinds: () => applied };
};
