/** Holds the full report-bundle verdict that makes an honest completed-zero scan acceptable. */

const sortedRows = (rows) =>
  [...rows].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

const sameRows = (left, right) =>
  JSON.stringify(sortedRows(left)) === JSON.stringify(sortedRows(right));

const adapterRow = (adapter) => ({
  status: adapter.status,
  componentsFound: adapter.componentsFound,
  edgesFound: adapter.edgesFound,
  filesInspected: adapter.filesInspected,
  languages: [...adapter.languages].sort(),
});

const unsupportedRow = (gap) => ({ kind: gap.kind, area: gap.area, reason: gap.reason });

const producerRow = (producer) => ({
  adapterId: producer.adapterId,
  status: producer.status,
  scope: producer.scope,
  inspectedInputs: producer.inspectedInputs,
  relationsFound: producer.relationsFound,
});

const refusalRow = (refusal) => ({
  kind: refusal.kind,
  reason: refusal.reason,
  sourceFile: refusal.location?.file,
  startLine: refusal.location?.startLine,
  fileHash: refusal.location?.fileHash,
});

/** Adds every completed-zero assertion to the shared semantic verdict. */
export const holdCompletedZeroAcceptance = (acceptance, bundle, hold) => {
  hold(
    bundle.graph.components.length === acceptance.graphPopulation.components,
    `the graph had ${bundle.graph.components.length} components, expected ${acceptance.graphPopulation.components}`,
  );
  hold(
    bundle.graph.edges.length === acceptance.graphPopulation.edges,
    `the graph had ${bundle.graph.edges.length} edges, expected ${acceptance.graphPopulation.edges}`,
  );
  hold(
    bundle.evidence.length === acceptance.evidencePopulation.records,
    `the report exported ${bundle.evidence.length} evidence records, expected ${acceptance.evidencePopulation.records}`,
  );

  for (const field of ['totalEligible', 'included', 'omitted', 'requiredIncluded']) {
    hold(
      bundle.evidenceCoverage?.[field] === acceptance.evidenceCoverage[field],
      `evidenceCoverage.${field} was ${JSON.stringify(bundle.evidenceCoverage?.[field])}, expected ${acceptance.evidenceCoverage[field]}`,
    );
  }
  hold(
    Array.isArray(bundle.evidenceCoverage?.omissionReasons) &&
      sameRows(
        bundle.evidenceCoverage.omissionReasons,
        acceptance.evidenceCoverage.omissionReasons,
      ),
    `evidenceCoverage.omissionReasons was ${JSON.stringify(bundle.evidenceCoverage?.omissionReasons ?? [])}, expected ${JSON.stringify(acceptance.evidenceCoverage.omissionReasons)}`,
  );
  hold(
    bundle.componentMetrics.length === acceptance.componentMetricPopulation.records,
    `the report exported ${bundle.componentMetrics.length} component metrics, expected ${acceptance.componentMetricPopulation.records}`,
  );
  hold(
    bundle.runs.length === acceptance.runtimePopulation.runs,
    `the report exported ${bundle.runs.length} runs, expected ${acceptance.runtimePopulation.runs}`,
  );
  for (const population of ['observed', 'silent']) {
    const observed = bundle.runPopulations?.[population];
    const expected = acceptance.runtimePopulation[population];
    hold(
      observed?.count === expected.count,
      `runPopulations.${population}.count was ${JSON.stringify(observed?.count)}, expected ${expected.count}`,
    );
    hold(
      Array.isArray(observed?.runIds) && sameRows(observed.runIds, expected.runIds),
      `runPopulations.${population}.runIds was ${JSON.stringify(sortedRows(observed?.runIds ?? []))}, expected ${JSON.stringify(sortedRows(expected.runIds))}`,
    );
  }

  for (const [adapterId, expected] of Object.entries(acceptance.adapterOutcomes)) {
    const observed = bundle.graph.coverage.adapters.filter(
      (adapter) => adapter.adapterId === adapterId,
    );
    hold(
      observed.length === 1,
      `${adapterId} reported ${observed.length} adapter rows, expected 1`,
    );
    const row = observed[0] === undefined ? undefined : adapterRow(observed[0]);
    for (const field of [
      'status',
      'componentsFound',
      'edgesFound',
      'filesInspected',
      'languages',
    ]) {
      const actual = row?.[field];
      const wanted = field === 'languages' ? [...expected.languages].sort() : expected[field];
      hold(
        JSON.stringify(actual) === JSON.stringify(wanted),
        `${adapterId}.${field} was ${JSON.stringify(actual)}, expected ${JSON.stringify(wanted)}`,
      );
    }
  }

  const foundNothing = bundle.graph.coverage.unsupported
    .filter((gap) => gap.kind === 'adapter_found_nothing')
    .map(unsupportedRow);
  hold(
    sameRows(foundNothing, acceptance.unsupported),
    `adapter_found_nothing gaps were ${JSON.stringify(sortedRows(foundNothing))}, expected ${JSON.stringify(sortedRows(acceptance.unsupported))}`,
  );

  const topology = bundle.graph.coverage.topology;
  for (const field of ['status', 'unresolvedCount', 'conditionalDestinations']) {
    hold(
      topology?.[field] === acceptance.topology[field],
      `topology.${field} was ${JSON.stringify(topology?.[field])}, expected ${JSON.stringify(acceptance.topology[field])}`,
    );
  }
  const producers = (topology?.producers ?? []).map(producerRow);
  hold(
    sameRows(producers, acceptance.topology.producers),
    `topology producers were ${JSON.stringify(sortedRows(producers))}, expected ${JSON.stringify(sortedRows(acceptance.topology.producers))}`,
  );
  const refusals = (topology?.unresolved ?? []).map(refusalRow);
  hold(
    sameRows(refusals, acceptance.topology.requiredRefusals),
    `topology refusals were ${JSON.stringify(sortedRows(refusals))}, expected ${JSON.stringify(sortedRows(acceptance.topology.requiredRefusals))}`,
  );

  const strengths = bundle.findings.filter((finding) => finding.polarity === 'strength').length;
  hold(
    bundle.findings.length === acceptance.findings.total,
    `the audit reported ${bundle.findings.length} findings, expected ${acceptance.findings.total}`,
  );
  hold(
    strengths === acceptance.findings.strengths,
    `the audit reported ${strengths} strengths, expected ${acceptance.findings.strengths}`,
  );
};
