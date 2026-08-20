/**
 * The Orchescope domain core.
 *
 * Pure logic only: identities, invariants, canonical serialisation, evidence construction, statistics,
 * deadlines and bounded parallelism. The only platform API used here is node:crypto, because content
 * addressing is a domain concern. Nothing in this package reads configuration, touches the
 * filesystem, opens a socket or writes to a terminal.
 */

export { partOfAuditedSystem } from './audited-system.ts';
export { canonicalJson, type JsonValue, stableJson } from './canonical-json.ts';
export { type Clock, fixedClock, formatTimestamp } from './clock.ts';
export { agree, formatCount } from './counting.ts';
export { partOfDeclaredTopology } from './declared-topology.ts';
export {
  type CostEstimate,
  estimateCost,
  type PriceTable,
  priceKey,
  type TokenPrice,
  type TokenUsage,
  totalKnownCost,
} from './cost.ts';
export {
  createDeadline,
  type Deadline,
  type DeadlineHandle,
  deadlineFrom,
  isCancellation,
  unboundedDeadline,
  withDeadline,
} from './deadline.ts';
export {
  asOrchescopeError,
  cancelledError,
  ERROR_CODES,
  type ErrorCategory,
  type ErrorCode,
  type ErrorDetail,
  errorCategory,
  isOrchescopeError,
  OrchescopeError,
  timeoutError,
} from './errors.ts';
export {
  absenceEvidence,
  configEntryEvidence,
  dedupeEvidence,
  dependencyEvidence,
  derivedEvidence,
  faultInjectionEvidence,
  metricEvidence,
  scenarioOutcomeEvidence,
  sourceSpanEvidence,
  spanEvidence,
} from './evidence.ts';
export { sha256Hex, sha256OfJson, shortHash, shortHashOfJson } from './hash.ts';
export {
  assignComponentIds,
  buildIdentity,
  componentId,
  configNamespace,
  edgeId,
  identitiesEqual,
  identityFingerprint,
  identityKey,
  isRenameOf,
  MANIFEST_NAMESPACE,
  moduleNamespace,
  normalizeLocalName,
  RUNTIME_NAMESPACE,
  runtimeIdentity,
} from './identity.ts';
export { INFERRED_ENTRY_POINT_TAG, isInferredEntryPoint } from './inferred-entry-point.ts';
export {
  artifactRef,
  benchmarkId,
  chaosReportId,
  comparisonId,
  evidenceId,
  faultPlanId,
  findingCategoryAbbreviation,
  findingId,
  goalId,
  graphId,
  parseGoalSequence,
  projectId,
  reportId,
  runId,
  scanId,
  scenarioResultId,
} from './ids.ts';
export {
  assertNoViolations,
  componentViolations,
  edgeViolations,
  findingViolations,
  type InvariantViolation,
  identitiesAreUnique,
} from './invariants.ts';
export {
  basisIsSupportable,
  type RunObservation,
  runIsSilent,
  runMeasuredNothing,
} from './observation.ts';
export { mapWithConcurrency, type ParallelOptions, settleWithConcurrency } from './parallel.ts';
export { decideByKey, type Rng, seededRng } from './random.ts';
export {
  basisStrength,
  CONFIDENCE_BANDS,
  capSeverity,
  compareSeverity,
  severityRank,
  strongerBasis,
} from './severity.ts';
export {
  differenceIsMeaningful,
  mean,
  quantile,
  relativeChange,
  standardDeviation,
  summarize,
} from './statistics.ts';
export { isTestFile } from './test-files.ts';
