/** Validates the discriminated acceptance contract for an honest completed-zero agent-system scan. */

const MAX_ITEMS = 64;
const MAX_TEXT = 512;
const SHA256 = /^[0-9a-f]{64}$/;

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;
const isBoundedString = (value) =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT;
const isBoundedList = (value) => Array.isArray(value) && value.length <= MAX_ITEMS;
const isRelativePath = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  !value.startsWith('/') &&
  !value.endsWith('/') &&
  !value.includes('\\') &&
  !value.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..');

const hasExactFields = (value, fields) => {
  if (!isRecord(value)) return false;
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...fields].sort());
};

const checkAdapterOutcomes = (outcomes, problem) => {
  if (
    !isRecord(outcomes) ||
    Object.keys(outcomes).length === 0 ||
    Object.keys(outcomes).length > MAX_ITEMS
  ) {
    problem('acceptance.adapterOutcomes has to name at least one completed adapter population');
    return;
  }
  for (const [adapterId, outcome] of Object.entries(outcomes)) {
    if (
      !adapterId.startsWith('adapter:') ||
      !hasExactFields(outcome, [
        'status',
        'componentsFound',
        'edgesFound',
        'filesInspected',
        'languages',
      ]) ||
      outcome.status !== 'completed' ||
      outcome.componentsFound !== 0 ||
      outcome.edgesFound !== 0 ||
      !isNonNegativeInteger(outcome.filesInspected) ||
      !isBoundedList(outcome.languages) ||
      outcome.languages.some((language) => !isBoundedString(language)) ||
      new Set(outcome.languages).size !== outcome.languages.length
    ) {
      problem(
        `acceptance.adapterOutcomes.${adapterId} has to state one exact completed-zero adapter row`,
      );
    }
  }
};

const checkUnsupported = (unsupported, problem) => {
  if (
    !isBoundedList(unsupported) ||
    unsupported.length === 0 ||
    unsupported.some(
      (gap) =>
        !hasExactFields(gap, ['kind', 'area', 'reason']) ||
        gap.kind !== 'adapter_found_nothing' ||
        !isBoundedString(gap.area) ||
        !isBoundedString(gap.reason),
    )
  ) {
    problem('acceptance.unsupported has to list exact adapter_found_nothing gaps');
  }
};

const checkTopology = (topology, problem) => {
  if (
    !hasExactFields(topology, [
      'status',
      'unresolvedCount',
      'conditionalDestinations',
      'producers',
      'requiredRefusals',
    ]) ||
    topology.status !== 'incomplete' ||
    !Number.isInteger(topology.unresolvedCount) ||
    topology.unresolvedCount <= 0 ||
    !isNonNegativeInteger(topology.conditionalDestinations)
  ) {
    problem('acceptance.topology has to preserve an exact incomplete topology population');
    return;
  }
  if (
    !isBoundedList(topology.producers) ||
    topology.producers.length === 0 ||
    topology.producers.some(
      (producer) =>
        !hasExactFields(producer, [
          'adapterId',
          'status',
          'scope',
          'inspectedInputs',
          'relationsFound',
        ]) ||
        !isBoundedString(producer.adapterId) ||
        producer.status !== 'incomplete' ||
        !isBoundedString(producer.scope) ||
        !isNonNegativeInteger(producer.inspectedInputs) ||
        !isNonNegativeInteger(producer.relationsFound),
    )
  ) {
    problem('acceptance.topology.producers has to list exact incomplete producer populations');
  }
  if (
    !isBoundedList(topology.requiredRefusals) ||
    topology.requiredRefusals.length === 0 ||
    topology.requiredRefusals.some(
      (refusal) =>
        !hasExactFields(refusal, ['kind', 'reason', 'sourceFile', 'startLine', 'fileHash']) ||
        !isBoundedString(refusal.kind) ||
        !isBoundedString(refusal.reason) ||
        !isRelativePath(refusal.sourceFile) ||
        !Number.isInteger(refusal.startLine) ||
        refusal.startLine <= 0 ||
        typeof refusal.fileHash !== 'string' ||
        !SHA256.test(refusal.fileHash),
    )
  ) {
    problem(
      'acceptance.topology.requiredRefusals has to list exact source-located refusals and file hashes',
    );
  }
};

