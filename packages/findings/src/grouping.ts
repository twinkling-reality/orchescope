import { severityRank } from '@orchescope/domain';
import type { ComponentId, EdgeId, EvidenceId, FindingMetric } from '@orchescope/schema';
import type { FindingDraft } from './rule.ts';

/**
 * Collapses the instances of one pattern into one draft.
 *
 * A repository that defines two hundred tools nothing calls has one problem, not two hundred, and a `low`
 * finding repeated two hundred times buries every `high` one under it. Grouping is what makes a report of a
 * real repository readable, and the occurrence count is what stops the collapse from hiding the scale.
 *
 * Nothing is dropped silently. The affected components are listed up to a bound and the number withheld is
 * stated in the text and carried as a metric, because a list that stops without saying so reads as a complete
 * list.
 */

const MAX_COMPONENTS = 25;
const MAX_EDGES = 25;
const MAX_EVIDENCE = 10;

/** Drafts only merge when everything the engine would otherwise have to reconcile already agrees. */
const groupKey = (draft: FindingDraft): string =>
  [
    draft.ruleId,
    draft.situation,
    draft.occurrence?.key ?? '',
    draft.remediationVariant ?? '',
    draft.identityDiscriminator ?? '',
    draft.category,
    draft.polarity,
    draft.basis,
  ].join('\u0000');

const unionOf = <T>(values: readonly (readonly T[])[]): T[] => [...new Set(values.flat())];

const occurrenceMetrics = (
  occurrences: number,
  affected: number,
  withheld: number,
): readonly FindingMetric[] => {
  const metrics: FindingMetric[] = [
    {
      name: 'occurrences',
      value: occurrences,
      unit: 'occurrence',
      sampleSize: occurrences,
      basis: 'discovered',
    },
  ];
  if (withheld > 0) {
    metrics.push({
      name: 'componentsWithheld',
      value: withheld,
      unit: 'component',
      sampleSize: affected,
      basis: 'discovered',
    });
  }
  return metrics;
};

const withheldSentence = (occurrences: number, affected: number, withheld: number): string => {
  const scale = `${occurrences} occurrences of this pattern were found in this repository, and this description is written from the first of them.`;
  return withheld === 0
    ? scale
    : `${scale} ${withheld} of the ${affected} affected components are not listed here.`;
};

const merge = (drafts: readonly FindingDraft[]): FindingDraft => {
  const representative = drafts[0] as FindingDraft;
  if (drafts.length === 1) return representative;

  const severity = drafts.reduce(
    (strongest, draft) =>
      severityRank(draft.severity) > severityRank(strongest) ? draft.severity : strongest,
    representative.severity,
  );
  const components = unionOf(drafts.map((draft) => draft.components)).sort() as ComponentId[];
  const edges = unionOf(drafts.map((draft) => draft.edges ?? [])).sort() as EdgeId[];
  const withheld = Math.max(0, components.length - MAX_COMPONENTS);

  return {
    ...representative,
    severity,
    confidence: Math.max(...drafts.map((draft) => draft.confidence)),
    title: (representative.occurrence?.groupedTitle ?? representative.title).replace(
      '{count}',
      String(drafts.length),
    ),
    explanation: `${representative.explanation} ${withheldSentence(drafts.length, components.length, withheld)}`,
    components: components.slice(0, MAX_COMPONENTS),
    edges: edges.slice(0, MAX_EDGES),
    evidence: unionOf(drafts.map((draft) => draft.evidence)).slice(0, MAX_EVIDENCE) as EvidenceId[],
    newEvidence: unionOf(drafts.map((draft) => draft.newEvidence ?? [])).slice(0, MAX_EVIDENCE),
    metrics: [
      ...(representative.metrics ?? []),
      ...occurrenceMetrics(drafts.length, components.length, withheld),
    ],
  };
};

/**
 * Groups in the order the drafts arrive, which the engine has already sorted, so the representative of a group
 * and the identifier the finding receives are the same on every machine.
 */
export const groupDrafts = (drafts: readonly FindingDraft[]): readonly FindingDraft[] => {
  const groups: FindingDraft[][] = [];
  const positions = new Map<string, number>();
  for (const draft of drafts) {
    if (draft.occurrence === undefined) {
      groups.push([draft]);
      continue;
    }
    const key = groupKey(draft);
    const at = positions.get(key);
    if (at === undefined) {
      positions.set(key, groups.length);
      groups.push([draft]);
    } else {
      groups[at]?.push(draft);
    }
  }
  return groups.map(merge);
};
