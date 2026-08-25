/**
 * Holds semantic acceptance claims against the full report bundle from a real pinned corpus checkout.
 *
 * Recorded aggregate observations are useful drift alarms, but the same totals can describe a different graph.
 * These assertions are definition-backed and are never written by `--record`, so recording a changed scan cannot
 * teach the harness to accept a lost cycle, a substituted provider or evidence-free component.
 */

import { holdCompletedZeroAcceptance } from './completed-zero-acceptance.mjs';

const sorted = (values) => [...values].sort();

const sameValues = (left, right) => JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));

const applicabilityRow = (sample) => ({
  imported: sample.imported,
  module: sample.module,
  sourceFile: sample.sourceFile ?? sample.location?.file,
  startLine: sample.startLine ?? sample.location?.startLine,
});

const sortedRows = (rows) =>
  rows
    .map(applicabilityRow)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

const sortedExactRows = (rows) =>
  [...rows].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

const permissionRow = (permission) => ({
  kind: permission.kind,
  scope: permission.scope,
  mode: permission.mode,
});

const configurationBoundRow = (fact) =>
  fact.kind === 'invocation_ceiling'
    ? {
        kind: fact.kind,
        name: fact.name,
        value: fact.ceilingValue,
        declarationFile: fact.declaration?.file,
        declarationLine: fact.declaration?.startLine,
        referenceFile: fact.reference?.file,
        referenceLine: fact.reference?.startLine,
      }
    : {
        kind: 'static_default',
        name: fact.name,
        value: fact.defaultValue,
        declarationFile: fact.declaration?.file,
        declarationLine: fact.declaration?.startLine,
        referenceFile: fact.reference?.file,
        referenceLine: fact.reference?.startLine,
      };

const topologyProducerRow = (producer) => ({
  adapterId: producer.adapterId,
  status: producer.status,
  inspectedInputs: producer.inspectedInputs,
  relationsFound: producer.relationsFound,
  ...(producer.scope === undefined ? {} : { scope: producer.scope }),
});

const evidenceMatches = (subject, expected, evidenceById) =>
  (subject.evidence ?? []).some((id) => {
    const evidence = evidenceById.get(id);
    return (
      evidence?.kind === 'source_span' &&
      evidence.producer === expected.producer &&
      evidence.symbol === expected.symbol &&
      evidence.location?.file === expected.sourceFile &&
      evidence.location?.startLine === expected.startLine &&
      evidence.location?.endLine === expected.endLine &&
      typeof evidence.location.fileHash === 'string'
    );
  });

const citedSourceFiles = (subject, evidenceById) => {
  const located = new Set(
    (subject.sourceLocations ?? [])
      .filter((location) => typeof location.fileHash === 'string')
      .map((location) => location.file),
  );
  return [
    ...new Set(
      (subject.evidence ?? [])
        .map((id) => evidenceById.get(id))
        .filter(
          (evidence) =>
            evidence?.kind === 'source_span' &&
            typeof evidence.location?.fileHash === 'string' &&
            located.has(evidence.location.file),
        )
        .map((evidence) => evidence.location.file),
    ),
  ];
};

