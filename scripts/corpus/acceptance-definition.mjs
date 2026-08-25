/** Validates the bounded, non-recordable semantic acceptance contract on a corpus entry. */

import { EDGE_KINDS } from '../../packages/schema/src/index.ts';
import {
  checkCompletedZeroAcceptanceDefinition,
  isCompletedZeroAcceptance,
} from './completed-zero-acceptance-definition.mjs';

const MAX_ITEMS = 64;
const MAX_TEXT = 256;
const PERMISSION_KINDS = new Set([
  'filesystem',
  'network',
  'process',
  'model',
  'secret',
  'database',
  'queue',
  'mcp',
]);
const PERMISSION_MODES = new Set(['read', 'write', 'execute']);

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

const isEvidenceAssertion = (value) =>
  hasExactFields(value, ['producer', 'symbol', 'sourceFile', 'startLine', 'endLine']) &&
  isBoundedString(value.producer) &&
  isBoundedString(value.symbol) &&
  isRelativePath(value.sourceFile) &&
  Number.isInteger(value.startLine) &&
  value.startLine > 0 &&
  Number.isInteger(value.endLine) &&
  value.endLine >= value.startLine;

const checkIdentities = (acceptance, problem) => {
  if (
    acceptance.graphPopulation !== undefined &&
    (!hasExactFields(acceptance.graphPopulation, ['components', 'edges']) ||
      !isNonNegativeInteger(acceptance.graphPopulation.components) ||
      !isNonNegativeInteger(acceptance.graphPopulation.edges))
  ) {
    problem('acceptance.graphPopulation has to state exact component and edge counts');
  }
  if (
    !isRecord(acceptance.exactIdsByKind) ||
    Object.keys(acceptance.exactIdsByKind).length === 0 ||
    Object.keys(acceptance.exactIdsByKind).length > MAX_ITEMS
  ) {
    problem('acceptance.exactIdsByKind has to hold at least one exact component population');
  } else {
    for (const [kind, ids] of Object.entries(acceptance.exactIdsByKind)) {
      if (
        !isBoundedString(kind) ||
        !isBoundedList(ids) ||
        ids.length === 0 ||
        ids.some((id) => !isBoundedString(id)) ||
        new Set(ids).size !== ids.length
      ) {
        problem(`acceptance.exactIdsByKind.${kind} has to list distinct component identities`);
      }
    }
  }
  for (const field of ['absentKinds', 'absentComponentTerms']) {
    const values = acceptance[field];
    if (
      !isBoundedList(values) ||
      values.length === 0 ||
      values.some((value) => !isBoundedString(value))
    ) {
      problem(`acceptance.${field} has to be a non-empty string list`);
    }
  }
  if (
    acceptance.absentEdgeKinds !== undefined &&
    (!isBoundedList(acceptance.absentEdgeKinds) ||
      acceptance.absentEdgeKinds.length === 0 ||
      acceptance.absentEdgeKinds.some(
        (value) => !isBoundedString(value) || !EDGE_KINDS.includes(value),
      ) ||
      new Set(acceptance.absentEdgeKinds).size !== acceptance.absentEdgeKinds.length)
  ) {
    problem('acceptance.absentEdgeKinds has to list distinct schema edge kinds');
  }
  if (
    Array.isArray(acceptance.absentComponentTerms) &&
    acceptance.absentComponentTerms.some((term) => term !== term.toLowerCase())
  ) {
    problem('acceptance.absentComponentTerms has to use lowercase terms');
  }
};

const checkRelations = (acceptance, problem) => {
  if (!isBoundedList(acceptance.requiredEdges)) {
    problem('acceptance.requiredEdges has to be a bounded list of source-cited relations');
    return;
  }
  if (
    acceptance.requiredEdges.length === 0 &&
    (acceptance.graphPopulation?.edges !== 0 ||
      acceptance.topology?.status !== 'incomplete' ||
      !Number.isInteger(acceptance.topology?.unresolvedCount) ||
      acceptance.topology.unresolvedCount <= 0 ||
      !isBoundedList(acceptance.topology?.requiredRefusals) ||
      acceptance.topology.requiredRefusals.length === 0 ||
      acceptance.topology.unresolvedCount < acceptance.topology.requiredRefusals.length ||
      !acceptance.topology.requiredRefusals.some(
        (refusal) => refusal?.kind === 'explicit_relation',
      ))
  ) {
    problem(
      'an empty acceptance.requiredEdges requires an exact zero-edge graphPopulation, incomplete positive-unresolved topology and a source-located explicit_relation refusal',
    );
  }
  for (const edge of acceptance.requiredEdges) {
    if (
      !hasExactFields(edge, ['kind', 'from', 'to', 'sourceFile', 'evidence']) ||
      ['kind', 'from', 'to'].some((field) => !isBoundedString(edge[field])) ||
      !isRelativePath(edge.sourceFile) ||
      !isBoundedList(edge.evidence) ||
      edge.evidence.length === 0 ||
      edge.evidence.some((evidence) => !isEvidenceAssertion(evidence))
    ) {
      problem(
        'each acceptance.requiredEdges entry has to name kind, endpoints, sourceFile and exact evidence',
      );
    }
  }
};

