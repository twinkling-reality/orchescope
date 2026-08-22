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
    /*
     * The same pair for relations, which nothing here recorded and which was wrong on every entry that
     * carries a run. The numerator counted every observed relation while the denominator counted declared
     * ones, so an entry whose declarations a run joined none of reported eleven of sixteen exercised. The
     * component pair above would not have moved for any of it.
     */
    declaredEdges: delta.coverage.declaredEdges,
    exercisedEdges: delta.coverage.exercisedEdges,
    joins: {
      byCodeLocation: delta.joins.byCodeLocation,
      byRuntimeName: delta.joins.byRuntimeName,
      byKindAndName: delta.joins.byKindAndName,
    },
    joined,
    // How each join was made. A join on kind and name alone is the one that can match the wrong module.
    joinedOnNameAlone: [...delta.joins.onNameAlone].sort(),
    ambiguousNames: [...delta.joins.ambiguous].sort(),
    missingSpanAttributes: [...(delta.coverage.missingSpanAttributes ?? [])]
      .map((entry) => ({ ...entry }))
      .sort((left, right) => {
        const leftKey = `${left.purpose}|${left.attribute}|${left.reason ?? ''}`;
        const rightKey = `${right.purpose}|${right.attribute}|${right.reason ?? ''}`;
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
      }),
    exercisedNotDeclared: [...delta.exercisedNotDeclared.components].sort(),
    contradictions: delta.contradictions.length,
    duplicateSideEffects: delta.duplicateSideEffects.length,
  };
};

/**
 * How many components a finding names, which is not always how many it lists.
 *
 * Grouping caps the list at twenty five and records what it withheld as a metric whose `sampleSize` is the
 * whole affected population. Reading the list alone reports the cap.
 */
const componentsNamedBy = (finding) => {
  const withheld = (finding.metrics ?? []).find((metric) => metric.name === 'componentsWithheld');
  return withheld?.sampleSize ?? finding.components.length;
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
      /*
       * How many components each rule's findings name, which `byRule` cannot see.
       *
       * A rule that groups its occurrences reports one finding whatever it found, so the count above
       * holds at one while the subject moves. Reachability went from naming one component to naming
       * nineteen and back to seventeen across three changes to the traversal underneath it, and every
       * number in this file stayed still for all three. A rule whose answer can swing by eighteen
       * components with no diff is the silence this file exists to break.
       *
       * Counted from `componentsWithheld` where a grouped finding carries one, because the list on the
       * finding stops at twenty five. `declared-not-exercised` on the CrewAI run names a hundred and
       * thirty components and listed twenty five of them, so this metric read twenty five and would
       * have gone on reading twenty five whatever that rule did next. The finding says both numbers:
       * the metric's `sampleSize` is the population and its `value` is how much of it was withheld.
       * A rule that cites a sample rather than enumerating a population carries no such metric, and
       * for those the list is the whole answer.
       */
      componentsByRule: Object.fromEntries(
        [...new Set(findings.map((finding) => finding.ruleId))]
          .sort()
          .map((ruleId) => [
            ruleId,
            findings
              .filter((finding) => finding.ruleId === ruleId)
              .reduce((total, finding) => total + componentsNamedBy(finding), 0),
          ]),
      ),
    },
  };
};
