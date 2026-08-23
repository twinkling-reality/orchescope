import type { SourceLocation } from '@orchescope/schema';
import type { ArgumentFact } from '@orchescope/source-analysis';

export type ResolvedSourceValue = {
  readonly value: ArgumentFact;
  readonly basis: 'binding' | 'configuration_default';
  readonly locations: readonly SourceLocation[];
};

export type ResolvedSourceChoices = {
  readonly values: readonly ResolvedSourceValue[];
  readonly complete: boolean;
  readonly unresolvedLocations: readonly SourceLocation[];
};

const MAX_VALUE_HOPS = 4;
const MAX_SOURCE_CHOICES = 8;

const locationKey = (location: SourceLocation): string =>
  `${location.file}:${location.startLine}:${location.startColumn ?? 0}:${location.endLine ?? location.startLine}:${location.endColumn ?? 0}`;

const sortedLocations = (locations: readonly SourceLocation[]): readonly SourceLocation[] =>
  [...new Map(locations.map((location) => [locationKey(location), location])).values()].sort(
    (left, right) => locationKey(left).localeCompare(locationKey(right)),
  );

type ChoiceAccumulator = {
  values: ResolvedSourceValue[];
  complete: boolean;
  unresolvedLocations: SourceLocation[];
};

const staticTruth = (value: ArgumentFact): boolean | undefined => {
  if (value.kind === 'string') return value.value.length > 0;
  if (value.kind === 'number') return value.value !== 0;
  if (value.kind === 'boolean') return value.value;
  if (value.kind === 'null') return false;
  if (value.kind === 'array' && value.complete !== false) return value.items.length > 0;
  if (value.kind === 'object' && value.complete !== false) return value.entries.length > 0;
  return undefined;
};

type ChoiceInput = {
  readonly value: ArgumentFact;
  readonly before: SourceLocation;
  readonly resolve: (value: ArgumentFact, depth: number) => ResolvedSourceValue | undefined;
};

const expandChoices = (
  input: ChoiceInput,
  value: ArgumentFact,
  inheritedLocations: readonly SourceLocation[],
  depth: number,
  accumulator: ChoiceAccumulator,
): void => {
  if (depth > MAX_VALUE_HOPS || accumulator.values.length >= MAX_SOURCE_CHOICES) {
    accumulator.complete = false;
    accumulator.unresolvedLocations.push(input.before);
    return;
  }
  const resolved = input.resolve(value, depth);
  if (resolved === undefined) {
    accumulator.complete = false;
    accumulator.unresolvedLocations.push(inheritedLocations.at(-1) ?? input.before);
    return;
  }
  const locations = [...inheritedLocations, ...resolved.locations];
  if (resolved.value.kind !== 'selection') {
    accumulator.values.push({ ...resolved, locations: sortedLocations(locations) });
    return;
  }
  if (!resolved.value.complete) accumulator.complete = false;
  for (const alternative of resolved.value.alternatives) {
    const branch: ChoiceAccumulator = { values: [], complete: true, unresolvedLocations: [] };
    expandChoices(
      input,
      alternative.value,
      [...locations, alternative.location],
      depth + 1,
      branch,
    );
    if (!branch.complete) accumulator.complete = false;
    accumulator.unresolvedLocations.push(...branch.unresolvedLocations);
    for (const branchValue of branch.values) {
      if (staticTruth(branchValue.value) === false) continue;
      if (accumulator.values.length >= MAX_SOURCE_CHOICES) {
        accumulator.complete = false;
        accumulator.unresolvedLocations.push(alternative.location);
        break;
      }
      accumulator.values.push(branchValue);
    }
    if (
      branch.complete &&
      branch.values.length > 0 &&
      branch.values.every((branchValue) => staticTruth(branchValue.value) === true)
    ) {
      break;
    }
  }
};

const valueKey = (value: ResolvedSourceValue): string =>
  `${value.basis}:${JSON.stringify(value.value)}`;

/** Expands one bounded source selection without choosing a runtime branch. */
export const expandSourceChoices = (input: ChoiceInput): ResolvedSourceChoices => {
  const accumulator: ChoiceAccumulator = { values: [], complete: true, unresolvedLocations: [] };
  expandChoices(input, input.value, [], 0, accumulator);
  const grouped = new Map<string, ResolvedSourceValue>();
  for (const value of accumulator.values) {
    const key = valueKey(value);
    const earlier = grouped.get(key);
    grouped.set(
      key,
      earlier === undefined
        ? value
        : { ...value, locations: sortedLocations([...earlier.locations, ...value.locations]) },
    );
  }
  const values = [...grouped.values()]
    .sort((left, right) => valueKey(left).localeCompare(valueKey(right)))
    .slice(0, MAX_SOURCE_CHOICES);
  if (accumulator.values.length > MAX_SOURCE_CHOICES) accumulator.complete = false;
  return {
    values,
    complete: accumulator.complete,
    unresolvedLocations: sortedLocations(accumulator.unresolvedLocations),
  };
};
