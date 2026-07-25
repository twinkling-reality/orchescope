/**
 * Reduces one audit to the document the corpus holds.
 *
 * Only what is stable across machines and runs belongs here. Durations, identifiers and timestamps are left out
 * because they change on every run and would drown the signal; everything that is kept is a fact about the
 * repository and this build of the readers, so a change to any of it is either an improvement or a regression and
 * deserves to be read as one.
 */

const sortedCounts = (values) => {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([left], [right]) => (left < right ? -1 : 1)));
};

const areasOfKind = (coverage, kind) =>
  coverage.unsupported
    .filter((area) => area.kind === kind)
    .map((area) => area.area)
    .sort();

export const observationOf = (entry, audit, bundle) => {
  const coverage = bundle.graph.coverage;
  const findings = bundle.findings;
  return {
    name: entry.name,
    kind: entry.kind,
    agentSystemDetected: audit.agentSystemDetected,
    components: {
      total: bundle.graph.components.length,
      byKind: sortedCounts(bundle.graph.components.map((component) => component.kind)),
    },
    relations: {
      total: bundle.graph.edges.length,
      byKind: sortedCounts(bundle.graph.edges.map((edge) => edge.kind)),
    },
    files: {
      discovered: coverage.filesDiscovered,
      parsed: coverage.filesParsed,
      truncated: coverage.truncated,
    },
    /* Every adapter, including the ones that did not apply: an adapter going quiet is the drift this file exists to show. */
    adapters: Object.fromEntries(
      [...coverage.adapters]
        .sort((left, right) => (left.adapterId < right.adapterId ? -1 : 1))
        .map((run) => [
          run.adapterId,
          {
            status: run.status,
            componentsFound: run.componentsFound,
            edgesFound: run.edgesFound,
            filesInspected: run.filesInspected,
          },
        ]),
    ),
    languagesNotAnalysed: areasOfKind(coverage, 'language_not_analysed'),
    blindSpots: areasOfKind(coverage, 'adapter_blind_spot'),
    discardedRelations: areasOfKind(coverage, 'discarded_relation'),
    findings: {
      total: findings.length,
      strengths: findings.filter((finding) => finding.polarity === 'strength').length,
      bySeverity: sortedCounts(findings.map((finding) => finding.severity)),
      byRule: sortedCounts(findings.map((finding) => finding.ruleId)),
    },
  };
};