export const isCompletedZeroAcceptance = (acceptance) => acceptance?.type === 'completed_zero';

export const checkCompletedZeroAcceptanceDefinition = (entry, acceptance, problem) => {
  if (
    !hasExactFields(acceptance, [
      'type',
      'expectedAgentSystemDetected',
      'graphPopulation',
      'evidencePopulation',
      'evidenceCoverage',
      'componentMetricPopulation',
      'runtimePopulation',
      'adapterOutcomes',
      'unsupported',
      'topology',
      'findings',
    ])
  ) {
    problem('completed-zero acceptance has to declare exactly its bounded observed populations');
  }
  if (entry.source !== 'git' || entry.exercise !== undefined || entry.kind !== 'agent_system') {
    problem('completed-zero acceptance belongs to a static Git agent_system entry');
  }
  if (acceptance.expectedAgentSystemDetected !== false) {
    problem('completed-zero acceptance has to state expectedAgentSystemDetected false');
  }
  if (
    !hasExactFields(acceptance.graphPopulation, ['components', 'edges']) ||
    acceptance.graphPopulation.components !== 0 ||
    acceptance.graphPopulation.edges !== 0
  ) {
    problem(
      'completed-zero acceptance.graphPopulation has to state zero components and zero edges',
    );
  }
  if (
    !hasExactFields(acceptance.evidencePopulation, ['records']) ||
    acceptance.evidencePopulation.records !== 0
  ) {
    problem('completed-zero acceptance.evidencePopulation has to state zero evidence records');
  }
  if (
    !hasExactFields(acceptance.evidenceCoverage, [
      'totalEligible',
      'included',
      'omitted',
      'requiredIncluded',
      'omissionReasons',
    ]) ||
    !['totalEligible', 'included', 'omitted', 'requiredIncluded'].every(
      (field) => acceptance.evidenceCoverage[field] === 0,
    ) ||
    !Array.isArray(acceptance.evidenceCoverage.omissionReasons) ||
    acceptance.evidenceCoverage.omissionReasons.length !== 0
  ) {
    problem('completed-zero acceptance.evidenceCoverage has to state exact zero accounting');
  }
  if (
    !hasExactFields(acceptance.componentMetricPopulation, ['records']) ||
    acceptance.componentMetricPopulation.records !== 0
  ) {
    problem('completed-zero acceptance.componentMetricPopulation has to state zero metric records');
  }
  if (
    !hasExactFields(acceptance.runtimePopulation, ['runs', 'observed', 'silent']) ||
    acceptance.runtimePopulation.runs !== 0 ||
    !hasExactFields(acceptance.runtimePopulation.observed, ['count', 'runIds']) ||
    acceptance.runtimePopulation.observed.count !== 0 ||
    !Array.isArray(acceptance.runtimePopulation.observed.runIds) ||
    acceptance.runtimePopulation.observed.runIds.length !== 0 ||
    !hasExactFields(acceptance.runtimePopulation.silent, ['count', 'runIds']) ||
    acceptance.runtimePopulation.silent.count !== 0 ||
    !Array.isArray(acceptance.runtimePopulation.silent.runIds) ||
    acceptance.runtimePopulation.silent.runIds.length !== 0
  ) {
    problem('completed-zero acceptance.runtimePopulation has to state exact zero runs and run IDs');
  }
  checkAdapterOutcomes(acceptance.adapterOutcomes, problem);
  checkUnsupported(acceptance.unsupported, problem);
  checkTopology(acceptance.topology, problem);
  if (
    !hasExactFields(acceptance.findings, ['total', 'strengths']) ||
    acceptance.findings.total !== 0 ||
    acceptance.findings.strengths !== 0
  ) {
    problem('completed-zero acceptance.findings has to state zero findings and zero strengths');
  }
};
