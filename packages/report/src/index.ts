/**
 * Report assembly and export. The bundle built here is what the browser workspace reads, what the standalone
 * export contains, and what the machine readable interfaces return.
 */

export {
  type BuildBundleInput,
  buildReportBundle,
  type CapabilityInput,
} from './bundle.ts';
export {
  type MermaidOptions,
  renderStandaloneHtml,
  type SarifOptions,
  type StandaloneAssets,
  toMermaid,
  toSarif,
} from './exports.ts';
export { type LayoutResult, layoutGraph, type Position } from './layout.ts';
export { buildOverlays, type OverlayInput } from './overlays.ts';
