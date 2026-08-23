import type { ComponentIdentity, SourceLocation } from '@orchescope/schema';
import type {
  ArgumentFact,
  CallFact,
  DefinitionFact,
  ModuleFacts,
  ObjectEntryFact,
} from '@orchescope/source-analysis';
import { findEntry } from '@orchescope/source-analysis';

import type { AgentSystemAdapter } from '../adapter.ts';
import { hasBindingAt } from '../matching.ts';
import { LANGCHAIN_CREATE_AGENT_ADAPTER_ID } from './langchain-v1-create-agent-origin.ts';

type Discovery = Parameters<AgentSystemAdapter['discover']>[0];
type MiddlewareDefinition = {
  readonly module: ModuleFacts;
  readonly definition: DefinitionFact;
  readonly supportingLocations: readonly SourceLocation[];
};
type MiddlewareSettlement = {
  readonly items: readonly MiddlewareDefinition[];
  readonly complete: boolean;
};

const definitionIsStable = (module: ModuleFacts, definition: DefinitionFact): boolean =>
  module.definitions.filter(
    (candidate) =>
      candidate.name === definition.name && candidate.enclosing === definition.enclosing,
  ).length === 1 &&
  !module.assignments.some(
    (assignment) =>
      assignment.target.length === 1 &&
      assignment.target[0] === definition.name &&
      assignment.enclosing === definition.enclosing,
  );

const endsBefore = (location: SourceLocation, before: SourceLocation): boolean =>
  (location.endLine ?? location.startLine) < before.startLine ||
  ((location.endLine ?? location.startLine) === before.startLine &&
    location.endColumn !== undefined &&
    before.startColumn !== undefined &&
    location.endColumn <= before.startColumn);

const importBindingSupport = (
  module: ModuleFacts,
  name: string,
  targetFile: string,
  before: SourceLocation,
): readonly SourceLocation[] | undefined => {
  if (targetFile === module.file) return [];
  const imports = module.imports.filter(
    (entry) => entry.local === name && !entry.isType && endsBefore(entry.location, before),
  );
  return imports.length === 1 && imports[0] !== undefined ? [imports[0].location] : undefined;
};

const resolveMiddlewareItem = (
  context: Discovery,
  module: ModuleFacts,
  call: CallFact,
  name: string,
  before: SourceLocation,
): MiddlewareDefinition | undefined => {
  if (hasBindingAt(module, call.enclosing, name, before)) return undefined;
  const resolved = context.symbols.resolve(module.file, name);
  if (resolved?.definition === undefined) return undefined;
  const owner = context.symbols.moduleOf(resolved.file);
  if (owner === undefined || !definitionIsStable(owner, resolved.definition)) return undefined;
  if (owner.file === module.file && !endsBefore(resolved.definition.location, before)) {
    return undefined;
  }
  const supportingLocations = importBindingSupport(module, name, owner.file, before);
  return supportingLocations === undefined
    ? undefined
    : { module: owner, definition: resolved.definition, supportingLocations };
};

const settleMiddlewareArray = (
  context: Discovery,
  module: ModuleFacts,
  call: CallFact,
  value: Extract<ArgumentFact, { readonly kind: 'array' }>,
  inheritedSupport: readonly SourceLocation[],
  before: SourceLocation,
): MiddlewareSettlement => {
  if (value.complete !== true) return { items: [], complete: false };
  const items: MiddlewareDefinition[] = [];
  let complete = true;
  for (const item of value.items) {
    const resolved =
      item.kind === 'identifier'
        ? resolveMiddlewareItem(context, module, call, item.name, before)
        : undefined;
    if (resolved === undefined) complete = false;
    else {
      items.push({
        ...resolved,
        supportingLocations: [...inheritedSupport, ...resolved.supportingLocations],
      });
    }
  }
  return { items, complete };
};

const stableMiddlewareList = (
  context: Discovery,
  module: ModuleFacts,
  call: CallFact,
  name: string,
  before: SourceLocation,
): MiddlewareDefinition | undefined => {
  const local = module.definitions.filter(
    (definition) =>
      definition.kind === 'variable' &&
      definition.name === name &&
      definition.enclosing === call.enclosing &&
      endsBefore(definition.location, before),
  );
  if (local.length > 1) return undefined;
  if (local.length === 0 && hasBindingAt(module, call.enclosing, name, before)) return undefined;
  const selected = local[0] ?? context.symbols.resolve(module.file, name)?.definition;
  if (selected?.kind !== 'variable' || selected.value === undefined) return undefined;
  const owner = context.symbols.moduleOf(selected.location.file) ?? module;
  if (owner.file === module.file && !endsBefore(selected.location, before)) return undefined;
  const supportingLocations = importBindingSupport(module, name, owner.file, before);
  return definitionIsStable(owner, selected) && supportingLocations !== undefined
    ? {
        module: owner,
        definition: selected,
        supportingLocations: [...supportingLocations, selected.location],
      }
    : undefined;
};