const checkScalarComponentMap = (value, field, problem) => {
  if (
    !isRecord(value) ||
    Object.keys(value).length === 0 ||
    Object.keys(value).length > MAX_ITEMS
  ) {
    problem(
      `acceptance.${field} has to hold expected component ${field.slice('component'.length).toLowerCase()}`,
    );
    return;
  }
  for (const [id, values] of Object.entries(value)) {
    const invalid =
      !isBoundedString(id) ||
      !isRecord(values) ||
      Object.keys(values).length === 0 ||
      Object.keys(values).length > MAX_ITEMS ||
      Object.values(values).some(
        (item) =>
          !['string', 'number', 'boolean'].includes(typeof item) ||
          (typeof item === 'string' && !isBoundedString(item)),
      );
    if (invalid) {
      problem(
        `acceptance.${field}.${id} has to hold scalar ${field === 'componentMetadata' ? 'metadata' : 'detail'} values`,
      );
    }
  }
};

const checkComponents = (acceptance, problem) => {
  checkScalarComponentMap(acceptance.componentMetadata, 'componentMetadata', problem);
  if (acceptance.componentDetails !== undefined) {
    checkScalarComponentMap(acceptance.componentDetails, 'componentDetails', problem);
  }
  if (
    !isRecord(acceptance.componentEvidence) ||
    Object.keys(acceptance.componentEvidence).length === 0 ||
    Object.keys(acceptance.componentEvidence).length > MAX_ITEMS
  ) {
    problem('acceptance.componentEvidence has to hold exact source evidence assertions');
  } else {
    for (const [id, assertions] of Object.entries(acceptance.componentEvidence)) {
      if (
        !isBoundedString(id) ||
        !isBoundedList(assertions) ||
        assertions.length === 0 ||
        assertions.some((assertion) => !isEvidenceAssertion(assertion))
      ) {
        problem(`acceptance.componentEvidence.${id} has to list exact source evidence`);
      }
    }
  }
  if (
    !isRecord(acceptance.sourceCitations) ||
    Object.keys(acceptance.sourceCitations).length === 0 ||
    Object.keys(acceptance.sourceCitations).length > MAX_ITEMS
  ) {
    problem('acceptance.sourceCitations has to map component identities to source files');
  } else if (
    Object.entries(acceptance.sourceCitations).some(
      ([id, files]) =>
        !isBoundedString(id) ||
        !isBoundedList(files) ||
        files.length === 0 ||
        files.some((file) => !isRelativePath(file)) ||
        new Set(files).size !== files.length,
    )
  ) {
    problem('acceptance.sourceCitations has to use distinct normalized repository-relative files');
  }
};

const checkComponentPermissions = (acceptance, problem) => {
  if (acceptance.componentPermissions === undefined) return;
  if (
    !isRecord(acceptance.componentPermissions) ||
    Object.keys(acceptance.componentPermissions).length === 0 ||
    Object.keys(acceptance.componentPermissions).length > MAX_ITEMS
  ) {
    problem('acceptance.componentPermissions has to hold exact permission populations');
    return;
  }
  for (const [id, permissions] of Object.entries(acceptance.componentPermissions)) {
    if (
      !isBoundedString(id) ||
      !isBoundedList(permissions) ||
      permissions.length === 0 ||
      permissions.some(
        (permission) =>
          !hasExactFields(permission, ['kind', 'scope', 'mode']) ||
          !PERMISSION_KINDS.has(permission.kind) ||
          !isBoundedString(permission.scope) ||
          !PERMISSION_MODES.has(permission.mode),
      ) ||
      new Set(
        permissions.map(
          (permission) => `${permission.kind}\u0000${permission.scope}\u0000${permission.mode}`,
        ),
      ).size !== permissions.length
    ) {
      problem(`acceptance.componentPermissions.${id} has to list distinct exact permission claims`);
    }
  }
};

