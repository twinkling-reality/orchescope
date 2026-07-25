import { strongerBasis } from '@orchescope/domain';
import type {
  ComponentDetails,
  ConfigLocation,
  EdgePolicy,
  Metadata,
  Permission,
  SourceLocation,
} from '@orchescope/schema';

/**
 * Merge rules for facts about the same component or relation discovered more than once.
 *
 * Two adapters may see the same agent from different angles: one reads the constructor call, another
 * reads a configuration file. Merging keeps both sets of evidence and takes the stronger basis, and
 * for scalar details the first writer wins so that a later, weaker guess cannot overwrite a stronger
 * observation. Conflicts are surfaced as reconciliation contradictions, not resolved silently.
 */

export const mergeUnique = <T>(
  left: readonly T[],
  right: readonly T[],
  key: (value: T) => string,
): T[] => {
  const seen = new Map<string, T>();
  for (const value of [...left, ...right]) {
    const id = key(value);
    if (!seen.has(id)) seen.set(id, value);
  }
  return [...seen.values()];
};

export const sourceLocationKey = (location: SourceLocation): string =>
  `${location.file}:${location.startLine}:${location.startColumn ?? ''}:${location.endLine ?? ''}`;

export const configLocationKey = (location: ConfigLocation): string =>
  `${location.file}#${location.pointer}`;

export const permissionKey = (permission: Permission): string =>
  `${permission.kind}:${permission.mode}:${permission.scope}`;

export const mergeSourceLocations = (
  left: readonly SourceLocation[],
  right: readonly SourceLocation[],
): SourceLocation[] => mergeUnique(left, right, sourceLocationKey);

export const mergeConfigLocations = (
  left: readonly ConfigLocation[],
  right: readonly ConfigLocation[],
): ConfigLocation[] => mergeUnique(left, right, configLocationKey);

export const mergePermissions = (
  left: readonly Permission[],
  right: readonly Permission[],
): Permission[] => mergeUnique(left, right, permissionKey);

export const mergeStrings = (left: readonly string[], right: readonly string[]): string[] =>
  mergeUnique(left, right, (value) => value);

export const mergeMetadata = (left: Metadata, right: Metadata): Metadata => ({ ...right, ...left });

export const mergeBasis = strongerBasis;

/** Confidence for the same fact seen twice: the stronger evidence wins, it does not accumulate. */
export const mergeConfidence = (left: number, right: number): number => Math.max(left, right);

/**
 * Details merge only when both sides describe the same kind. Existing defined values are kept, and
 * fields the first writer left unknown are filled in by the second.
 */
export const mergeDetails = (
  left: ComponentDetails | undefined,
  right: ComponentDetails | undefined,
): ComponentDetails | undefined => {
  if (left === undefined) return right;
  if (right === undefined) return left;
  if (left.for !== right.for) return left;
  const merged: Record<string, unknown> = { ...right };
  for (const [key, value] of Object.entries(left)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged as ComponentDetails;
};

export const mergePolicy = (
  left: EdgePolicy | undefined,
  right: EdgePolicy | undefined,
): EdgePolicy | undefined => {
  if (left === undefined) return right;
  if (right === undefined) return left;
  const retry = left.retry ?? right.retry;
  return {
    ...right,
    ...left,
    ...(retry === undefined ? {} : { retry }),
  };
};