const holdOutcome = (acceptance, bundle, hold) => {
  const structuredTopologyFields = new Set([
    'configurationBoundFacts',
    'producerPopulations',
    'requiredRefusals',
    'requiredUnlocatedRefusals',
  ]);
  for (const [key, expected] of Object.entries(acceptance.topology).filter(
    ([key]) => !structuredTopologyFields.has(key),
  )) {
    const observed = bundle.graph.coverage.topology?.[key];
    hold(
      observed === expected,
      `topology.${key} was ${JSON.stringify(observed)}, expected ${JSON.stringify(expected)}`,
    );
  }
  for (const expected of acceptance.topology.requiredRefusals ?? []) {
    hold(
      (bundle.graph.coverage.topology?.unresolved ?? []).some(
        (refusal) =>
          refusal.kind === expected.kind &&
          refusal.reason === expected.reason &&
          refusal.location?.file === expected.sourceFile &&
          refusal.location?.startLine === expected.startLine &&
          typeof refusal.location?.fileHash === 'string',
      ),
      `topology refusal ${expected.kind} at ${expected.sourceFile}:${expected.startLine} was absent`,
    );
  }
  for (const expected of acceptance.topology.requiredUnlocatedRefusals ?? []) {
    hold(
      (bundle.graph.coverage.topology?.unresolved ?? []).some(
        (refusal) =>
          refusal.kind === expected.kind &&
          refusal.reason === expected.reason &&
          refusal.location === undefined,
      ),
      `unlocated topology refusal ${expected.kind}: ${expected.reason} was absent`,
    );
  }
  if (acceptance.topology.configurationBoundFacts !== undefined) {
    const observed = (bundle.graph.coverage.topology?.configurationBoundFacts ?? []).map(
      configurationBoundRow,
    );
    hold(
      JSON.stringify(sortedExactRows(observed)) ===
        JSON.stringify(sortedExactRows(acceptance.topology.configurationBoundFacts)),
      `topology configuration bounds were ${JSON.stringify(sortedExactRows(observed))}, expected ${JSON.stringify(sortedExactRows(acceptance.topology.configurationBoundFacts))}`,
    );
  }
  if (acceptance.topology.producerPopulations !== undefined) {
    const observed = (bundle.graph.coverage.topology?.producers ?? []).map(topologyProducerRow);
    hold(
      JSON.stringify(sortedExactRows(observed)) ===
        JSON.stringify(sortedExactRows(acceptance.topology.producerPopulations)),
      `topology producer populations were ${JSON.stringify(sortedExactRows(observed))}, expected ${JSON.stringify(sortedExactRows(acceptance.topology.producerPopulations))}`,
    );
  }
  const strengths = bundle.findings.filter((finding) => finding.polarity === 'strength').length;
  hold(
    strengths === acceptance.findings.strengths,
    `the audit reported ${strengths} strengths, expected ${acceptance.findings.strengths}`,
  );
  for (const ruleId of acceptance.findings.requiredRules) {
    hold(
      bundle.findings.some((finding) => finding.ruleId === ruleId),
      `finding rule ${ruleId} was absent`,
    );
  }
  if (acceptance.findings.exactRisks !== undefined) {
    const observed = bundle.findings
      .filter((finding) => finding.polarity === 'risk')
      .map((finding) => ({ ruleId: finding.ruleId, severity: finding.severity }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    const expected = [...acceptance.findings.exactRisks].sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
    hold(
      JSON.stringify(observed) === JSON.stringify(expected),
      `risk findings were ${JSON.stringify(observed)}, expected ${JSON.stringify(expected)}`,
    );
  }
};

const holdAdapters = (acceptance, bundle, hold) => {
  const adapters = new Map(
    bundle.graph.coverage.adapters.map((adapter) => [adapter.adapterId, adapter]),
  );
  for (const [adapterId, expected] of Object.entries(acceptance.adapterApplicability ?? {})) {
    const applicability = adapters.get(adapterId)?.applicability;
    hold(applicability !== undefined, `${adapterId} reported no applicability population`);
    for (const key of ['relevantImports', 'distinctFiles', 'omittedImports']) {
      const value = expected[key];
      hold(
        applicability?.[key] === value,
        `${adapterId} applicability.${key} was ${JSON.stringify(applicability?.[key])}, expected ${value}`,
      );
    }
    const observedSample = applicability?.sample ?? [];
    hold(
      JSON.stringify(sortedRows(observedSample)) ===
        JSON.stringify(sortedRows(expected.fileSample)),
      `${adapterId} applicability file sample was ${JSON.stringify(sortedRows(observedSample))}, expected ${JSON.stringify(sortedRows(expected.fileSample))}`,
    );
  }
  for (const [adapterId, expected] of Object.entries(acceptance.adapterOutcomes ?? {})) {
    const observed = adapters.get(adapterId);
    hold(observed !== undefined, `${adapterId} reported no adapter outcome`);
    for (const key of ['status', 'componentsFound', 'edgesFound', 'filesInspected']) {
      hold(
        observed?.[key] === expected[key],
        `${adapterId}.${key} was ${JSON.stringify(observed?.[key])}, expected ${JSON.stringify(expected[key])}`,
      );
    }
  }
};

const holdComponentValues = (field, expectedById, componentById, hold) => {
  for (const [id, values] of Object.entries(expectedById ?? {})) {
    const component = componentById.get(id);
    hold(component !== undefined, `component ${id} was absent`);
    for (const [key, expected] of Object.entries(values)) {
      hold(
        component?.[field]?.[key] === expected,
        `${id} ${field}.${key} was ${JSON.stringify(component?.[field]?.[key])}, expected ${JSON.stringify(expected)}`,
      );
    }
  }
};

const graphAcceptanceVerdict = (acceptance, bundle) => {
  const components = bundle.graph.components;
  const componentById = new Map(components.map((component) => [component.id, component]));
  const evidenceById = new Map(bundle.evidence.map((evidence) => [evidence.id, evidence]));
  const broken = [];
  let total = 0;
  const hold = (condition, sentence) => {
    total += 1;
    if (!condition) broken.push(sentence);
  };

  if (acceptance.graphPopulation !== undefined) {
    hold(
      components.length === acceptance.graphPopulation.components,
      `the graph had ${components.length} components, expected ${acceptance.graphPopulation.components}`,
    );
    hold(
      bundle.graph.edges.length === acceptance.graphPopulation.edges,
      `the graph had ${bundle.graph.edges.length} edges, expected ${acceptance.graphPopulation.edges}`,
    );
  }

  for (const [kind, expected] of Object.entries(acceptance.exactIdsByKind)) {
    const observed = components
      .filter((component) => component.kind === kind)
      .map((component) => component.id);
    hold(
      sameValues(observed, expected),
      `${kind} identities were ${JSON.stringify(sorted(observed))}, expected ${JSON.stringify(sorted(expected))}`,
    );
  }
  for (const kind of acceptance.absentKinds) {
    hold(
      !components.some((component) => component.kind === kind),
      `component kind ${kind} was present`,
    );
  }
  for (const term of acceptance.absentComponentTerms) {
    hold(
      !components.some((component) => component.id.toLowerCase().includes(term)),
      `a component identity contained ${term}`,
    );
  }
  for (const kind of acceptance.absentEdgeKinds ?? []) {
    hold(!bundle.graph.edges.some((edge) => edge.kind === kind), `edge kind ${kind} was present`);
  }
  for (const expected of acceptance.requiredEdges) {
    const edge = bundle.graph.edges.find(
      (candidate) =>
        candidate.kind === expected.kind &&
        candidate.from === expected.from &&
        candidate.to === expected.to,
    );
    hold(edge !== undefined, `${expected.kind} ${expected.from} -> ${expected.to} was absent`);
    hold(
      edge !== undefined && citedSourceFiles(edge, evidenceById).includes(expected.sourceFile),
      `${expected.kind} ${expected.from} -> ${expected.to} had no source citation in ${expected.sourceFile}`,
    );
    for (const evidence of expected.evidence) {
      hold(
        edge !== undefined && evidenceMatches(edge, evidence, evidenceById),
        `${expected.kind} ${expected.from} -> ${expected.to} lacked ${evidence.producer} evidence ${evidence.symbol} at ${evidence.sourceFile}:${evidence.startLine}`,
      );
    }
  }
  holdComponentValues('metadata', acceptance.componentMetadata, componentById, hold);
  holdComponentValues('details', acceptance.componentDetails, componentById, hold);
  for (const [id, expected] of Object.entries(acceptance.componentPermissions ?? {})) {
    const observed = (componentById.get(id)?.permissions ?? []).map(permissionRow);
    hold(
      JSON.stringify(sortedExactRows(observed)) === JSON.stringify(sortedExactRows(expected)),
      `${id} permissions were ${JSON.stringify(sortedExactRows(observed))}, expected ${JSON.stringify(sortedExactRows(expected))}`,
    );
  }
  for (const [id, expected] of Object.entries(acceptance.componentEvidence)) {
    const component = componentById.get(id);
    for (const evidence of expected) {
      hold(
        component !== undefined && evidenceMatches(component, evidence, evidenceById),
        `${id} lacked ${evidence.producer} evidence ${evidence.symbol} at ${evidence.sourceFile}:${evidence.startLine}`,
      );
    }
  }
  for (const [id, files] of Object.entries(acceptance.sourceCitations)) {
    const component = componentById.get(id);
    const observed = component === undefined ? [] : citedSourceFiles(component, evidenceById);
    hold(
      component !== undefined && sameValues(observed, files),
      `${id} source citations were ${JSON.stringify(sorted(observed))}, expected ${JSON.stringify(sorted(files))}`,
    );
  }
  holdAdapters(acceptance, bundle, hold);
  for (const expected of acceptance.requiredUnclaimedImportedConstructions ?? []) {
    hold(
      (bundle.graph.coverage.unsupported ?? []).some(
        (area) =>
          area.kind === 'unclaimed_imported_construction' &&
          area.location?.file === expected.sourceFile &&
          area.location?.startLine === expected.startLine &&
          typeof area.location?.fileHash === 'string',
      ),
      `unclaimed imported construction at ${expected.sourceFile}:${expected.startLine} was absent`,
    );
  }
  holdOutcome(acceptance, bundle, hold);

  return { held: total - broken.length, total, broken };
};

const completedZeroVerdict = (acceptance, bundle) => {
  const broken = [];
  let total = 0;
  const hold = (condition, sentence) => {
    total += 1;
    if (!condition) broken.push(sentence);
  };
  holdCompletedZeroAcceptance(acceptance, bundle, hold);
  return { held: total - broken.length, total, broken };
};

/** Returns the non-recordable acceptance assertions held and broken by one audit bundle. */
export const acceptanceVerdict = (entry, bundle) => {
  const acceptance = entry.acceptance;
  if (acceptance === undefined) return { held: 0, total: 0, broken: [] };
  return acceptance.type === 'completed_zero'
    ? completedZeroVerdict(acceptance, bundle)
    : graphAcceptanceVerdict(acceptance, bundle);
};
