import type { SourceLocation } from '@orchescope/schema';
import type {
  ArgumentFact,
  CallFact,
  ModuleFacts,
  ObjectEntryFact,
} from '@orchescope/source-analysis';
import { modelEndpointForHost } from '@orchescope/traces/model-endpoints';
import type { DiscoveryContext } from '../adapter.ts';
import { resolveSourceChoices, type ResolvedSourceValue } from '../source-value.ts';

const KEYWORD_HOP_LIMIT = 4;

export type ModelChoice = {
  readonly model: string;
  readonly basis: ResolvedSourceValue['basis'];
  readonly locations: readonly SourceLocation[];
  readonly possible: boolean;
};

export type ProviderChoice = {
  readonly provider: string;
  readonly locations: readonly SourceLocation[];
  readonly possible: boolean;
  readonly basis: 'explicit_endpoint' | 'library_default';
};

export type ChatOpenAiConfiguration = {
  readonly models: readonly ModelChoice[];
  readonly providers: readonly ProviderChoice[];
  readonly locations: readonly SourceLocation[];
};

type Refuse = (reason: string, location: SourceLocation) => void;

const locationKey = (location: SourceLocation): string =>
  `${location.file}:${location.startLine}:${location.startColumn ?? 0}:${location.endLine ?? location.startLine}:${location.endColumn ?? 0}`;

export const chatConfigurationLocations = (
  locations: readonly SourceLocation[],
): readonly SourceLocation[] =>
  [...new Map(locations.map((location) => [locationKey(location), location])).values()].sort(
    (left, right) => locationKey(left).localeCompare(locationKey(right)),
  );

type SettledKeywords = {
  readonly entries: readonly ObjectEntryFact[];
  readonly complete: boolean;
  readonly locations: readonly SourceLocation[];
  readonly unresolvedLocations: readonly SourceLocation[];
};

const settleObject = (
  context: DiscoveryContext,
  module: ModuleFacts,
  call: CallFact,
  object: Extract<ArgumentFact, { readonly kind: 'object' }>,
  before: SourceLocation,
  depth: number,
): SettledKeywords => {
  const entries: ObjectEntryFact[] = [...object.entries];
  const locations: SourceLocation[] = [];
  const unresolvedLocations: SourceLocation[] = [];
  let complete = object.complete !== false;
  if (depth > KEYWORD_HOP_LIMIT) {
    return { entries, complete: false, locations, unresolvedLocations: [before] };
  }
  for (const spread of object.spreads ?? []) {
    const resolved = resolveSourceChoices({
      context,
      module,
      value: spread.value,
      before: spread.location,
      enclosing: call.enclosing,
    });
    locations.push(spread.location, ...resolved.values.flatMap((value) => value.locations));
    if (
      !resolved.complete ||
      resolved.values.length !== 1 ||
      resolved.values[0]?.value.kind !== 'object'
    ) {
      complete = false;
      unresolvedLocations.push(spread.location, ...resolved.unresolvedLocations);
      continue;
    }
    const nested = settleObject(
      context,
      module,
      call,
      resolved.values[0].value,
      spread.location,
      depth + 1,
    );
    entries.push(...nested.entries);
    locations.push(...nested.locations);
    unresolvedLocations.push(...nested.unresolvedLocations);
    if (!nested.complete) complete = false;
  }
  return {
    entries,
    complete,
    locations: chatConfigurationLocations(locations),
    unresolvedLocations: chatConfigurationLocations(unresolvedLocations),
  };
};

const keywordPopulation = (
  context: DiscoveryContext,
  module: ModuleFacts,
  call: CallFact,
): SettledKeywords => {
  const keywordObjects = call.args.filter(
    (argument): argument is Extract<ArgumentFact, { readonly kind: 'object' }> =>
      argument.kind === 'object' && argument.role === 'keywords',
  );
  if (keywordObjects.length !== 1) {
    return {
      entries: [],
      complete: false,
      locations: [],
      unresolvedLocations: [call.location],
    };
  }
  const keywords = keywordObjects[0];
  return keywords === undefined
    ? { entries: [], complete: false, locations: [], unresolvedLocations: [call.location] }
    : settleObject(context, module, call, keywords, call.location, 0);
};

const entriesNamed = (
  entries: readonly ObjectEntryFact[],
  names: readonly string[],
): readonly ObjectEntryFact[] => entries.filter((entry) => names.includes(entry.key));

