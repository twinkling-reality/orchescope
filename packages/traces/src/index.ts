/**
 * Runtime evidence: OTLP decoding for both wire encodings, span normalisation, and derivation of the
 * observed runtime topology that graph reconciliation joins against the declared model.
 */

export {
  type Attributes,
  CODE,
  GEN_AI,
  MCP,
  OPEN_INFERENCE,
  ORCHESCOPE,
  VCS,
  classifyOperation,
  componentKindFor,
  observedNameFor,
  readBoolean,
  readNumber,
  readString,
} from './attributes.ts';
export {
  type NormalizeOptions,
  type NormalizedResult,
  mergeBundles,
  normalizeTraces,
} from './normalize.ts';
export {
  type DecodedTraceRequest,
  type RawResourceSpans,
  type RawScopeSpans,
  type RawSpan,
  decodeTraceJson,
  decodeTraceProtobuf,
} from './otlp.ts';
export { ProtobufError } from './protobuf.ts';
export { type TopologyResult, componentKey, deriveTopology } from './topology.ts';
