import type { ComponentIdentity, SourceLocation } from '@orchescope/schema';
import type {
  ArgumentFact,
  CallFact,
  DefinitionFact,
  ModuleFacts,
  ObjectEntryFact,
} from '@orchescope/source-analysis';
import { findEntry } from '@orchescope/source-analysis';
import type { DiscoveryContext, TopologyDiscovery } from '../adapter.ts';
import { sourceIdentity } from '../drafts.ts';
import { definitionForCall, hasBindingAt } from '../matching.ts';
import {
  exactLegacyAgentCall,
  LANGCHAIN_LEGACY_EXECUTOR_EXPORT,
  LANGCHAIN_LEGACY_FACTORY_EXPORT,
} from './langchain-legacy-agent-origin.ts';

type Refusal = TopologyDiscovery['unresolved'][number];

export type LegacyTemplate = {
  readonly module: ModuleFacts;
  readonly definition: DefinitionFact;
  readonly factoryCall: CallFact;
  readonly executorCall: CallFact;
  readonly modelParameter?: string;
  readonly toolsParameter?: string;
  readonly promptParameter?: string;
};

export type LegacyConstruction = {
  readonly module: ModuleFacts;
  readonly identity: ComponentIdentity;
  readonly sourceName: string;
  readonly definition: DefinitionFact;
  readonly call: CallFact;
  readonly factoryCall: CallFact;
  readonly executorCall: CallFact;
  readonly template?: LegacyTemplate;
  readonly model: ArgumentFact | undefined;
  readonly tools: ArgumentFact | undefined;
  readonly prompt: ArgumentFact | undefined;
};

export type LegacySettlement = {
  readonly constructions: readonly LegacyConstruction[];
  readonly consumedCalls: ReadonlySet<CallFact>;
  readonly refusals: readonly Refusal[];
};

const samePath = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((segment, index) => segment === right[index]);

const startsAtOrBefore = (left: SourceLocation, right: SourceLocation): boolean =>
  left.startLine < right.startLine ||
  (left.startLine === right.startLine && (left.startColumn ?? 0) <= (right.startColumn ?? 0));

const endsAtOrAfter = (left: SourceLocation, right: SourceLocation): boolean => {
  const leftLine = left.endLine ?? left.startLine;
  const rightLine = right.endLine ?? right.startLine;
  return (
    leftLine > rightLine ||
    (leftLine === rightLine &&
      (left.endColumn ?? Number.MAX_SAFE_INTEGER) >= (right.endColumn ?? 0))
  );
};

const contains = (container: SourceLocation, contained: SourceLocation): boolean =>
  startsAtOrBefore(container, contained) && endsAtOrAfter(container, contained);

const sameRange = (left: SourceLocation, right: SourceLocation): boolean =>
  left.file === right.file &&
  left.startLine === right.startLine &&
  left.startColumn === right.startColumn &&
  left.endLine === right.endLine &&
  left.endColumn === right.endColumn;

const strictlyContains = (container: SourceLocation, contained: SourceLocation): boolean =>
  !sameRange(container, contained) && contains(container, contained);

const endsBefore = (left: SourceLocation, right: SourceLocation): boolean => {
  const leftLine = left.endLine ?? left.startLine;
  if (leftLine !== right.startLine) return leftLine < right.startLine;
  return (left.endColumn ?? Number.MAX_SAFE_INTEGER) <= (right.startColumn ?? 0);
};

const leaf = (name: string): string => name.split('.').at(-1) ?? name;

const keywordEntries = (call: CallFact): readonly ObjectEntryFact[] => {
  const argument = call.args.at(-1);
  return argument?.kind === 'object' && argument.role === 'keywords' ? argument.entries : [];
};

export const legacyDirectDefinition = (
  module: ModuleFacts,
  call: CallFact,
): DefinitionFact | undefined => {
  const definition = definitionForCall(module, call);
  return definition?.kind === 'variable' &&
    definition.initializer !== undefined &&
    samePath(definition.initializer, call.calleePath) &&
    !module.calls.some(
      (candidate) =>
        strictlyContains(definition.location, candidate.location) &&
        strictlyContains(candidate.location, call.location),
    )
    ? definition
    : undefined;
};

const directCallIn = (
  context: DiscoveryContext,
  module: ModuleFacts,
  definition: DefinitionFact,
  name: typeof LANGCHAIN_LEGACY_FACTORY_EXPORT | typeof LANGCHAIN_LEGACY_EXECUTOR_EXPORT,
): CallFact | undefined => {
  const calls = module.calls.filter(
    (call) =>
      contains(definition.location, call.location) &&
      exactLegacyAgentCall(context, module, call, name),
  );
  return calls.length === 1 ? calls[0] : undefined;
};

