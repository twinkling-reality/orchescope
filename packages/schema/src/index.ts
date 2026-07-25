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
  GraphDelta,
  MetricDelta,
} from './comparison.ts';
export {
  type AgentDetails,
  type ApprovalDetails,
  Component,
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
  SideEffectClass,
  type ToolDetails,
} from './component.ts';
export {
  AnalysisConfig,
  OrchescopeConfig,
  PolicyConfig,
  RedactionConfig,
  ReportConfig,
  RuntimeConfig,
  SemanticAnalysisConfig,
} from './config.ts';
export {
  BackoffKind,
  Edge,
  EdgeKind,
  EdgeObservation,
  EdgePolicy,
} from './edge.ts';
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
  UnsupportedArea,
} from './graph.ts';
export {
  ComponentAlias,
  ComponentId,
  ComponentIdentity,
  EdgeId,
  IdentityContinuity,
} from './identity.ts';
export { Manifest, ManifestComponent, ManifestEdge } from './manifest.ts';
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
  Contradiction,
  DeclaredNotExercised,
  DuplicateSideEffect,
  ExercisedNotDeclared,
  ReconciliationDelta,
} from './reconciliation.ts';
export {
  DOCUMENT_SCHEMAS,
  type DocumentDescriptor,
  documentDescriptors,
} from './registry.ts';
export {
  Overlay,
  OverlayKind,
  ReportBundle,
  ReportCapability,
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
  ObservedCodeLocation,
  ObservedComponent,
  ObservedEdge,
  RuntimeTopology,
} from './runtime-topology.ts';
export {
  EffectExpectation,
  Evaluator,
  type EvaluatorKind,
  EvaluatorResult,
} from './evaluator.ts';
export {
  ResultSource,
  Scenario,
  ScenarioBudgets,
  ScenarioPermission,
  ScenarioTarget,
  ScenarioVariant,
} from './scenario.ts';
export { Reliability, RepetitionResult, ScenarioResult } from './scenario-result.ts';
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
