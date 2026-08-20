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

/**
 * The delta, held as identities rather than as counts alone.
 *
 * A name that failed to match is the thing worth reading here: the join is by name, so which identities joined and
 * which arrived without a counterpart is the measurement, and a count would hide the one that moved.
 */
const runtimeOf = (exercise, bundle) => {
  const delta = bundle.reconciliation;
  const joined = bundle.graph.components
    .filter((component) => component.presence.runtime && component.presence.static)
    .map((component) => component.id)
    .sort();
  return {
    runs: exercise.runs,
    spans: exercise.spans,
    declaredComponents: delta.coverage.declaredComponents,
    exercisedComponents: delta.coverage.exercisedComponents,
    joined,
    // How each join was made. A join on kind and name alone is the one that can match the wrong module.
    joinedOnNameAlone: [...delta.joins.onNameAlone].sort(),
    ambiguousNames: [...delta.joins.ambiguous].sort(),
    exercisedNotDeclared: [...delta.exercisedNotDeclared.components].sort(),
    contradictions: delta.contradictions.length,
    duplicateSideEffects: delta.duplicateSideEffects.length,
  };
};

export const observationOf = (entry, audit, bundle, exercise) => {
  const coverage = bundle.graph.coverage;
  const findings = bundle.findings;
  return {
    name: entry.name,
    kind: entry.kind,
    agentSystemDetected: audit.agentSystemDetected,
    components: {
      total: bundle.graph.components.length,
      byKind: sortedCounts(bundle.graph.components.map((component) => component.kind)),
      /*
       * How many of the total the rules leave out, which is the difference between what this scan found
       * and what it judged. Pinned because it is a number nothing else here would catch moving: the
       * totals above do not change when the marking does, since a component a test declares stays in the
       * graph, so a marking that silently stopped working would show as nothing at all.
       */
      declaredInTest: bundle.graph.components.filter(
        (component) => component.declaredInTest === true,
      ).length,
    },
    relations: {
      total: bundle.graph.edges.length,
      byKind: sortedCounts(bundle.graph.edges.map((edge) => edge.kind)),
    },
    files: {
      discovered: coverage.filesDiscovered,
      inSupportedLanguages: coverage.filesInSupportedLanguages,
      parsed: coverage.filesParsed,
      // The count rather than the length of the listed sample, which is bounded.
      skipped: coverage.filesSkipped ?? coverage.skipped.length,
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
    ...(exercise === undefined ? {} : { runtime: runtimeOf(exercise, bundle) }),
    languagesNotAnalysed: areasOfKind(coverage, 'language_not_analysed'),
    // Both kinds, because a graph stored by an earlier build carries the name no longer written.
    foundNothing: [
      ...areasOfKind(coverage, 'adapter_found_nothing'),
      ...areasOfKind(coverage, 'adapter_blind_spot'),
    ],
    discardedRelations: areasOfKind(coverage, 'discarded_relation'),
    findings: {
      total: findings.length,
      strengths: findings.filter((finding) => finding.polarity === 'strength').length,
      /*
       * Severity is left out where a run reaches a provider, because a provider does not reproduce a proportion.
       *
       * A rule that reports concentration chooses its band from a measured share, and two runs of one commit against
       * a real model put `latency-concentrated-in-one-component` at 42 percent and then 62 percent, which is `low`
       * and then `medium`. Nothing about the repository moved. An expectation carrying that number manufactures a
       * diff on every run and teaches a reader to skip the one diff this file exists to make them read.
       *
       * What is dropped is only the band. `byRule` was identical across both runs and stays pinned, so an entry that
       * stops firing a rule still fails, and that is the half a join is measured on. The entries that drive an
       * offline model reproduce a duration as well as a rule, so they keep both.
       */
      ...(entry.exercise?.requiresEnvironment === undefined
        ? { bySeverity: sortedCounts(findings.map((finding) => finding.severity)) }
        : {}),
      byRule: sortedCounts(findings.map((finding) => finding.ruleId)),
    },
  };
};