const checkApplicability = (acceptance, problem) => {
  if (acceptance.adapterApplicability === undefined) {
    if (acceptance.adapterOutcomes === undefined) {
      problem('acceptance has to hold adapterApplicability or adapterOutcomes');
    }
    return;
  }
  if (
    !isRecord(acceptance.adapterApplicability) ||
    Object.keys(acceptance.adapterApplicability).length === 0 ||
    Object.keys(acceptance.adapterApplicability).length > MAX_ITEMS
  ) {
    problem('acceptance.adapterApplicability has to hold applicable producer populations');
    return;
  }
  for (const [adapterId, applicability] of Object.entries(acceptance.adapterApplicability)) {
    const invalid =
      !isBoundedString(adapterId) ||
      !adapterId.startsWith('adapter:') ||
      !hasExactFields(applicability, [
        'relevantImports',
        'distinctFiles',
        'omittedImports',
        'fileSample',
      ]) ||
      !['relevantImports', 'distinctFiles', 'omittedImports'].every((field) =>
        isNonNegativeInteger(applicability[field]),
      ) ||
      !isBoundedList(applicability.fileSample) ||
      applicability.fileSample.length === 0 ||
      applicability.fileSample.some(
        (sample) =>
          !hasExactFields(sample, ['module', 'imported', 'sourceFile', 'startLine']) ||
          !isBoundedString(sample.module) ||
          !isBoundedString(sample.imported) ||
          !isRelativePath(sample.sourceFile) ||
          !Number.isInteger(sample.startLine) ||
          sample.startLine <= 0,
      );
    if (invalid) {
      problem(
        `acceptance.adapterApplicability.${adapterId} has to count imports and list the exact file sample`,
      );
    }
  }
};

const checkRequiredUnclaimedImportedConstructions = (acceptance, problem) => {
  if (acceptance.requiredUnclaimedImportedConstructions === undefined) return;
  if (
    !isBoundedList(acceptance.requiredUnclaimedImportedConstructions) ||
    acceptance.requiredUnclaimedImportedConstructions.length === 0 ||
    acceptance.requiredUnclaimedImportedConstructions.some(
      (construction) =>
        !hasExactFields(construction, ['sourceFile', 'startLine']) ||
        !isRelativePath(construction.sourceFile) ||
        !Number.isInteger(construction.startLine) ||
        construction.startLine <= 0,
    )
  ) {
    problem(
      'acceptance.requiredUnclaimedImportedConstructions has to list exact source-located unclaimed imported constructions',
    );
  }
};

const checkAdapterOutcomes = (acceptance, problem) => {
  if (acceptance.adapterOutcomes === undefined) return;
  if (
    !isRecord(acceptance.adapterOutcomes) ||
    Object.keys(acceptance.adapterOutcomes).length === 0 ||
    Object.keys(acceptance.adapterOutcomes).length > MAX_ITEMS
  ) {
    problem('acceptance.adapterOutcomes has to hold exact contributing adapter populations');
    return;
  }
  for (const [adapterId, outcome] of Object.entries(acceptance.adapterOutcomes)) {
    if (
      !isBoundedString(adapterId) ||
      !adapterId.startsWith('adapter:') ||
      !hasExactFields(outcome, ['status', 'componentsFound', 'edgesFound', 'filesInspected']) ||
      !['completed', 'completed_zero'].includes(outcome.status) ||
      !['componentsFound', 'edgesFound', 'filesInspected'].every((field) =>
        isNonNegativeInteger(outcome[field]),
      )
    ) {
      problem(
        `acceptance.adapterOutcomes.${adapterId} has to state an exact completed adapter population`,
      );
    }
  }
};

