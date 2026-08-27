/**
 * Application services.
 *
 * Each use case takes a workspace and explicit inputs, performs one product operation, and persists what it
 * produced. Command line rendering, HTTP handling and MCP tool shapes all live outside this package, so the same
 * operation behaves identically however it was invoked.
 */

export { type AuditRequest, type AuditResult, runAudit } from './audit.ts';
export { type RunBenchmarkRequest, runBenchmarkUseCase } from './benchmark.ts';
export { type CapabilityContext, resolveCapabilities } from './capabilities.ts';
export { type RunChaosRequest, runChaosUseCase } from './chaos.ts';
export { type CompareRequest, compareUseCase } from './compare.ts';
export { type Check, type CheckStatus, type DoctorResult, runDoctor } from './doctor.ts';
export { currentEnvironment } from './environment.ts';
export {
  type FederationRequest,
  type FederationResult,
  runFederation,
} from './federation.ts';
export {
  type CreateGoalRequest,
  type CreateGoalResult,
  createGoalFromFinding,
  type ValidateGoalRequest,
  type ValidateGoalResult,
  recordGoalReview,
  type RecordGoalReviewRequest,
  validateGoalOutcome,
} from './goal.ts';
export {
  discoverScenarios,
  type LoadScenarioRequest,
  loadScenario,
  type RunScenarioOutcome,
  type RunScenarioRequest,
  runScenarioUseCase,
} from './scenario.ts';
export { type ReceiveRequest, receiveTraces } from './receive.ts';
export { scenarioPolicyFrom } from './scenario-policy.ts';
export {
  type ImportTraceRequest,
  importTrace,
  runTrace,
  type TraceRequest,
  type InstrumentationOutcome,
  type TraceResult,
} from './trace.ts';
