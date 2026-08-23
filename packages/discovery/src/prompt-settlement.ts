import type { SourceLocation } from '@orchescope/schema';
import type { ArgumentFact, ModuleFacts } from '@orchescope/source-analysis';

import type { DiscoveryContext } from './adapter.ts';
import { lexicalPromptOwner, resolvePromptDefinition } from './prompt-binding.ts';

const MAX_VALUE_HOPS = 4;

export type PromptLeaf = {
  readonly value: Extract<ArgumentFact, { readonly kind: 'string' | 'template' }>;
  readonly file: string;
  readonly name: string | undefined;
  readonly enclosing: string | undefined;
  readonly location: SourceLocation;
  readonly locations: readonly SourceLocation[];
  readonly interpolates: boolean;
};

export type PromptSettlement = {
  readonly leaves: readonly PromptLeaf[];
  readonly reason?: string;
};

const leafAt = (
  value: Extract<ArgumentFact, { readonly kind: 'string' | 'template' }>,
  module: ModuleFacts,
  location: SourceLocation,
  locations: readonly SourceLocation[],
  name?: string,
  enclosing?: string,
  interpolates = value.kind === 'template' && value.hasSubstitutions,
): PromptLeaf => ({ value, file: module.file, name, enclosing, location, locations, interpolates });

const settleTemplate = (input: {
  readonly context: DiscoveryContext;
  readonly module: ModuleFacts;
  readonly value: Extract<ArgumentFact, { readonly kind: 'template' }>;
  readonly before: SourceLocation;
  readonly enclosing: string | undefined;
  readonly locations: readonly SourceLocation[];
  readonly depth: number;
  readonly seen: ReadonlySet<string>;
}): PromptSettlement => {
  if (input.value.substitutionsComplete === false) {
    return {
      leaves: [leafAt(input.value, input.module, input.before, input.locations)],
      reason: 'template substitution population exceeds eight names',
    };
  }
  const names = input.value.substitutedNames;
  if (names !== undefined && names.length === 0) {
    return {
      leaves: [
        leafAt(
          input.value,
          input.module,
          input.before,
          input.locations,
          undefined,
          undefined,
          false,
        ),
      ],
    };
  }
  if (names === undefined) {
    return { leaves: [leafAt(input.value, input.module, input.before, input.locations)] };
  }
  const resolved: PromptLeaf[] = [];
  let resolvedNames = 0;
  for (const name of names) {
    const target = resolvePromptDefinition(
      input.context,
      input.module,
      name,
      input.enclosing,
      input.before,
    );
    if (target?.definition.value === undefined) continue;
    const nested = settle(
      input.context,
      target.module,
      target.definition.value,
      target.definition.location,
      target.definition.enclosing,
      [...input.locations, target.definition.location],
      input.depth + 1,
      input.seen,
    );
    if (nested.leaves.length > 0) resolvedNames += 1;
    resolved.push(
      ...nested.leaves.map((leaf) => ({
        ...leaf,
        name: target.definition.name,
        enclosing:
          lexicalPromptOwner(target.module, target.definition.location) ??
          target.definition.enclosing,
        interpolates: leaf.interpolates,
      })),
    );
  }
  return resolved.length > 0 && resolvedNames === names.length
    ? { leaves: resolved }
    : { leaves: [leafAt(input.value, input.module, input.before, input.locations)] };
};

const settle = (
  context: DiscoveryContext,
  module: ModuleFacts,
  value: ArgumentFact,
  before: SourceLocation,
  enclosing: string | undefined,
  locations: readonly SourceLocation[],
  depth = 0,
  seen: ReadonlySet<string> = new Set(),
): PromptSettlement => {
  if (depth >= MAX_VALUE_HOPS)
    return { leaves: [], reason: 'prompt value exceeds four source bindings' };
  if (value.kind === 'string') return { leaves: [leafAt(value, module, before, locations)] };
  if (value.kind === 'template')
    return settleTemplate({ context, module, value, before, enclosing, locations, depth, seen });
  if (value.kind === 'identifier') {
    const key = `${module.file}:${enclosing ?? '<module>'}:${value.name}`;
    if (seen.has(key)) return { leaves: [], reason: 'prompt binding contains a cycle' };
    const target = resolvePromptDefinition(context, module, value.name, enclosing, before);
    if (target?.definition.value === undefined) {
      return {
        leaves: [],
        reason: 'prompt binding is ambiguous, shadowed, reassigned or computed',
      };
    }
    const nextSeen = new Set(seen);
    nextSeen.add(key);
    const nested = settle(
      context,
      target.module,
      target.definition.value,
      target.definition.location,
      target.definition.enclosing,
      [...locations, target.definition.location],
      depth + 1,
      nextSeen,
    );
    return {
      ...nested,
      leaves: nested.leaves.map((leaf) => ({
        ...leaf,
        name: target.definition.name,
        enclosing:
          lexicalPromptOwner(target.module, target.definition.location) ??
          target.definition.enclosing,
      })),
    };
  }
  if (value.kind === 'array') {
    if (value.complete !== true)
      return { leaves: [], reason: 'prompt array contains an unresolved spread' };
    const settlements = value.items.map((item) =>
      settle(context, module, item, before, enclosing, locations, depth + 1, seen),
    );
    const reason = settlements.find((entry) => entry.reason !== undefined)?.reason;
    return {
      leaves: settlements.flatMap((entry) => entry.leaves),
      ...(reason === undefined ? {} : { reason }),
    };
  }
  if (value.kind === 'object') {
    if (value.complete !== true) {
      return { leaves: [], reason: 'prompt object contains an unresolved spread or computed key' };
    }
    const promptEntries = value.entries.filter((entry) =>
      [
        'content',
        'text',
        'parts',
        'messages',
        'input',
        'prompt',
        'system',
        'instructions',
        'json',
        'body',
        'data',
      ].includes(entry.key),
    );
    if (new Set(promptEntries.map((entry) => entry.key)).size !== promptEntries.length) {
      return { leaves: [], reason: 'prompt object contains an ambiguous repeated text property' };
    }
    if (promptEntries.length === 0) {
      return { leaves: [], reason: 'prompt object has no supported text-bearing property' };
    }
    const settlements = promptEntries.map((entry) =>
      settle(
        context,
        module,
        entry.value,
        entry.location,
        enclosing,
        [...locations, entry.location],
        depth + 1,
        seen,
      ),
    );
    const reason = settlements.find((entry) => entry.reason !== undefined)?.reason;
    return {
      leaves: settlements.flatMap((entry) => entry.leaves),
      ...(reason === undefined ? {} : { reason }),
    };
  }
  if (
    value.kind === 'call' &&
    value.path.at(-1) === 'stringify' &&
    value.args.length === 1 &&
    value.args[0] !== undefined
  ) {
    return settle(context, module, value.args[0], before, enclosing, locations, depth + 1, seen);
  }
  return { leaves: [], reason: 'prompt value is computed rather than source-settled text' };
};

export const settlePromptInput = (
  context: DiscoveryContext,
  module: ModuleFacts,
  value: ArgumentFact,
  before: SourceLocation,
  enclosing: string | undefined,
  locations: readonly SourceLocation[],
): PromptSettlement => settle(context, module, value, before, enclosing, locations);