const checkTopologyLists = (topology, problem) => {
  if (
    topology?.requiredUnlocatedRefusals !== undefined &&
    (!isBoundedList(topology.requiredUnlocatedRefusals) ||
      topology.requiredUnlocatedRefusals.length === 0 ||
      topology.requiredUnlocatedRefusals.some(
        (refusal) =>
          !hasExactFields(refusal, ['kind', 'reason']) ||
          !isBoundedString(refusal.kind) ||
          !isBoundedString(refusal.reason),
      ))
  ) {
    problem(
      'acceptance.topology.requiredUnlocatedRefusals has to list exact refusal reasons without invented locations',
    );
  }
  if (
    topology?.configurationBoundFacts !== undefined &&
    (!isBoundedList(topology.configurationBoundFacts) ||
      topology.configurationBoundFacts.length === 0 ||
      topology.configurationBoundFacts.some(
        (fact) =>
          !hasExactFields(fact, [
            'kind',
            'name',
            'value',
            'declarationFile',
            'declarationLine',
            'referenceFile',
            'referenceLine',
          ]) ||
          !['invocation_ceiling', 'static_default'].includes(fact.kind) ||
          !isBoundedString(fact.name) ||
          !Number.isInteger(fact.value) ||
          (fact.kind === 'invocation_ceiling' && fact.value <= 0) ||
          !isRelativePath(fact.declarationFile) ||
          !Number.isInteger(fact.declarationLine) ||
          fact.declarationLine <= 0 ||
          !isRelativePath(fact.referenceFile) ||
          !Number.isInteger(fact.referenceLine) ||
          fact.referenceLine <= 0,
      ))
  ) {
    problem(
      'acceptance.topology.configurationBoundFacts has to list exact source-located static defaults or invocation ceilings',
    );
  }
  if (
    topology?.producerPopulations !== undefined &&
    (!isBoundedList(topology.producerPopulations) ||
      topology.producerPopulations.length === 0 ||
      topology.producerPopulations.some((producer) => {
        const fields = [
          'adapterId',
          'status',
          'inspectedInputs',
          'relationsFound',
          ...(producer?.scope === undefined ? [] : ['scope']),
        ];
        return (
          !hasExactFields(producer, fields) ||
          !isBoundedString(producer.adapterId) ||
          !producer.adapterId.startsWith('adapter:') ||
          !['complete', 'incomplete'].includes(producer.status) ||
          !isNonNegativeInteger(producer.inspectedInputs) ||
          !isNonNegativeInteger(producer.relationsFound) ||
          (producer.scope !== undefined && !['control_flow', 'prompt_use'].includes(producer.scope))
        );
      }))
  ) {
    problem(
      'acceptance.topology.producerPopulations has to list exact inspected topology populations',
    );
  }
  if (
    topology?.requiredRefusals !== undefined &&
    (!isBoundedList(topology.requiredRefusals) ||
      topology.requiredRefusals.length === 0 ||
      topology.requiredRefusals.some(
        (refusal) =>
          !hasExactFields(refusal, ['kind', 'reason', 'sourceFile', 'startLine']) ||
          !isBoundedString(refusal.kind) ||
          !isBoundedString(refusal.reason) ||
          !isRelativePath(refusal.sourceFile) ||
          !Number.isInteger(refusal.startLine) ||
          refusal.startLine <= 0,
      ))
  ) {
    problem(
      'acceptance.topology.requiredRefusals has to list exact source-located refusal reasons',
    );
  }
};

const checkOutcome = (acceptance, problem) => {
  const topologyFields = [
    'status',
    'unresolvedCount',
    'conditionalDestinations',
    ...(acceptance.topology?.configurationBoundFacts === undefined
      ? []
      : ['configurationBoundFacts']),
    ...(acceptance.topology?.producerPopulations === undefined ? [] : ['producerPopulations']),
    ...(acceptance.topology?.requiredRefusals === undefined ? [] : ['requiredRefusals']),
    ...(acceptance.topology?.requiredUnlocatedRefusals === undefined
      ? []
      : ['requiredUnlocatedRefusals']),
  ];
  if (
    !hasExactFields(acceptance.topology, topologyFields) ||
    !isBoundedString(acceptance.topology.status) ||
    !isNonNegativeInteger(acceptance.topology.unresolvedCount) ||
    !isNonNegativeInteger(acceptance.topology.conditionalDestinations)
  ) {
    problem('acceptance.topology has to name status, unresolvedCount and conditionalDestinations');
  }
  checkTopologyLists(acceptance.topology, problem);
  const findingFields = [
    'strengths',
    'requiredRules',
    ...(acceptance.findings?.exactRisks === undefined ? [] : ['exactRisks']),
  ];
  if (
    !hasExactFields(acceptance.findings, findingFields) ||
    !isNonNegativeInteger(acceptance.findings.strengths) ||
    !isBoundedList(acceptance.findings.requiredRules) ||
    acceptance.findings.requiredRules.length === 0 ||
    acceptance.findings.requiredRules.some((ruleId) => !isBoundedString(ruleId))
  ) {
    problem('acceptance.findings has to count strengths and list requiredRules');
  }
  if (
    acceptance.findings?.exactRisks !== undefined &&
    (!isBoundedList(acceptance.findings.exactRisks) ||
      acceptance.findings.exactRisks.length === 0 ||
      acceptance.findings.exactRisks.some(
        (finding) =>
          !hasExactFields(finding, ['ruleId', 'severity']) ||
          !isBoundedString(finding.ruleId) ||
          !['critical', 'high', 'medium', 'low', 'info'].includes(finding.severity),
      ) ||
      new Set(
        acceptance.findings.exactRisks.map(
          (finding) => `${finding.ruleId}\u0000${finding.severity}`,
        ),
      ).size !== acceptance.findings.exactRisks.length)
  ) {
    problem('acceptance.findings.exactRisks has to list distinct exact ruleId and severity pairs');
  }
};

