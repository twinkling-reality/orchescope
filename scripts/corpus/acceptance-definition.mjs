/** Validates the bounded, non-recordable semantic acceptance contract on a corpus entry. */

const MAX_ITEMS = 64;
const MAX_TEXT = 256;

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
    Array.isArray(acceptance.absentComponentTerms) &&
    acceptance.absentComponentTerms.some((term) => term !== term.toLowerCase())
  ) {
    problem('acceptance.absentComponentTerms has to use lowercase terms');
  }
};

const checkRelations = (acceptance, problem) => {
  if (!isBoundedList(acceptance.requiredEdges) || acceptance.requiredEdges.length === 0) {
    problem('acceptance.requiredEdges has to list source-cited relations');
    return;
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

const checkComponents = (acceptance, problem) => {
  if (
    !isRecord(acceptance.componentMetadata) ||
    Object.keys(acceptance.componentMetadata).length === 0 ||
    Object.keys(acceptance.componentMetadata).length > MAX_ITEMS
  ) {
    problem('acceptance.componentMetadata has to hold expected component metadata');
  } else {
    for (const [id, metadata] of Object.entries(acceptance.componentMetadata)) {
      const invalid =
        !isBoundedString(id) ||
        !isRecord(metadata) ||
        Object.keys(metadata).length === 0 ||
        Object.keys(metadata).length > MAX_ITEMS ||
        Object.values(metadata).some(
          (value) =>
            !['string', 'number', 'boolean'].includes(typeof value) ||
            (typeof value === 'string' && !isBoundedString(value)),
        );
      if (invalid) {
        problem(`acceptance.componentMetadata.${id} has to hold scalar metadata values`);
      }
    }
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

const checkApplicability = (acceptance, problem) => {
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

const checkOutcome = (acceptance, problem) => {
  if (
    !hasExactFields(acceptance.topology, [
      'status',
      'unresolvedCount',
      'conditionalDestinations',
    ]) ||
    !isBoundedString(acceptance.topology.status) ||
    !isNonNegativeInteger(acceptance.topology.unresolvedCount) ||
    !isNonNegativeInteger(acceptance.topology.conditionalDestinations)
  ) {
    problem('acceptance.topology has to name status, unresolvedCount and conditionalDestinations');
  }
  if (
    !hasExactFields(acceptance.findings, ['strengths', 'requiredRules']) ||
    !isNonNegativeInteger(acceptance.findings.strengths) ||
    !isBoundedList(acceptance.findings.requiredRules) ||
    acceptance.findings.requiredRules.length === 0 ||
    acceptance.findings.requiredRules.some((ruleId) => !isBoundedString(ruleId))
  ) {
    problem('acceptance.findings has to count strengths and list requiredRules');
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
  const fields = [
    'exactIdsByKind',
    'absentKinds',
    'absentComponentTerms',
    'requiredEdges',
    'componentMetadata',
    'componentEvidence',
    'sourceCitations',
    'adapterApplicability',
    'topology',
    'findings',
  ];
  if (!hasExactFields(acceptance, fields)) {
    problem(`acceptance has to declare exactly ${fields.join(', ')}`);
  }
  if (entry.requiredArchive === undefined || entry.exercise !== undefined) {
    problem('acceptance belongs to a static required archive entry');
  }
  checkIdentities(acceptance, problem);
  checkRelations(acceptance, problem);
  checkComponents(acceptance, problem);
  checkApplicability(acceptance, problem);
  checkOutcome(acceptance, problem);
};
