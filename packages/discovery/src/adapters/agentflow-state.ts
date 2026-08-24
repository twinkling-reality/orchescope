import { identityKey } from '@orchescope/domain';
import type { SystemGraphBuilder } from '@orchescope/graph';
import type { ComponentIdentity, SourceLocation } from '@orchescope/schema';
import type {
  ArgumentFact,
  CallFact,
  DefinitionFact,
  ModuleFacts,
} from '@orchescope/source-analysis';
import type { DiscoveryContext, TopologyDiscovery } from '../adapter.ts';

export const REFUSAL_LIMIT = 12;

export type Topology = {
  status: 'complete' | 'incomplete';
  inspectedInputs: number;
  explicitRelations: number;
  conditionalConstructs: number;
  conditionalDestinations: number;
  entryBoundaries: number;
  entryTargets: ComponentIdentity[];
  terminalBoundaries: number;
  boundaryFacts: TopologyDiscovery['boundaryFacts'][number][];
  configurationBounds: number;
  configurationBoundFacts: TopologyDiscovery['configurationBoundFacts'][number][];
  unresolvedCount: number;
  unresolved: TopologyDiscovery['unresolved'][number][];
};

export type BoundComponent = {
  readonly module: ModuleFacts;
  readonly definition: DefinitionFact;
  readonly identity: ComponentIdentity;
  readonly call: CallFact;
};

export type Workflow = BoundComponent & {
  readonly steps: Map<string, ComponentIdentity>;
  readonly implementation: Map<string, ComponentIdentity>;
  readonly transitions: Array<{
    readonly from: ComponentIdentity;
    readonly to: ComponentIdentity;
    readonly location: SourceLocation;
    readonly symbol: string;
  }>;
  compiledAt?: SourceLocation;
  unsettledAt?: SourceLocation;
  readonly invocations: Array<{
    readonly module: ModuleFacts;
    readonly call: CallFact;
    readonly limit: InvocationLimit | 'unsettled' | undefined;
  }>;
};

export const topology = (): Topology => ({
  status: 'complete',
  inspectedInputs: 0,
  explicitRelations: 0,
  conditionalConstructs: 0,
  conditionalDestinations: 0,
  entryBoundaries: 0,
  entryTargets: [],
  terminalBoundaries: 0,
  boundaryFacts: [],
  configurationBounds: 0,
  configurationBoundFacts: [],
  unresolvedCount: 0,
  unresolved: [],
});

export const refuse = (
  state: Topology,
  reason: string,
  location: SourceLocation,
  kind: TopologyDiscovery['unresolved'][number]['kind'] = 'adapter_input',
): void => {
  state.status = 'incomplete';
  state.unresolvedCount += 1;
  if (state.unresolved.length < REFUSAL_LIMIT) state.unresolved.push({ kind, reason, location });
};

export const contains = (outer: SourceLocation, inner: SourceLocation): boolean => {
  const startsBefore =
    outer.startLine < inner.startLine ||
    (outer.startLine === inner.startLine && (outer.startColumn ?? 0) <= (inner.startColumn ?? 0));
  const outerEnd = outer.endLine ?? outer.startLine;
  const innerEnd = inner.endLine ?? inner.startLine;
  const endsAfter =
    outerEnd > innerEnd ||
    (outerEnd === innerEnd &&
      (outer.endColumn ?? Number.MAX_SAFE_INTEGER) >= (inner.endColumn ?? 0));
  return startsBefore && endsAfter;
};

export const endsBefore = (left: SourceLocation, right: SourceLocation): boolean => {
  const endLine = left.endLine ?? left.startLine;
  if (endLine !== right.startLine) return endLine < right.startLine;
  return (left.endColumn ?? left.startColumn ?? 0) <= (right.startColumn ?? 0);
};

export const locationKey = (location: SourceLocation | undefined): string =>
  location === undefined
    ? 'module'
    : `${location.file}:${location.startLine}:${location.startColumn ?? 0}:${location.endLine ?? location.startLine}:${location.endColumn ?? 0}`;

export const ownerKey = (definition: DefinitionFact): string =>
  `${definition.enclosing ?? 'module'}:${locationKey(definition.lexicalOwnerLocation)}`;

