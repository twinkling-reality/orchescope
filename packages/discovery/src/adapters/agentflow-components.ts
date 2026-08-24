import { CONFIDENCE_BANDS } from '@orchescope/domain';
import type { SystemGraphBuilder } from '@orchescope/graph';
import type { ComponentIdentity } from '@orchescope/schema';
import type {
  ArgumentFact,
  CallFact,
  DefinitionFact,
  ModuleFacts,
  ObjectEntryFact,
} from '@orchescope/source-analysis';
import { dotted, findEntry, stringValue } from '@orchescope/source-analysis';
import type { DiscoveryContext } from '../adapter.ts';
import { createDrafts, GLOBAL_NAMESPACES, globalIdentity, sourceIdentity } from '../drafts.ts';
import { definitionForCall, matchRuntimeSymbol } from '../matching.ts';
import { addModelReference, splitModelReference } from '../model-reference.ts';
import { promptCallSupport, registerPromptEntries } from '../prompt-input.ts';
import {
  AGENTFLOW_ADAPTER_ID,
  AGENTFLOW_CORE_PACKAGES,
  agentflowImports,
} from './agentflow-origin.ts';
import {
  type BoundComponent,
  bindingDominates,
  boundName,
  contains,
  type DiscoveryState,
  endsBefore,
  locationKey,
  ownerKey,
  refuse,
  rememberComponent,
  rememberEdge,
  sameOwner,
  samePath,
  type Topology,
} from './agentflow-state.ts';

const drafts = createDrafts(AGENTFLOW_ADAPTER_ID);

export const directCallBinding = (
  module: ModuleFacts,
  call: CallFact,
): DefinitionFact | undefined => {
  const definition = definitionForCall(module, call);
  if (
    definition?.kind !== 'variable' ||
    !samePath(definition.initializer, call.calleePath) ||
    !contains(definition.location, call.location) ||
    module.calls.some(
      (other) =>
        other !== call &&
        contains(definition.location, other.location) &&
        contains(other.location, call.location),
    )
  ) {
    return undefined;
  }
  return definition;
};

export const directAssignedBinding = (
  module: ModuleFacts,
  call: CallFact,
): DefinitionFact | undefined => {
  const definition = directCallBinding(module, call);
  if (definition === undefined) return undefined;
  const competing = module.definitions.filter(
    (candidate) =>
      candidate.kind === 'variable' &&
      candidate.name === definition.name &&
      sameOwner(candidate, definition),
  );
  return competing.length === 1 ? definition : undefined;
};

export const directStableBinding = (
  module: ModuleFacts,
  call: CallFact,
): DefinitionFact | undefined => {
  const definition = directAssignedBinding(module, call);
  if (definition === undefined) return undefined;
  const changed = module.assignments.some(
    (assignment) =>
      assignment.target[0] === definition.name &&
      locationKey(assignment.enclosingLocation) === locationKey(definition.lexicalOwnerLocation),
  );
  return changed ? undefined : definition;
};

export const exactRuntimeCall = (
  context: DiscoveryContext,
  module: ModuleFacts,
  call: CallFact,
  name: string,
): boolean =>
  matchRuntimeSymbol(
    context.modules,
    module,
    {
      path: call.calleePath,
      origin: call.origin,
      enclosing: call.enclosing,
      location: call.location,
    },
    { names: [name], packages: AGENTFLOW_CORE_PACKAGES },
  )?.resolved === true;

export const entriesOf = (call: CallFact): readonly ObjectEntryFact[] => {
  for (let index = call.args.length - 1; index >= 0; index -= 1) {
    const argument = call.args[index];
    if (argument?.kind === 'object') return argument.entries;
  }
  return [];
};

export const receiverKey = (module: ModuleFacts, definition: DefinitionFact): string =>
  `${module.file}:${ownerKey(definition)}:${definition.name}`;

export const matchingReceiver = <T extends BoundComponent>(
  module: ModuleFacts,
  call: CallFact,
  bindings: ReadonlyMap<string, T>,
): T | undefined => {
  const receiver = call.calleePath[0];
  if (receiver === undefined || call.calleePath.length !== 2) return undefined;
  const definitions = module.definitions.filter(
    (definition) =>
      definition.kind === 'variable' &&
      definition.name === receiver &&
      definition.enclosing === call.enclosing &&
      bindingDominates(definition, call) &&
      (definition.lexicalOwnerLocation === undefined ||
        contains(definition.lexicalOwnerLocation, call.location)),
  );
  if (definitions.length !== 1 || definitions[0] === undefined) return undefined;
  return bindings.get(receiverKey(module, definitions[0]));
};

export const argumentIdentity = (
  module: ModuleFacts,
  owner: DefinitionFact,
  use: CallFact,
  argument: ArgumentFact | undefined,
  bindings: ReadonlyMap<string, BoundComponent>,
): ComponentIdentity | undefined => {
  if (argument?.kind !== 'identifier') return undefined;
  const binding = bindings.get(`${module.file}:${ownerKey(owner)}:${argument.name}`);
  return binding !== undefined && bindingDominates(binding.definition, use)
    ? binding.identity
    : undefined;
};