/** Adds every acceptance-definition problem to the owning corpus entry's problem collector. */
export const checkAcceptanceDefinition = (entry, problem) => {
  const acceptance = entry.acceptance;
  if (acceptance === undefined) return;
  if (!isRecord(acceptance)) {
    problem('acceptance has to be a mapping');
    return;
  }
  if (isCompletedZeroAcceptance(acceptance)) {
    checkCompletedZeroAcceptanceDefinition(entry, acceptance, problem);
    return;
  }
  const fields = [
    ...(acceptance.expectedAgentSystemDetected === undefined
      ? []
      : ['expectedAgentSystemDetected']),
    ...(acceptance.graphPopulation === undefined ? [] : ['graphPopulation']),
    'exactIdsByKind',
    'absentKinds',
    'absentComponentTerms',
    ...(acceptance.absentEdgeKinds === undefined ? [] : ['absentEdgeKinds']),
    'requiredEdges',
    'componentMetadata',
    ...(acceptance.componentDetails === undefined ? [] : ['componentDetails']),
    ...(acceptance.componentPermissions === undefined ? [] : ['componentPermissions']),
    'componentEvidence',
    'sourceCitations',
    ...(acceptance.adapterApplicability === undefined ? [] : ['adapterApplicability']),
    ...(acceptance.adapterOutcomes === undefined ? [] : ['adapterOutcomes']),
    ...(acceptance.requiredUnclaimedImportedConstructions === undefined
      ? []
      : ['requiredUnclaimedImportedConstructions']),
    'topology',
    'findings',
  ];
  if (!hasExactFields(acceptance, fields)) {
    problem(`acceptance has to declare exactly ${fields.join(', ')}`);
  }
  if (entry.source !== 'git' || entry.exercise !== undefined) {
    problem('acceptance belongs to a static Git entry');
  }
  if (
    acceptance.expectedAgentSystemDetected !== undefined &&
    (entry.kind !== 'agent_system' || acceptance.expectedAgentSystemDetected !== false)
  ) {
    problem(
      'acceptance.expectedAgentSystemDetected may be false only for a static Git agent_system with a bounded unsupported detection contract',
    );
  }
  if (
    acceptance.expectedAgentSystemDetected !== undefined &&
    acceptance.graphPopulation === undefined
  ) {
    problem(
      'acceptance.expectedAgentSystemDetected requires an exact graphPopulation for the bounded unsupported detection contract',
    );
  }
  if (
    acceptance.expectedAgentSystemDetected !== undefined &&
    (!isRecord(acceptance.adapterOutcomes) || Object.keys(acceptance.adapterOutcomes).length === 0)
  ) {
    problem(
      'acceptance.expectedAgentSystemDetected requires non-empty exact adapterOutcomes for the bounded unsupported detection contract',
    );
  }
  checkIdentities(acceptance, problem);
  checkRelations(acceptance, problem);
  checkComponents(acceptance, problem);
  checkComponentPermissions(acceptance, problem);
  checkApplicability(acceptance, problem);
  checkAdapterOutcomes(acceptance, problem);
  checkRequiredUnclaimedImportedConstructions(acceptance, problem);
  checkOutcome(acceptance, problem);
};