const stableDefinitionIn = (
  module: ModuleFacts,
  owner: DefinitionFact,
  definition: DefinitionFact | undefined,
): DefinitionFact | undefined => {
  if (definition?.kind !== 'variable' || !contains(owner.location, definition.location)) {
    return undefined;
  }
  const peers = module.definitions.filter(
    (candidate) =>
      candidate.kind === 'variable' &&
      candidate.name === definition.name &&
      candidate.enclosing === definition.enclosing &&
      contains(owner.location, candidate.location),
  );
  const changed = module.assignments.some(
    (assignment) =>
      assignment.target[0] === definition.name &&
      assignment.enclosing === definition.enclosing &&
      contains(owner.location, assignment.location),
  );
  return peers.length === 1 && !changed ? definition : undefined;
};

const identifier = (value: ArgumentFact | undefined): string | undefined =>
  value?.kind === 'identifier' ? value.name : undefined;

export const legacyArgumentMentions = (value: ArgumentFact, name: string): boolean => {
  if (value.kind === 'identifier') return value.name === name;
  if (value.kind === 'member') return value.path[0] === name;
  if (value.kind === 'array') {
    return value.items.some((item) => legacyArgumentMentions(item, name));
  }
  if (value.kind === 'call') {
    return value.args.some((item) => legacyArgumentMentions(item, name));
  }
  if (value.kind === 'selection') {
    return value.alternatives.some((choice) => legacyArgumentMentions(choice.value, name));
  }
  if (value.kind !== 'object') return false;
  return (
    value.entries.some((entry) => legacyArgumentMentions(entry.value, name)) ||
    value.spreads?.some((spread) => legacyArgumentMentions(spread.value, name)) === true
  );
};

const parameterPopulationStable = (
  module: ModuleFacts,
  owner: DefinitionFact,
  parameter: string,
  allowedCalls: ReadonlySet<CallFact>,
): boolean => {
  if (
    module.assignments.some(
      (assignment) =>
        contains(owner.location, assignment.location) &&
        (assignment.target[0] === parameter || legacyArgumentMentions(assignment.value, parameter)),
    )
  ) {
    return false;
  }
  if (
    module.definitions.some(
      (definition) =>
        definition.kind === 'variable' &&
        contains(owner.location, definition.location) &&
        (definition.name === parameter ||
          (definition.value !== undefined &&
            legacyArgumentMentions(definition.value, parameter) &&
            ![...allowedCalls].some((call) => contains(definition.location, call.location)))),
    )
  ) {
    return false;
  }
  return !module.calls.some(
    (call) =>
      contains(owner.location, call.location) &&
      !allowedCalls.has(call) &&
      (call.calleePath[0] === parameter ||
        call.args.some((argument) => legacyArgumentMentions(argument, parameter))),
  );
};

const templateFor = (
  context: DiscoveryContext,
  module: ModuleFacts,
  definition: DefinitionFact,
): LegacyTemplate | undefined => {
  if (definition.async || definition.decorators.length > 0) return undefined;
  const factoryCall = directCallIn(context, module, definition, LANGCHAIN_LEGACY_FACTORY_EXPORT);
  const executorCall = directCallIn(context, module, definition, LANGCHAIN_LEGACY_EXECUTOR_EXPORT);
  if (factoryCall === undefined || executorCall === undefined) return undefined;

  const agentDefinition = stableDefinitionIn(
    module,
    definition,
    legacyDirectDefinition(module, factoryCall),
  );
  const executorDefinition = stableDefinitionIn(
    module,
    definition,
    legacyDirectDefinition(module, executorCall),
  );
  const entries = keywordEntries(executorCall);
  const agentName = identifier(findEntry(entries, 'agent')?.value);
  const executorTools = identifier(findEntry(entries, 'tools')?.value);
  const modelParameter = identifier(factoryCall.args[0]);
  const toolsParameter = identifier(factoryCall.args[1]);
  const parameterNames = new Set(definition.parameters?.map((parameter) => parameter.name) ?? []);
  const promptName = identifier(factoryCall.args[2]);
  const promptParameter =
    promptName !== undefined && parameterNames.has(promptName) ? promptName : undefined;
  const toolsAreStable =
    toolsParameter !== undefined &&
    parameterPopulationStable(
      module,
      definition,
      toolsParameter,
      new Set([factoryCall, executorCall]),
    );
  const modelIsStable =
    modelParameter !== undefined &&
    parameterPopulationStable(
      module,
      definition,
      modelParameter,
      new Set([factoryCall, executorCall]),
    );
  const promptIsStable =
    promptParameter !== undefined &&
    parameterPopulationStable(
      module,
      definition,
      promptParameter,
      new Set([factoryCall, executorCall]),
    );
  const returnsExecutor =
    executorDefinition !== undefined &&
    agentDefinition !== undefined &&
    endsBefore(agentDefinition.location, executorCall.location) &&
    definition.returns !== undefined &&
    definition.returns.length > 0 &&
    definition.returns.some((returned) => returned.predicate === undefined) &&
    definition.returns.every(
      (returned) =>
        endsBefore(executorDefinition.location, returned.location) &&
        returned.value.kind === 'identifier' &&
        returned.value.name === executorDefinition.name,
    );
  if (
    agentDefinition === undefined ||
    executorDefinition === undefined ||
    agentName !== agentDefinition.name ||
    modelParameter === undefined ||
    toolsParameter === undefined ||
    executorTools !== toolsParameter ||
    !parameterNames.has(modelParameter) ||
    !parameterNames.has(toolsParameter) ||
    factoryCall.args[2] === undefined ||
    !returnsExecutor
  ) {
    return undefined;
  }
  return {
    module,
    definition,
    factoryCall,
    executorCall,
    ...(modelIsStable ? { modelParameter } : {}),
    ...(toolsAreStable ? { toolsParameter } : {}),
    ...(promptIsStable ? { promptParameter } : {}),
  };
};

