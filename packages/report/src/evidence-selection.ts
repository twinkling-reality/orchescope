import { OrchescopeError } from '@orchescope/domain';
import type {
  Evidence,
  EvidenceCoverage,
  EvidenceId,
  Finding,
  Goal,
  ReconciliationDelta,
  SystemGraph,
} from '@orchescope/schema';

/** Fixed export bound; required claim support is refused rather than truncated. */
export const REPORT_EVIDENCE_CEILING = 5_000;

type SelectionInput = {
  readonly evidence: readonly Evidence[];
  readonly graph: SystemGraph;
  readonly findings: readonly Finding[];
  readonly goals: readonly Goal[];
  readonly reconciliation: ReconciliationDelta | undefined;
};

type Selection = {
  readonly evidence: readonly Evidence[];
  readonly coverage: EvidenceCoverage;
};

const dependenciesOf = (record: Evidence): readonly EvidenceId[] => {
  if (record.kind === 'derived') return record.inputs;
  if (record.kind === 'model_interpretation') return record.groundedIn;
  return [];
};

const reconciliationEvidence = (
  reconciliation: ReconciliationDelta | undefined,
): readonly EvidenceId[] => {
  if (reconciliation === undefined) return [];
  return [
    ...reconciliation.contradictions.flatMap((entry) => entry.evidence),
    ...reconciliation.duplicateSideEffects.flatMap((entry) => entry.evidence),
    ...(reconciliation.coverage.missingSpanAttributes ?? []).flatMap(
      (entry) => entry.evidence ?? [],
    ),
    ...(reconciliation.behavioralAccount?.evidence ?? []),
    ...(reconciliation.behavioralAccount?.refusals.flatMap((entry) => entry.evidence) ?? []),
  ];
};

const directlyRequired = (input: SelectionInput): readonly EvidenceId[] => [
  ...input.graph.components.flatMap((component) => component.evidence),
  ...input.graph.edges.flatMap((edge) => edge.evidence),
  ...input.findings.flatMap((finding) => finding.evidence),
  ...input.goals.flatMap((goal) => goal.evidence),
  ...reconciliationEvidence(input.reconciliation),
];

const omissionReason = (
  evidence: Evidence,
): EvidenceCoverage['omissionReasons'][number]['reason'] => {
  if (evidence.kind === 'span') return 'uncited_span_over_ceiling';
  if (
    evidence.kind === 'source_span' ||
    evidence.kind === 'config_entry' ||
    evidence.kind === 'dependency'
  ) {
    return 'uncited_discovery_over_ceiling';
  }
  if (
    evidence.kind === 'derived' ||
    evidence.kind === 'absence' ||
    evidence.kind === 'model_interpretation'
  ) {
    return 'uncited_derived_over_ceiling';
  }
  return 'uncited_other_over_ceiling';
};

export const selectReportEvidence = (input: SelectionInput): Selection => {
  const byId = new Map<string, Evidence>();
  for (const record of input.evidence) byId.set(record.id, record);
  const eligible = [...byId.values()].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );

  const required = new Set<string>();
  const pending = [...new Set(directlyRequired(input))].sort().reverse();
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || required.has(id)) continue;
    const record = byId.get(id);
    if (record === undefined) {
      throw new OrchescopeError(
        'INVALID_STATE',
        `Report claim evidence ${id} could not be resolved.`,
        { detail: { evidenceId: id } },
      );
    }
    required.add(id);
    if (required.size > REPORT_EVIDENCE_CEILING) {
      throw new OrchescopeError(
        'LIMIT_EXCEEDED',
        `The report requires more than ${REPORT_EVIDENCE_CEILING} evidence records, above the ${REPORT_EVIDENCE_CEILING} record export ceiling.`,
        {
          detail: { required: required.size, ceiling: REPORT_EVIDENCE_CEILING },
          remediation:
            'Narrow the inspected repository with analysis.exclude; required claim evidence is never truncated.',
        },
      );
    }
    for (const dependency of [...dependenciesOf(record)].sort().reverse()) pending.push(dependency);
  }

  if (required.size > REPORT_EVIDENCE_CEILING) {
    throw new OrchescopeError(
      'LIMIT_EXCEEDED',
      `The report requires ${required.size} evidence records, above the ${REPORT_EVIDENCE_CEILING} record export ceiling.`,
      {
        detail: { required: required.size, ceiling: REPORT_EVIDENCE_CEILING },
        remediation:
          'Narrow the inspected repository with analysis.exclude; required claim evidence is never truncated.',
      },
    );
  }

  const selectedIds = new Set(required);
  for (const record of eligible) {
    if (selectedIds.size >= REPORT_EVIDENCE_CEILING) break;
    selectedIds.add(record.id);
  }
  const selected = eligible.filter((record) => selectedIds.has(record.id));
  const omitted = eligible.filter((record) => !selectedIds.has(record.id));
  const reasons = new Map<EvidenceCoverage['omissionReasons'][number]['reason'], number>();
  for (const record of omitted) {
    const reason = omissionReason(record);
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }

  return {
    evidence: selected,
    coverage: {
      totalEligible: eligible.length,
      included: selected.length,
      omitted: omitted.length,
      ceiling: REPORT_EVIDENCE_CEILING,
      requiredIncluded: required.size,
      omissionReasons: [...reasons]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([reason, count]) => ({ reason, count })),
    },
  };
};