export const addConstruction = (input: {
  readonly context: DiscoveryContext;
  readonly builder: SystemGraphBuilder;
  readonly state: Topology;
  readonly module: ModuleFacts;
  readonly call: CallFact;
  readonly kind: 'agent' | 'tool' | 'workflow';
  readonly runtimeName: 'Agent' | 'ToolNode' | 'StateGraph';
}): BoundComponent | undefined => {
  input.state.inspectedInputs += 1;
  const definition = directStableBinding(input.module, input.call);
  if (definition === undefined) {
    refuse(
      input.state,
      `AgentFlow ${input.runtimeName} was not assigned to one unchanged direct local binding.`,
      input.call.location,
    );
    return undefined;
  }
  const name = boundName(definition);
  const identity = sourceIdentity(input.kind, input.module.file, name);
  input.builder.addComponent(
    drafts.sourceComponent({
      kind: input.kind,
      identity,
      file: input.module.file,
      name,
      displayName: definition.name,
      location: input.call.location,
      symbol: dotted(input.call.calleePath),
      confidence: CONFIDENCE_BANDS.deterministic,
      ...(input.kind === 'agent' ? { details: { for: 'agent', role: 'unspecified' } } : {}),
      ...(input.kind === 'tool' ? { details: { for: 'tool' } } : {}),
      metadata: {
        framework: 'agentflow',
        sourceBinding: definition.name,
        runtimeType: input.runtimeName,
      },
      tags: ['agentflow'],
    }),
  );
  input.context.bindings.register(input.module.file, definition.name, identity);
  return { module: input.module, definition, identity, call: input.call };
};

export const literalDestination = (
  context: DiscoveryContext,
  module: ModuleFacts,
  call: CallFact,
  value: ArgumentFact | undefined,
): string | 'END' | undefined => {
  const literal = stringValue(value);
  if (literal !== undefined) return literal;
  if (value?.kind !== 'identifier' && value?.kind !== 'member') return undefined;
  const path = value.kind === 'identifier' ? [value.name] : value.path;
  const imported = module.imports.find((entry) => entry.local === path[0]);
  const matched = matchRuntimeSymbol(
    context.modules,
    module,
    {
      path,
      origin:
        imported === undefined
          ? undefined
          : {
              module: imported.module,
              imported: imported.imported,
              isType: imported.isType,
            },
      enclosing: call.enclosing,
      location: call.location,
    },
    { names: ['END'], packages: ['agentflow.utils.constants'] },
  );
  return matched?.resolved === true ? 'END' : undefined;
};

export const discoverAgentInputs = (state: DiscoveryState, agent: BoundComponent): void => {
  const entries = entriesOf(agent.call);
  const modelEntry = findEntry(entries, 'model');
  const providerEntry = findEntry(entries, 'provider');
  const model = stringValue(modelEntry?.value);
  const provider = stringValue(providerEntry?.value);
  if (model !== undefined) {
    const added = addModelReference({
      drafts,
      builder: state.builder,
      declared: provider === undefined ? model : `${provider}:${model}`,
      file: agent.module.file,
      location: modelEntry?.location ?? agent.call.location,
      framework: 'agentflow',
      invokedBy: agent.identity,
      confidence: CONFIDENCE_BANDS.deterministic,
    });
    rememberComponent(state, added.identity);
    rememberEdge(state, 'invokes_model', agent.identity, added.identity);
    const reference = splitModelReference(provider === undefined ? model : `${provider}:${model}`);
    if (reference.provider !== undefined) {
      const providerIdentity = globalIdentity(
        'provider',
        GLOBAL_NAMESPACES.provider,
        reference.provider,
      );
      rememberComponent(state, providerIdentity);
      rememberEdge(state, 'served_by_provider', added.identity, providerIdentity);
    }
  } else if (modelEntry !== undefined) {
    refuse(
      state.topology,
      'AgentFlow model input was computed, so no exact model identity was claimed.',
      modelEntry.location,
    );
  }
  if (providerEntry !== undefined && provider === undefined) {
    refuse(
      state.topology,
      'AgentFlow provider input was computed, so no exact provider identity was claimed.',
      providerEntry.location,
    );
  }
  registerPromptEntries({
    registry: state.context.promptInputs,
    producer: AGENTFLOW_ADAPTER_ID,
    module: agent.module,
    call: agent.call,
    consumer: agent.identity,
    entries,
    channels: ['system_prompt'],
    supportingLocations: promptCallSupport(agent.module, agent.call),
  });
};

