/**
 * Report assembly and export. The bundle built here is what `--json`, MCP and CI exports return.
 */

export {
  type BuildBundleInput,
  buildReportBundle,
  type CapabilityInput,
} from './bundle.ts';
export {
  auditCommand,
  benchmarkCommand,
  chaosCommand,
  CLI,
  compareCommand,
  goalCommand,
  goalPromptCommand,
  importTraceCommand,
  manifestCommand,
  scenarioRepeatCommand,
  scenarioRunCommand,
  traceCommand,
} from './commands.ts';
export {
  type MermaidOptions,
  type SarifOptions,
  toMermaid,
  toSarif,
} from './exports.ts';
export { type LayoutResult, layoutGraph, type Position } from './layout.ts';
export {
  type CheckCoverage,
  checkCoverage,
  type LoopProgress,
  loopProgress,
  type LoopStep,
  type LoopStepId,
  type LoopStepState,
  ZERO_RISK_CAVEAT,
} from './loop-progress.ts';
export {
  type AdapterStatus,
  type NextAction,
  type ResolveNextActionInput,
  resolveNextAction,
} from './next-action.ts';
export { buildOverlays, type OverlayInput } from './overlays.ts';
