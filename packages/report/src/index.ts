/**
 * Report assembly and export. The bundle built here is what `--json`, MCP and CI exports return.
 */

export {
  type BuildBundleInput,
  buildReportBundle,
  type CapabilityInput,
} from './bundle.ts';
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
export { buildOverlays, type OverlayInput } from './overlays.ts';