export const toolDefinitionAt = (
  state: DiscoveryState,
  toolNode: BoundComponent,
  name: string,
): { readonly file: string; readonly definition: DefinitionFact } | undefined => {
  const module = toolNode.module;
  const use = toolNode.call.location;
  const containingCallables = module.definitions.filter(
    (definition) =>
      (definition.kind === 'function' || definition.kind === 'method') &&
      contains(definition.location, use),
  );
  if (
    containingCallables.some(
      (definition) => definition.parameters?.some((parameter) => parameter.name === name) === true,
    ) ||
    module.definitions.some(
      (definition) =>
        definition.kind === 'variable' &&
        definition.name === name &&
        (definition.enclosing === undefined ||
          containingCallables.some((scope) => contains(scope.location, definition.location))),
    ) ||
    module.assignments.some(
      (assignment) =>
        assignment.target[0] === name &&
        (assignment.enclosing === undefined || assignment.enclosing === toolNode.call.enclosing),
    )
  ) {
    return undefined;
  }
  const localFunctions = module.definitions.filter(
    (definition) =>
      definition.kind === 'function' &&
      (definition.name.split('.').at(-1) ?? definition.name) === name &&
      endsBefore(definition.location, use) &&
      (definition.enclosing === undefined ||
        (definition.lexicalOwnerLocation !== undefined &&
          contains(definition.lexicalOwnerLocation, use))),
  );
  const nearest = localFunctions.filter(
    (candidate) =>
      !localFunctions.some(
        (other) =>
          other !== candidate &&
          other.lexicalOwnerLocation !== undefined &&
          candidate.lexicalOwnerLocation !== undefined &&
          contains(candidate.lexicalOwnerLocation, other.lexicalOwnerLocation),
      ),
  );
  if (nearest.length === 1 && nearest[0] !== undefined) {
    return { file: module.file, definition: nearest[0] };
  }
  if (nearest.length > 1) return undefined;
  const resolved = state.context.symbols.resolve(module.file, name);
  if (
    resolved?.definition?.kind !== 'function' ||
    (resolved.file === module.file && !endsBefore(resolved.definition.location, use))
  ) {
    return undefined;
  }
  const definitions = state.context.symbols
    .definitionsOf(resolved.file)
    .filter(
      (definition) =>
        definition.kind === 'function' && definition.name === resolved.definition?.name,
    );
  return definitions.length === 1 && definitions[0] !== undefined
    ? { file: resolved.file, definition: definitions[0] }
    : undefined;
};

export const discoverToolPopulation = (state: DiscoveryState, toolNode: BoundComponent): void => {
  const population = toolNode.call.args[0];
  if (population?.kind !== 'array') {
    refuse(
      state.topology,
      'AgentFlow ToolNode tool population was computed, so individual tool identities were not invented.',
      toolNode.call.location,
    );
    return;
  }
  for (const item of population.items) {
    if (item.kind !== 'identifier') {
      refuse(
        state.topology,
        'AgentFlow ToolNode contains a tool whose local implementation was not source-settled.',
        toolNode.call.location,
      );
      continue;
    }
    const settled = toolDefinitionAt(state, toolNode, item.name);
    if (settled === undefined) {
      refuse(
        state.topology,
        `AgentFlow ToolNode tool ${item.name} has no unique local function implementation.`,
        toolNode.call.location,
      );
      continue;
    }
    const { file, definition } = settled;
    const identity = sourceIdentity('tool', file, definition.name);
    state.builder.addComponent(
      drafts.sourceComponent({
        kind: 'tool',
        identity,
        file,
        name: definition.name,
        location: definition.location,
        symbol: item.name,
        details: { for: 'tool' },
        metadata: { framework: 'agentflow', declaredName: definition.name },
        tags: ['agentflow'],
      }),
    );
    state.builder.addEdge(
      drafts.edge({
        kind: 'calls_tool',
        from: toolNode.identity,
        to: identity,
        location: toolNode.call.location,
        symbol: item.name,
      }),
    );
    state.context.bindings.register(file, definition.name, identity);
    state.context.implementations.record({
      identity,
      file,
      body: definition.location,
      symbol: item.name,
    });
    rememberComponent(state, identity);
    rememberEdge(state, 'calls_tool', toolNode.identity, identity);
  }
};

export const discoverConstructions = (state: DiscoveryState): void => {
  for (const module of state.context.modules) {
    if (agentflowImports(state.context, module).length === 0) continue;
    state.inspected.add(module.file);
    for (const call of module.calls) {
      const runtimeName = (['Agent', 'ToolNode', 'StateGraph'] as const).find((name) =>
        exactRuntimeCall(state.context, module, call, name),
      );
      if (runtimeName === undefined) continue;
      const kind =
        runtimeName === 'Agent' ? 'agent' : runtimeName === 'ToolNode' ? 'tool' : 'workflow';
      const construction = addConstruction({
        context: state.context,
        builder: state.builder,
        state: state.topology,
        module,
        call,
        kind,
        runtimeName,
      });
      if (construction === undefined) continue;
      rememberComponent(state, construction.identity);
      const key = receiverKey(module, construction.definition);
      if (runtimeName === 'Agent') {
        state.agents.set(key, construction);
      } else if (runtimeName === 'ToolNode') {
        state.toolNodes.set(key, construction);
      } else {
        state.workflows.set(key, {
          ...construction,
          steps: new Map(),
          implementation: new Map(),
          transitions: [],
          invocations: [],
        });
      }
    }
  }
};
