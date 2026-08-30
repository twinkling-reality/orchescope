/**
 * Versioned data contracts for Orchescope.
 *
 * Everything persisted, exported or accepted from an untrusted source is defined here once, as a
 * TypeBox schema. The schema is the source of truth: TypeScript types are derived from it and the
 * JSON Schema files under `schemas/` are emitted from it.
 */

export {
  BenchmarkDimension,
  BenchmarkReport,
  Distribution,
  QUANTILE_MIN_SAMPLES,
  VariantResult,
} from './benchmark.ts';
export {
  ChaosEnvironment,
  ChaosOutcome,
  ChaosReport,
  FaultDelivery,
  FaultKind,
  FaultPlan,
  FaultSpec,
} from './chaos.ts';
export {
  Comparison,
  ComparisonSide,
  ComparisonSideKind,
  ComparisonVerdict,
  FindingDelta,
  FindingScaleChange,
  GraphDelta,
  MetricDelta,
} from './comparison.ts';
export {
  type AgentDetails,
  type ApprovalDetails,
  Component,
  COMPONENT_KINDS,
  ComponentDetails,
  ComponentKind,
  type McpServerDetails,
  type ModelDetails,
  Permission,
  PermissionKind,
  Presence,
  type PromptDetails,
  type QueueDetails,
  type RetrievalDetails,
  type ServiceDetails,
  SIDE_EFFECT_CLASSES,
  SideEffectClass,
  type ToolDetails,
} from './component.ts';
export {
  AnalysisConfig,
  OrchescopeConfig,
  ExecutionConfig,
  PolicyConfig,
  PricingConfig,
  RedactionConfig,
  ReportConfig,
  RuntimeConfig,
  TokenPrice,
} from './config.ts';
export {
  BackoffKind,
  Edge,
  EDGE_KINDS,
  EdgeKind,
  EdgeObservation,
  EdgePolicy,
} from './edge.ts';
export {
  EffectExpectation,
  Evaluator,
  type EvaluatorKind,
  EvaluatorResult,
} from './evaluator.ts';
export {
  AbsenceEvidence,
  Claim,
  ClaimBasis,
  ConfigEntryEvidence,
  ConfigLocation,
  DependencyEvidence,
  DerivedEvidence,
  Evidence,
  EvidenceId,
  type EvidenceKind,
  FaultInjectionEvidence,
  MeasuredValue,
  MetricEvidence,
  ModelInterpretationEvidence,
  ScenarioOutcomeEvidence,
  SourceLocation,
  SourceSpanEvidence,
  SpanEvidence,
} from './evidence.ts';
export {
  Finding,
  FindingCategory,
  FindingMetric,
  FindingPolarity,
  FindingSet,
  Recommendation,
  Severity,
  SuggestedExperiment,
} from './finding.ts';
export {
  FederatedComponentJoin,
  FederatedComponentReference,
  FederatedRelation,
  FederatedRepository,
  FederationRefusal,
  FederationRefusalReason,
  FederationRefusalSample,
  FederationReport,
  RepositoryCoordinate,
} from './federation.ts';
export {
  AcceptanceCriterion,
  Goal,
  GoalScope,
  GoalStatus,
  ValidationPlan,
} from './goal.ts';
export {
  AdapterRun,
  GraphProvenance,
  ScanCoverage,
  SkippedFile,
  SystemGraph,
  TopologyCoverage,
  UnsupportedArea,
} from './graph.ts';
export {
  ComponentAlias,
  ComponentId,
  ComponentIdentity,
  EdgeId,
  IdentityContinuity,
} from './identity.ts';
export {
  Manifest,
  ManifestComponent,
  ManifestEdge,
  ManifestV1,
  ManifestV2,
  MAX_MANIFEST_COMPONENTS,
} from './manifest.ts';
export {
  Confidence,
  Metadata,
  MetadataValue,
  NonNegativeInt,
  RelativePath,
  Sha256Hex,
  Timestamp,
} from './primitives.ts';
export {
  BehavioralAccount,
  BehavioralRelationRefusal,
  Contradiction,
  DeclaredNotExercised,
  DuplicateSideEffect,
  ExercisedNotDeclared,
  JoinSummary,
  ReconciliationDelta,
} from './reconciliation.ts';
export {
  DOCUMENT_SCHEMAS,
  type DocumentDescriptor,
  documentDescriptors,
} from './registry.ts';
export {
  EvidenceCoverage,
  GoalValidationSummary,
  Overlay,
  OverlayKind,
  ReportBundle,
  ReportCapability,
  ReportRunPopulations,
  ScenarioRunSummary,
} from './report.ts';
export {
  ComponentRunMetrics,
  RunEnvironment,
  RunKind,
  RunMetrics,
  RunRecord,
  RunStatus,
} from './run.ts';
export {
  MissingSpanAttribute,
  ObservedCodeLocation,
  ObservedComponent,
  ObservedContentLocation,
  ObservedEdge,
  ObservedSource,
  ObservedSourceIdentity,
  ObservedValueProvenance,
  RuntimeTopology,
} from './runtime-topology.ts';
export {
  RESULT_SOURCES,
  ResultSource,
  Scenario,
  ScenarioBudgets,
  SCENARIO_PERMISSIONS,
  ScenarioPermission,
  ScenarioTarget,
  ScenarioVariant,
} from './scenario.ts';
export { ScenarioRequirement } from './scenario-requirement.ts';
export { Reliability, RepetitionResult, ScenarioResult } from './scenario-result.ts';
export { TARGET_ENV, TargetResult } from './target-result.ts';
export {
  AgentOperation,
  NormalizedSpan,
  SideEffectRecord,
  SpanEvent,
  SpanKind,
  SpanStatus,
  TraceBundle,
  TraceSource,
} from './trace.ts';
export {
  compileChecker,
  formatIssues,
  type ValidationIssue,
  type ValidationResult,
  validate,
  validateDocument,
} from './validate.ts';
export {
  MIN_READABLE_VERSIONS,
  SCHEMA_VERSIONS,
  type SchemaName,
  schemaId,
} from './version.ts';
