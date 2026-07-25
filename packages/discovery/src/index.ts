/**
 * Static discovery: manifests, configuration, source facts and framework adapters reduced to one system
 * graph with evidence and honest coverage.
 */

export type {
  AdapterFindings,
  AgentSystemAdapter,
  DiscoveryContext,
} from './adapter.ts';
export { classifyEffect } from './adapters/effects.ts';
export { type BindingRegistry, createBindingRegistry } from './bindings.ts';
export {
  asRecord,
  asString,
  asStringArray,
  type ConfigDocument,
  type ConfigFormat,
  type ConfigProblem,
  jsonPointer,
  KNOWN_CONFIG_PATHS,
  readConfigDocuments,
  stripJsonComments,
} from './config-files.ts';
export { discover, type ScanRequest, type ScanResult } from './discover.ts';
export {
  configIdentity,
  createDrafts,
  GLOBAL_NAMESPACES,
  globalIdentity,
  sourceIdentity,
} from './drafts.ts';
export {
  type CallQuery,
  decoratedDefinitions,
  definitionForCall,
  importsAny,
  type MatchedCall,
  matchCalls,
  moduleMatches,
  projectUses,
} from './matching.ts';
export { adapterById, DEFAULT_ADAPTERS } from './registry.ts';
export {
  buildSymbolIndex,
  type ExternalRef,
  type SymbolIndex,
  type SymbolRef,
} from './symbol-index.ts';
