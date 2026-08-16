/**
 * The instrumentation shim.
 *
 * Orchescope sets three OpenTelemetry variables on every traced process, and all three are inert unless
 * something in that process already loads an OpenTelemetry SDK. Essentially no Node project does by
 * default, which is why two independent sessions across thirty seven runs of real systems collected zero
 * spans between them, and why an audit is inventory for almost everyone. This package is what makes a run
 * produce evidence without asking its author to install anything.
 *
 * It is deliberately not the OpenTelemetry automatic instrumentation. That package emits HTTP, database and
 * framework spans, and reconciliation joins on `gen_ai.tool.name`, `gen_ai.agent.name`, `mcp.tool.name` and
 * `code.file.path`: a generic HTTP span joins to no declaration, so it would raise the span count without
 * moving the delta. What this emits is the vocabulary `@orchescope/traces` reads, which is the only
 * vocabulary that turns a run into an answer.
 *
 * The vocabulary comes from `@orchescope/traces/attributes` rather than from that package's index, so that
 * the names written here and the names read there cannot drift while the shim stays small. Reaching it
 * through the index pulls the wire decoder and the schema library in behind it, and the bundle this loads
 * into every traced process went from a few kilobytes to two hundred. The build asserts the ceiling.
 */

export { createExporter, type Exporter, type FinishedSpan } from './exporter.ts';
export { alreadyInstrumented, install, type Installation } from './install.ts';
export { type ProtocolCall, recogniseProtocolCall } from './json-rpc.ts';
export { type ModelCall, recogniseModelCall } from './model-endpoints.ts';
export { instrumentedFetch } from './outbound-fetch.ts';
export { type InstrumentationSettings, readSettings } from './settings.ts';
export {
  createTracer,
  SPAN_KIND_CLIENT,
  SPAN_KIND_INTERNAL,
  type SpanHandle,
  type Tracer,
} from './tracer.ts';