const modelChoices = (
  context: DiscoveryContext,
  module: ModuleFacts,
  call: CallFact,
  keywords: SettledKeywords,
  refuse: Refuse,
): readonly ModelChoice[] => {
  const declarations = entriesNamed(keywords.entries, ['model', 'model_name']);
  if (declarations.length !== 1) {
    refuse(
      'ChatOpenAI has no unique source-settled model keyword; no unspecified model identity was invented.',
      declarations[0]?.location ?? call.location,
    );
    return [];
  }
  const declared = declarations[0];
  if (declared === undefined) return [];
  const resolved = resolveSourceChoices({
    context,
    module,
    value: declared.value,
    before: declared.location,
    enclosing: call.enclosing,
  });
  if (!resolved.complete) {
    refuse(
      'ChatOpenAI model selection retains a dynamic or unresolved source alternative; only settled alternatives are possible identities.',
      resolved.unresolvedLocations[0] ?? declared.location,
    );
  }
  const selection = declared.value.kind === 'selection' || !resolved.complete;
  const choices = resolved.values.flatMap((choice): readonly ModelChoice[] => {
    if (choice.value.kind !== 'string' || choice.value.value.trim().length === 0) return [];
    return [
      {
        model: choice.value.value,
        basis: choice.basis,
        locations: chatConfigurationLocations([declared.location, ...choice.locations]),
        possible:
          selection ||
          !keywords.complete ||
          choice.basis === 'configuration_default' ||
          resolved.values.length > 1,
      },
    ];
  });
  const unsupported = resolved.values.length - choices.length;
  if (unsupported > 0) {
    refuse(
      'ChatOpenAI model selection contains a settled non-string alternative that cannot name a model.',
      declared.location,
    );
  }
  if (choices.length === 0) {
    refuse(
      'ChatOpenAI model selection contains no bounded non-empty literal candidate.',
      declared.location,
    );
  }
  const grouped = new Map<string, ModelChoice>();
  for (const choice of choices) {
    const earlier = grouped.get(choice.model);
    grouped.set(
      choice.model,
      earlier === undefined
        ? choice
        : {
            ...choice,
            locations: chatConfigurationLocations([...earlier.locations, ...choice.locations]),
            possible: earlier.possible || choice.possible,
          },
    );
  }
  return [...grouped.values()].sort((left, right) => left.model.localeCompare(right.model));
};

const providerForUrl = (value: string): string | undefined => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return modelEndpointForHost(parsed.hostname)?.provider;
  } catch {
    return undefined;
  }
};

const providerChoices = (
  context: DiscoveryContext,
  module: ModuleFacts,
  call: CallFact,
  keywords: SettledKeywords,
  refuse: Refuse,
): readonly ProviderChoice[] => {
  const customClients = entriesNamed(keywords.entries, [
    'http_client',
    'http_async_client',
    'client',
    'async_client',
    'root_client',
    'root_async_client',
  ]);
  if (customClients.length > 0) {
    refuse(
      'ChatOpenAI supplies a custom HTTP client, so this source does not settle the provider endpoint.',
      customClients[0]?.location ?? call.location,
    );
    return [];
  }
  if (!keywords.complete) {
    refuse(
      'ChatOpenAI keyword population contains a spread or computed key that is not fully source-settled and may alter its endpoint, model, or client.',
      keywords.unresolvedLocations[0] ?? call.location,
    );
  }
  const baseEntries = entriesNamed(keywords.entries, ['base_url', 'openai_api_base']);
  if (baseEntries.length === 0) {
    refuse(
      'ChatOpenAI can take an OpenAI-compatible base URL from runtime environment or keyword values; OpenAI is only the library default.',
      call.location,
    );
    return [
      {
        provider: 'openai',
        locations: [call.location],
        possible: true,
        basis: 'library_default',
      },
    ];
  }
  if (baseEntries.length !== 1) {
    refuse(
      'ChatOpenAI has more than one endpoint keyword, so no provider identity is source-settled.',
      baseEntries[0]?.location ?? call.location,
    );
    return [];
  }
  const base = baseEntries[0];
  if (base === undefined) return [];
  const resolved = resolveSourceChoices({
    context,
    module,
    value: base.value,
    before: base.location,
    enclosing: call.enclosing,
  });
  if (!resolved.complete) {
    refuse(
      'ChatOpenAI endpoint selection retains a dynamic or unresolved alternative.',
      resolved.unresolvedLocations[0] ?? base.location,
    );
  }
  const choices: ProviderChoice[] = [];
  let unsupported = 0;
  for (const candidate of resolved.values) {
    const value = candidate.value.kind === 'string' ? candidate.value.value : undefined;
    const provider = value === undefined ? undefined : providerForUrl(value);
    if (provider === undefined) {
      unsupported += 1;
      continue;
    }
    choices.push({
      provider,
      locations: chatConfigurationLocations([base.location, ...candidate.locations]),
      possible:
        !keywords.complete ||
        !resolved.complete ||
        resolved.values.length > 1 ||
        base.value.kind === 'selection' ||
        candidate.basis === 'configuration_default',
      basis: 'explicit_endpoint',
    });
  }
  if (unsupported > 0 || choices.length === 0) {
    refuse(
      'ChatOpenAI endpoint is custom, computed, or outside the bounded recognized model-provider host table.',
      base.location,
    );
  }
  const grouped = new Map<string, ProviderChoice>();
  for (const choice of choices) {
    const earlier = grouped.get(choice.provider);
    grouped.set(
      choice.provider,
      earlier === undefined
        ? choice
        : {
            ...choice,
            locations: chatConfigurationLocations([...earlier.locations, ...choice.locations]),
            possible: earlier.possible || choice.possible,
          },
    );
  }
  return [...grouped.values()].sort((left, right) => left.provider.localeCompare(right.provider));
};

/** Settles bounded keyword, provider and model choices without claiming a runtime selection. */
export const settleChatOpenAiConfiguration = (input: {
  readonly context: DiscoveryContext;
  readonly module: ModuleFacts;
  readonly call: CallFact;
  readonly refuse: Refuse;
}): ChatOpenAiConfiguration => {
  const keywords = keywordPopulation(input.context, input.module, input.call);
  return {
    models: modelChoices(input.context, input.module, input.call, keywords, input.refuse),
    providers: providerChoices(input.context, input.module, input.call, keywords, input.refuse),
    locations: keywords.locations,
  };
};
