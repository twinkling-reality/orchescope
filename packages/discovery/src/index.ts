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
  type ConfigDocument,
  type ConfigFormat,
  type ConfigProblem,
  KNOWN_CONFIG_PATHS,
  asRecord,
  asString,
  asStringArray,
  jsonPointer,
  readConfigDocuments,
  stripJsonComments,
} from './config-files.ts';
export { type ScanRequest, type ScanResult, discover } from './discover.ts';
export {
  GLOBAL_NAMESPACES,
  configIdentity,
  createDrafts,
  globalIdentity,
  sourceIdentity,
} from './drafts.ts';
export {
  type CallQuery,
  type MatchedCall,
  decoratedDefinitions,
  definitionForCall,
  importsAny,
  matchCalls,
  moduleMatches,
  projectUses,
} from './matching.ts';
export { DEFAULT_ADAPTERS, adapterById } from './registry.ts';
export {
  type ExternalRef,
  type SymbolIndex,
  type SymbolRef,
  buildSymbolIndex,
} from './symbol-index.ts';