const stableConstructionDefinition = (
  module: ModuleFacts,
  call: CallFact,
): DefinitionFact | undefined => {
  const definition = legacyDirectDefinition(module, call);
  if (definition === undefined) return undefined;
  const duplicates = module.definitions.filter(
    (candidate) =>
      candidate.kind === 'variable' &&
      candidate.name === definition.name &&
      candidate.enclosing === definition.enclosing,
  );
  const assigned = module.assignments.some(
    (assignment) =>
      assignment.target.length === 1 &&
      assignment.target[0] === definition.name &&
      assignment.enclosing === definition.enclosing,
  );
  return duplicates.length === 1 && !assigned ? definition : undefined;
};

const sourceNameOf = (definition: DefinitionFact): string =>
  definition.enclosing === undefined
    ? definition.name
    : `${definition.enclosing}.${leaf(definition.name)}`;

const callArgumentFor = (
  call: CallFact,
  template: LegacyTemplate,
  parameter: string | undefined,
): ArgumentFact | undefined => {
  if (parameter === undefined) return undefined;
  const index =
    template.definition.parameters?.findIndex((entry) => entry.name === parameter) ?? -1;
  return index < 0 ? undefined : call.args[index];
};

const wrapperCallCandidates = (
  module: ModuleFacts,
  template: LegacyTemplate,
): readonly CallFact[] => {
  const name = leaf(template.definition.name);
  return module.calls.filter(
    (call) =>
      call.origin === undefined &&
      call.calleePath.length === 1 &&
      call.calleePath[0] === name &&
      endsBefore(template.definition.location, call.location),
  );
};

export const legacyWrapperBindingHolds = (
  module: ModuleFacts,
  template: LegacyTemplate,
  call: CallFact,
): boolean => {
  const name = leaf(template.definition.name);
  const definitions = module.definitions.filter(
    (definition) => definition.kind === 'function' && leaf(definition.name) === name,
  );
  if (definitions.length !== 1 || definitions[0] !== template.definition) return false;
  if (
    module.definitions.some(
      (definition) =>
        definition !== template.definition &&
        leaf(definition.name) === name &&
        endsBefore(template.definition.location, definition.location) &&
        (call.enclosing !== undefined || endsBefore(definition.location, call.location)),
    )
  ) {
    return false;
  }
  if (hasBindingAt(module, call.enclosing, name, call.location)) return false;
  if (
    module.imports.some(
      (entry) =>
        entry.local === name &&
        endsBefore(template.definition.location, entry.location) &&
        (call.enclosing !== undefined || endsBefore(entry.location, call.location)),
    )
  ) {
    return false;
  }
  return !module.assignments.some((assignment) => {
    if (assignment.target[0] !== name) return false;
    if (call.enclosing === undefined) return endsBefore(assignment.location, call.location);
    return (
      assignment.enclosing === call.enclosing ||
      assignment.enclosing === template.definition.enclosing
    );
  });
};

