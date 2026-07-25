import type { Evidence, EvidenceId, Finding } from '@orchescope/schema';

/**
 * Review of findings that came from a language model.
 *
 * A model produced finding is untrusted until it is checked against the evidence it was given. Three checks
 * are applied, and a finding that fails any of them is rejected rather than downgraded, because a plausible
 * wrong finding is worse than a missing one:
 *
 *  1. every evidence reference it cites must exist;
 *  2. every component it names must exist in the graph;
 *  3. it must not cite evidence outside the set the analysis task was given, which is how a model claim about
 *     something it was never shown is caught.
 */

export type ReviewVerdict = 'supported' | 'unsupported' | 'conflicting';

export type ReviewOutcome = {
  readonly verdict: ReviewVerdict;
  readonly reasons: readonly string[];
};

export type ReviewInput = {
  readonly finding: Finding;
  readonly availableEvidence: ReadonlyMap<string, Evidence>;
  readonly grantedEvidence: readonly EvidenceId[];
  readonly componentIds: ReadonlySet<string>;
  readonly existingFindings: readonly Finding[];
};

export const reviewModelFinding = (input: ReviewInput): ReviewOutcome => {
  const reasons: string[] = [];
  const granted = new Set(input.grantedEvidence);

  if (input.finding.evidence.length === 0) {
    reasons.push('the finding cites no evidence');
  }
  for (const reference of input.finding.evidence) {
    if (!input.availableEvidence.has(reference)) {
      reasons.push(`evidence ${reference} does not exist`);
      continue;
    }
    if (granted.size > 0 && !granted.has(reference)) {
      reasons.push(`evidence ${reference} was not part of the analysis task`);
    }
  }
  for (const componentId of input.finding.components) {
    if (!input.componentIds.has(componentId)) {
      reasons.push(`component ${componentId} is not in the graph`);
    }
  }
  if (input.finding.components.length === 0 && input.finding.edges.length === 0) {
    reasons.push('the finding names no component or relation');
  }

  if (reasons.length > 0) return { verdict: 'unsupported', reasons };

  const conflicting = input.existingFindings.filter(
    (existing) =>
      existing.id !== input.finding.id &&
      existing.polarity !== input.finding.polarity &&
      existing.components.some((componentId) => input.finding.components.includes(componentId)) &&
      existing.category === input.finding.category,
  );
  if (conflicting.length > 0) {
    return {
      verdict: 'conflicting',
      reasons: conflicting.map(
        (existing) =>
          `${existing.id} reaches the opposite conclusion about ${existing.components.join(', ')} in the same category`,
      ),
    };
  }

  return { verdict: 'supported', reasons: [] };
};

/**
 * Records a conflict on both findings rather than dropping either. A reviewer needs to see that two rules
 * disagreed; silently keeping one is how a report becomes confidently wrong.
 */
export const linkConflicts = (findings: readonly Finding[]): readonly Finding[] => {
  const byComponent = new Map<string, Finding[]>();
  for (const finding of findings) {
    for (const componentId of finding.components) {
      const bucket = byComponent.get(componentId);
      if (bucket === undefined) byComponent.set(componentId, [finding]);
      else bucket.push(finding);
    }
  }
  const conflicts = new Map<string, Set<string>>();
  for (const bucket of byComponent.values()) {
    for (const left of bucket) {
      for (const right of bucket) {
        if (left.id === right.id) continue;
        if (left.category !== right.category) continue;
        if (left.polarity === right.polarity) continue;
        const set = conflicts.get(left.id) ?? new Set<string>();
        set.add(right.id);
        conflicts.set(left.id, set);
      }
    }
  }
  return findings.map((finding) => {
    const set = conflicts.get(finding.id);
    return set === undefined ? finding : { ...finding, conflictsWith: [...set].sort() };
  });
};
