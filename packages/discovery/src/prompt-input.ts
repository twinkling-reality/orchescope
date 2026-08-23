import type { ComponentIdentity, SourceLocation } from '@orchescope/schema';
import type {
  ArgumentFact,
  CallFact,
  ModuleFacts,
  ObjectEntryFact,
} from '@orchescope/source-analysis';
import { findEntry } from '@orchescope/source-analysis';

/** A framework-qualified source value whose API contract says it carries model input. */
export type PromptInput =
  | {
      readonly kind?: 'source';
      readonly producer: string;
      readonly module: ModuleFacts;
      readonly call: CallFact;
      readonly consumer: ComponentIdentity;
      readonly channel: string;
      readonly slot?: number;
      readonly value: ArgumentFact;
      readonly location: SourceLocation;
      readonly supportingLocations: readonly SourceLocation[];
    }
  | {
      readonly kind: 'config';
      readonly producer: string;
      readonly consumer: ComponentIdentity;
      readonly channel: string;
      readonly value: string;
      readonly configFile: string;
      readonly pointer: string;
      readonly supportingPointers?: readonly string[];
    };

export type PromptInputRegistry = {
  readonly register: (input: PromptInput) => void;
  readonly inputs: () => readonly PromptInput[];
};

const locationKey = (location: SourceLocation): string =>
  `${location.file}:${location.startLine}:${location.startColumn ?? 0}:${location.endLine}:${location.endColumn ?? 0}`;

export const createPromptInputRegistry = (): PromptInputRegistry => {
  const registered = new Map<string, PromptInput>();
  return {
    register: (input) => {
      const key =
        input.kind === 'config'
          ? `${input.producer}\u0000${input.configFile}\u0000${input.pointer}\u0000${input.channel}`
          : `${input.producer}\u0000${input.module.file}\u0000${input.call.offset}\u0000${input.channel}\u0000${input.slot ?? -1}\u0000${locationKey(input.location)}`;
      registered.set(key, input);
    },
    inputs: () =>
      [...registered.values()].sort((left, right) => {
        const leftKey =
          left.kind === 'config'
            ? `${left.configFile}:${left.pointer}:${left.channel}`
            : `${left.module.file}:${left.call.offset}:${left.channel}:${left.slot ?? -1}:${locationKey(left.location)}`;
        const rightKey =
          right.kind === 'config'
            ? `${right.configFile}:${right.pointer}:${right.channel}`
            : `${right.module.file}:${right.call.offset}:${right.channel}:${right.slot ?? -1}:${locationKey(right.location)}`;
        return leftKey.localeCompare(rightKey);
      }),
  };
};

/** Registers only named properties whose exact producer contract declares as prompt-bearing. */
export const registerPromptEntries = (input: {
  readonly registry: PromptInputRegistry;
  readonly producer: string;
  readonly module: ModuleFacts;
  readonly call: CallFact;
  readonly consumer: ComponentIdentity;
  readonly entries: readonly ObjectEntryFact[];
  readonly channels: readonly string[];
  readonly supportingLocations?: readonly SourceLocation[];
}): void => {
  const slot = input.call.args.findIndex(
    (argument) => argument.kind === 'object' && argument.entries === input.entries,
  );
  const owner = slot < 0 ? undefined : input.call.args[slot];
  const ownerComplete = owner?.kind === 'object' ? owner.complete : undefined;
  for (const channel of input.channels) {
    const matches = input.entries.filter((entry) => entry.key === channel);
    const entry = findEntry(input.entries, channel);
    const hiddenByIncompleteContainer = entry === undefined && ownerComplete === false;
    if (entry === undefined && !hiddenByIncompleteContainer) continue;
    input.registry.register({
      producer: input.producer,
      module: input.module,
      call: input.call,
      consumer: input.consumer,
      channel,
      ...(slot < 0 ? {} : { slot }),
      value:
        entry !== undefined && matches.length === 1 && ownerComplete === true
          ? entry.value
          : { kind: 'unknown', nodeType: 'incomplete_or_ambiguous_prompt_property' },
      location: entry?.location ?? input.call.location,
      supportingLocations: input.supportingLocations ?? [],
    });
  }
};

/** Exact import declaration supporting a provider-qualified call, when the parser retained one. */
export const promptCallSupport = (
  module: ModuleFacts,
  call: CallFact,
): readonly SourceLocation[] => {
  const root = call.calleePath[0];
  if (root === undefined || call.origin === undefined) return [call.location];
  const imports = module.imports.filter(
    (entry) =>
      entry.local === root &&
      entry.module === call.origin?.module &&
      entry.imported === call.origin.imported &&
      !entry.isType,
  );
  return imports.length === 1
    ? [imports[0]?.location ?? call.location, call.location]
    : [call.location];
};