const directConstruction = (
  module: ModuleFacts,
  executorCall: CallFact,
  factoryCalls: readonly CallFact[],
): LegacyConstruction | undefined => {
  if (executorCall.enclosing !== undefined) return undefined;
  const executorDefinition = stableConstructionDefinition(module, executorCall);
  const entries = keywordEntries(executorCall);
  const agentName = identifier(findEntry(entries, 'agent')?.value);
  if (executorDefinition === undefined || agentName === undefined) return undefined;
  const agentDefinitions = module.definitions.filter(
    (definition) =>
      definition.kind === 'variable' &&
      definition.name === agentName &&
      definition.enclosing === executorDefinition.enclosing &&
      endsBefore(definition.location, executorCall.location),
  );
  if (agentDefinitions.length !== 1) return undefined;
  const agentDefinition = agentDefinitions[0];
  if (agentDefinition === undefined) return undefined;
  const factoryCall = factoryCalls.find(
    (call) =>
      contains(agentDefinition.location, call.location) &&
      legacyDirectDefinition(module, call) === agentDefinition,
  );
  if (factoryCall === undefined) return undefined;
  const sourceName = sourceNameOf(executorDefinition);
  return {
    module,
    identity: sourceIdentity('agent', module.file, sourceName),
    sourceName,
    definition: executorDefinition,
    call: executorCall,
    factoryCall,
    executorCall,
    model: factoryCall.args[0],
    tools: findEntry(entries, 'tools')?.value ?? factoryCall.args[1],
    prompt: factoryCall.args[2],
  };
};

/** Settles exact executor instances and calls to exact local factory wrappers. */
export const settleLegacyAgentConstructions = (
  context: DiscoveryContext,
  module: ModuleFacts,
): LegacySettlement => {
  const exactFactoryCalls = module.calls.filter((call) =>
    exactLegacyAgentCall(context, module, call, LANGCHAIN_LEGACY_FACTORY_EXPORT),
  );
  const exactExecutorCalls = module.calls.filter((call) =>
    exactLegacyAgentCall(context, module, call, LANGCHAIN_LEGACY_EXECUTOR_EXPORT),
  );
  const functionDefinitions = module.definitions.filter(
    (definition) => definition.kind === 'function',
  );
  const templates = functionDefinitions.flatMap((definition) => {
    const template = templateFor(context, module, definition);
    return template === undefined ? [] : [template];
  });
  const consumed = new Set<CallFact>();
  const constructions: LegacyConstruction[] = [];
  const refusals: Refusal[] = [];

  for (const template of templates) {
    consumed.add(template.factoryCall);
    consumed.add(template.executorCall);
    const candidates = wrapperCallCandidates(module, template);
    if (candidates.length === 0) {
      refusals.push({
        kind: 'node_registration',
        reason:
          'A verified legacy LangChain factory wrapper had no source-settled local construction call; cross-module calls are unsupported.',
        location: template.definition.location,
      });
    }
    for (const call of candidates) {
      if (!legacyWrapperBindingHolds(module, template, call)) {
        refusals.push({
          kind: 'node_registration',
          reason:
            'A legacy LangChain factory wrapper was shadowed, rebound or otherwise unsettled at this call site.',
          location: call.location,
        });
        continue;
      }
      const definition = stableConstructionDefinition(module, call);
      if (definition === undefined) {
        refusals.push({
          kind: 'node_registration',
          reason:
            'A verified legacy LangChain agent factory call has no unique unchanged assigned source identity.',
          location: call.location,
        });
        continue;
      }
      const sourceName = sourceNameOf(definition);
      constructions.push({
        module,
        identity: sourceIdentity('agent', module.file, sourceName),
        sourceName,
        definition,
        call,
        factoryCall: template.factoryCall,
        executorCall: template.executorCall,
        template,
        model: callArgumentFor(call, template, template.modelParameter),
        tools: callArgumentFor(call, template, template.toolsParameter),
        prompt: callArgumentFor(call, template, template.promptParameter),
      });
    }
  }

  for (const executorCall of exactExecutorCalls) {
    if (consumed.has(executorCall)) continue;
    const construction = directConstruction(module, executorCall, exactFactoryCalls);
    if (construction === undefined) continue;
    constructions.push(construction);
    consumed.add(executorCall);
    consumed.add(construction.factoryCall);
  }

  const identityCounts = new Map<string, number>();
  for (const construction of constructions) {
    const key = `${construction.identity.namespace}\u0000${construction.identity.localName}`;
    identityCounts.set(key, (identityCounts.get(key) ?? 0) + 1);
  }
  const settled = constructions.filter((construction) => {
    const key = `${construction.identity.namespace}\u0000${construction.identity.localName}`;
    if ((identityCounts.get(key) ?? 0) === 1) return true;
    refusals.push({
      kind: 'node_registration',
      reason:
        'Multiple legacy LangChain agent constructions share one source identity, so none is selected.',
      location: construction.call.location,
    });
    return false;
  });

  return { constructions: settled, consumedCalls: consumed, refusals };
};
