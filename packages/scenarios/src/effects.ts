import type { EffectExpectation, SideEffectRecord, TargetResult } from '@orchescope/schema';

/**
 * Side effect accounting.
 *
 * A side effect can reach Orchescope twice: as a span event in the trace and as an entry in the target
 * result file. A well instrumented target records both on purpose, and Orchescope compares them.
 *
 * Counting the two sources additively would report every carefully instrumented effect as a duplicate, so a
 * count is the larger of the two sources rather than their sum. A target that records an effect in both
 * places matches one that records it once, and a target that genuinely performed the effect twice still
 * shows two.
 *
 * Duplicate detection uses the triple (kind, target, idempotencyKey). An absent key means duplicates cannot
 * be ruled out, so effects without a key collapse onto the same (kind, target) pair and a second occurrence
 * counts as a duplicate.
 */

export type ReportedEffect = NonNullable<TargetResult['effects']>[number];

export type EffectOccurrence = {
  readonly kind: string;
  readonly target: string;
  readonly idempotencyKey?: string;
};

export const effectKey = (effect: EffectOccurrence): string =>
  effect.idempotencyKey === undefined
    ? `${effect.kind}|${effect.target}`
    : `${effect.kind}|${effect.target}|${effect.idempotencyKey}`;

const countByKey = (effects: readonly EffectOccurrence[]): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>();
  for (const effect of effects) {
    const key = effectKey(effect);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

export type EffectTally = {
  /** Occurrences across both sources, counting an effect recorded in both places once. */
  readonly total: number;
  readonly duplicateKeys: readonly string[];
  /** Occurrences beyond the first for every duplicated key. */
  readonly extraOccurrences: number;
};

/**
 * An attempt that failed changed nothing outside the system, so it is not an occurrence. An attempt whose outcome is
 * unknown is counted, because a timeout that may have committed is exactly the case duplication analysis exists for.
 * This matches the rule the runtime metric uses, so the two never disagree about the same run.
 */
const happened = (effect: { readonly outcome?: string }): boolean => effect.outcome !== 'failed';

export const tallyEffects = (
  spanEffects: readonly SideEffectRecord[],
  reportedEffects: readonly ReportedEffect[],
): EffectTally => {
  const fromSpans = countByKey(spanEffects.filter(happened));
  const fromResult = countByKey(reportedEffects.filter(happened));
  const keys = [...new Set([...fromSpans.keys(), ...fromResult.keys()])].sort();
  const duplicateKeys: string[] = [];
  let total = 0;
  let extraOccurrences = 0;
  for (const key of keys) {
    const count = Math.max(fromSpans.get(key) ?? 0, fromResult.get(key) ?? 0);
    total += count;
    if (count > 1) {
      duplicateKeys.push(key);
      extraOccurrences += count - 1;
    }
  }
  return { total, duplicateKeys, extraOccurrences };
};

/** Occurrences matching an expectation, under the same larger-of-two-sources rule. */
export const countMatching = (
  expectation: EffectExpectation,
  spanEffects: readonly SideEffectRecord[],
  reportedEffects: readonly ReportedEffect[],
): number => {
  const matches = (effect: EffectOccurrence): boolean =>
    effect.kind === expectation.kind &&
    (expectation.target === undefined || effect.target === expectation.target);
  return Math.max(spanEffects.filter(matches).length, reportedEffects.filter(matches).length);
};

export const describeExpectation = (expectation: EffectExpectation): string =>
  expectation.target === undefined
    ? `effect ${expectation.kind}`
    : `effect ${expectation.kind} on ${expectation.target}`;