const stableMiddlewareItems = (
  context: Discovery,
  module: ModuleFacts,
  call: CallFact,
  value: ArgumentFact,
): MiddlewareSettlement => {
  let currentModule = module;
  let current = value;
  let before = call.location;
  const supportingLocations: SourceLocation[] = [];
  for (let depth = 0; depth < 4; depth += 1) {
    if (current.kind === 'array') {
      return settleMiddlewareArray(
        context,
        currentModule,
        call,
        current,
        supportingLocations,
        before,
      );
    }
    if (current.kind !== 'identifier') return { items: [], complete: false };
    const selected = stableMiddlewareList(context, currentModule, call, current.name, before);
    if (selected?.definition.value === undefined) return { items: [], complete: false };
    currentModule = selected.module;
    current = selected.definition.value;
    before = selected.definition.location;
    supportingLocations.push(...selected.supportingLocations);
  }
  return { items: [], complete: false };
};

type DynamicPromptAuthority =
  | { readonly kind: 'exact'; readonly locations: readonly SourceLocation[] }
  | { readonly kind: 'unresolved' };

const dynamicPromptAuthority = (
  module: ModuleFacts,
  definition: DefinitionFact,
): DynamicPromptAuthority | undefined => {
  const candidates = definition.decorators.filter(
    (decorator) =>
      decorator.origin?.module === 'langchain.agents.middleware' &&
      !decorator.origin.isType &&
      (decorator.origin.imported === 'dynamic_prompt' ||
        (decorator.origin.imported === '*' && decorator.path.at(-1) === 'dynamic_prompt')),
  );
  if (candidates.length === 0) return undefined;
  if (candidates.length !== 1) return { kind: 'unresolved' };
  const decorator = candidates[0];
  const root = decorator?.path[0];
  if (decorator === undefined || root === undefined) return { kind: 'unresolved' };
  const imports = module.imports.filter(
    (entry) =>
      entry.local === root &&
      !entry.isType &&
      entry.module === decorator.origin?.module &&
      entry.imported === decorator.origin.imported,
  );
  const shadowed =
    module.assignments.some(
      (assignment) => assignment.target.length === 1 && assignment.target[0] === root,
    ) ||
    module.definitions.some((candidate) => candidate.name === root && candidate !== definition);
  if (imports.length !== 1 || imports[0] === undefined || shadowed) return { kind: 'unresolved' };
  return {
    kind: 'exact',
    locations: [imports[0].location, decorator.location, definition.location],
  };
};

export const registerDynamicPrompts = (input: {
  readonly context: Parameters<AgentSystemAdapter['discover']>[0];
  readonly module: ModuleFacts;
  readonly call: CallFact;
  readonly entries: readonly ObjectEntryFact[];
  readonly consumer: ComponentIdentity;
  readonly support: readonly SourceLocation[];
}): void => {
  const middleware = findEntry(input.entries, 'middleware');
  const registerUnknown = (
    module: ModuleFacts,
    location: SourceLocation,
    channel: string,
    nodeType: string,
    supportingLocations: readonly SourceLocation[],
  ): void => {
    input.context.promptInputs.register({
      producer: LANGCHAIN_CREATE_AGENT_ADAPTER_ID,
      module,
      call: input.call,
      consumer: input.consumer,
      channel,
      value: { kind: 'unknown', nodeType },
      location,
      supportingLocations,
    });
  };
  if (middleware === undefined) {
    const owner = input.call.args.find(
      (argument) => argument.kind === 'object' && argument.entries === input.entries,
    );
    if (owner?.kind === 'object' && owner.complete === false) {
      registerUnknown(
        input.module,
        input.call.location,
        'middleware.dynamic_prompt',
        'incomplete_middleware_property',
        input.support,
      );
    }
    return;
  }
  const resolvedMiddleware = stableMiddlewareItems(
    input.context,
    input.module,
    input.call,
    middleware.value,
  );
  if (!resolvedMiddleware.complete) {
    registerUnknown(
      input.module,
      middleware.location,
      'middleware.dynamic_prompt',
      'unresolved_middleware_population',
      input.support,
    );
  }
  for (const resolved of resolvedMiddleware.items) {
    const authority = dynamicPromptAuthority(resolved.module, resolved.definition);
    if (authority === undefined) continue;
    if (authority.kind === 'unresolved') {
      registerUnknown(
        resolved.module,
        resolved.definition.location,
        `middleware.dynamic_prompt.${resolved.definition.name}`,
        'unresolved_dynamic_prompt_authority',
        [...input.support, ...resolved.supportingLocations],
      );
      continue;
    }
    const dynamicSupport = [
      ...input.support,
      ...resolved.supportingLocations,
      ...authority.locations,
    ];
    for (const returned of resolved.definition.returns ?? []) {
      if (returned.value.kind !== 'string' && returned.value.kind !== 'template') {
        if (returned.value.kind !== 'null') {
          registerUnknown(
            resolved.module,
            returned.location,
            `middleware.dynamic_prompt.${resolved.definition.name}`,
            'computed_dynamic_prompt_return',
            dynamicSupport,
          );
        }
        continue;
      }
      input.context.promptInputs.register({
        producer: LANGCHAIN_CREATE_AGENT_ADAPTER_ID,
        module: resolved.module,
        call: input.call,
        consumer: input.consumer,
        channel: `middleware.dynamic_prompt.${resolved.definition.name}`,
        value: returned.value,
        location: returned.location,
        supportingLocations: dynamicSupport,
      });
    }
  }
};
