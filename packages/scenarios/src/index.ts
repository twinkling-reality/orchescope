/**
 * Scenarios: what to run, how often, what must be true afterwards.
 *
 * A scenario is parsed from YAML, validated against the versioned schema, executed as a supervised process
 * with a loopback trace receiver, and judged by deterministic evaluators. Nothing here reads configuration
 * or the clock on its own: the policy, the clock and the deadline arrive as parameters, and the only module
 * that touches the filesystem is the loader.
 */

export type { ReportedEffect } from './effects.ts';
export { scenarioEnv } from './env.ts';
export { type EvaluationInput, evaluate } from './evaluate.ts';
export {
  type LoadedScenarios,
  loadScenarios,
  type ScenarioFile,
  type ScenarioProblem,
} from './load.ts';
export { parseScenario } from './parse.ts';
export type { ScenarioPolicy } from './policy.ts';
export { computeReliability } from './reliability.ts';
export {
  type RunScenarioInput,
  runScenario,
  runScenarioWithArtifacts,
  type ScenarioRunArtifacts,
} from './run.ts';
