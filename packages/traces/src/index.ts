/**
 * Runtime evidence: OTLP decoding for both wire encodings, span normalisation, and derivation of the
 * observed runtime topology that graph reconciliation joins against the declared model.
 */

export {
  type Attributes,
  CODE,
  classifyOperation,
  componentKindFor,
  GEN_AI,
  MCP,
  OPEN_INFERENCE,
  ORCHESCOPE,
  observedNameFor,
  readBoolean,
  readNumber,
  readString,
  REDERIVABLE_ATTRIBUTES,
  VCS,
} from './attributes.ts';
export {
  mergeBundles,
  type NormalizedResult,
  type NormalizeOptions,
  normalizeTraces,
} from './normalize.ts';
export {
  type DecodedTraceRequest,
  decodeTraceJson,
  decodeTraceProtobuf,
  type RawResourceSpans,
  type RawScopeSpans,
  type RawSpan,
} from './otlp.ts';
export { ProtobufError } from './protobuf.ts';
export { componentKey, deriveTopology, type TopologyResult } from './topology.ts';
