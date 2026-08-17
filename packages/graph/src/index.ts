/**
 * The unified agent system graph: construction from adapter drafts, merging of duplicate facts,
 * reconciliation against observed runtime topology, the declared versus exercised delta, structural
 * analysis and graph diffing.
 */

export {
  controlFlowCycles,
  type DegreeStats,
  degrees,
  entryPoints,
  isControlFlowKind,
  isObservableKind,
  operationsPerformedBy,
  reachableFrom,
  unreachableComponents,
} from './analysis.ts';
export {
  computeDelta,
  type DeltaInput,
  type DeltaResult,
  type RunSideEffects,
} from './delta.ts';
export { diffGraphs } from './diff.ts';
export type { ComponentDraft, EdgeDraft } from './drafts.ts';
export {
  type BuiltGraph,
  componentIdIndex,
  type DiscardedEdge,
  SystemGraphBuilder,
} from './graph-builder.ts';
export { type IndexedGraph, indexGraph } from './indexed-graph.ts';
export {
  type AmbiguousMatch,
  type ComponentMatch,
  type MatchRule,
  type ReconcileResult,
  reconcile,
} from './reconcile.ts';