export const boundName = (definition: DefinitionFact): string =>
  definition.enclosing === undefined
    ? definition.name
    : `${definition.enclosing}.${definition.name}`;

export const samePath = (left: readonly string[] | undefined, right: readonly string[]): boolean =>
  left !== undefined &&
  left.length === right.length &&
  left.every((part, index) => part === right[index]);

export const sameOwner = (left: DefinitionFact, right: DefinitionFact): boolean =>
  ownerKey(left) === ownerKey(right);

export const argumentMentionCount = (value: ArgumentFact, name: string): number => {
  if (value.kind === 'identifier') return value.name === name ? 1 : 0;
  if (value.kind === 'member') return value.path[0] === name ? 1 : 0;
  if (value.kind === 'array') {
    return value.items.reduce((sum, item) => sum + argumentMentionCount(item, name), 0);
  }
  if (value.kind === 'call') {
    return value.args.reduce((sum, item) => sum + argumentMentionCount(item, name), 0);
  }
  if (value.kind === 'selection') {
    return value.alternatives.reduce(
      (sum, choice) => sum + argumentMentionCount(choice.value, name),
      0,
    );
  }
  if (value.kind !== 'object') return 0;
  return (
    value.entries.reduce((sum, entry) => sum + argumentMentionCount(entry.value, name), 0) +
    (value.spreads?.reduce((sum, spread) => sum + argumentMentionCount(spread.value, name), 0) ?? 0)
  );
};

export const argumentMentions = (value: ArgumentFact, name: string): boolean =>
  argumentMentionCount(value, name) > 0;

export const argumentUnsettled = (value: ArgumentFact): boolean => {
  if (value.kind === 'unknown') return true;
  if (value.kind === 'array') return value.items.some(argumentUnsettled);
  if (value.kind === 'call') return value.args.some(argumentUnsettled);
  if (value.kind === 'selection') {
    return value.alternatives.some((choice) => argumentUnsettled(choice.value));
  }
  if (value.kind !== 'object') return false;
  return (
    value.complete !== true ||
    value.entries.some((entry) => argumentUnsettled(entry.value)) ||
    value.spreads?.some((spread) => argumentUnsettled(spread.value)) === true
  );
};

export type DiscoveryState = {
  readonly context: DiscoveryContext;
  readonly builder: SystemGraphBuilder;
  readonly topology: Topology;
  readonly inspected: Set<string>;
  readonly agents: Map<string, BoundComponent>;
  readonly toolNodes: Map<string, BoundComponent>;
  readonly workflows: Map<string, Workflow>;
  readonly unstableAgents: Set<string>;
  readonly unstableToolNodes: Set<string>;
  readonly componentIds: Set<string>;
  readonly edgeIds: Set<string>;
  invocationBoundaries: number;
};

export const rememberComponent = (state: DiscoveryState, identity: ComponentIdentity): void => {
  state.componentIds.add(identityKey(identity));
};

export const rememberEdge = (
  state: DiscoveryState,
  kind: string,
  from: ComponentIdentity,
  to: ComponentIdentity,
): void => {
  state.edgeIds.add(`${kind}:${identityKey(from)}->${identityKey(to)}`);
};

export const isWorkflowMethod = (method: string | undefined): boolean =>
  method === 'add_node' ||
  method === 'add_edge' ||
  method === 'add_conditional_edges' ||
  method === 'set_entry_point' ||
  method === 'compile';

export const sameBranchPath = (binding: DefinitionFact, invocation: CallFact): boolean =>
  (binding.branches ?? []).every((branch) =>
    invocation.branches?.some(
      (candidate) =>
        candidate.operator === branch.operator &&
        candidate.branch === branch.branch &&
        locationKey(candidate.location) === locationKey(branch.location),
    ),
  );

export const bindingDominates = (binding: DefinitionFact, use: CallFact): boolean =>
  endsBefore(binding.location, use.location) && sameBranchPath(binding, use);

export type InvocationLimit = {
  readonly value: number;
  readonly reference: SourceLocation;
  readonly declaration: SourceLocation;
};
