import { strongerBasis } from '@orchescope/domain';
import type {
  ComponentDetails,
  ConfigLocation,
  EdgePolicy,
  Metadata,
  Permission,
  SideEffectClass,
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

const metadataStrings = (value: Metadata[string] | undefined): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const EFFECT_CLASSES_KEY = 'effectClasses';
const EFFECT_EVIDENCE_PREFIX = 'effectEvidence:';

const withoutDerivedEffects = (metadata: Metadata): Metadata =>
  Object.fromEntries(
    Object.entries(metadata).filter(
      ([key]) => key !== EFFECT_CLASSES_KEY && !key.startsWith(EFFECT_EVIDENCE_PREFIX),
    ),
  );

const effectEvidenceKey = (effect: SideEffectClass): string => `${EFFECT_EVIDENCE_PREFIX}${effect}`;

/** Exact constituent effect classes survive when the aggregate scalar has to become unknown. */
const mergeEffectClasses = (
  leftMetadata: Metadata,
  rightMetadata: Metadata,
  left: SideEffectClass | undefined,
  right: SideEffectClass | undefined,
  rightEvidence: readonly string[],
): Metadata => {
  const leftRetained = metadataStrings(leftMetadata[EFFECT_CLASSES_KEY]);
  const merged = mergeMetadata(leftMetadata, withoutDerivedEffects(rightMetadata));
  if (right !== undefined && rightEvidence.length > 0) {
    merged[effectEvidenceKey(right)] = mergeStrings(
      metadataStrings(merged[effectEvidenceKey(right)]),
      rightEvidence,
    ).sort();
  }
  if (leftRetained.length === 0 && (left === undefined || right === undefined || left === right)) {
    return merged;
  }
  const effectClasses = mergeUnique(
    [
      ...leftRetained,
      ...(left === undefined || leftRetained.length > 0 ? [] : [left]),
      ...(right === undefined ? [] : [right]),
    ],
    [],
    (value) => value,
  ).sort();
  return { ...merged, effectClasses };
};

/**
 * A relation can summarize more than one call site. Conflicting effect or method claims become an explicit
 * aggregate boundary instead of preserving whichever call the directory traversal reached first.
 */
export const mergeRelationMetadata = (
  left: Metadata,
  right: Metadata,
  rightEvidence: readonly string[],
): Metadata => {
  const merged = mergeEffectClasses(
    left,
    right,
    typeof left['sideEffect'] === 'string' ? (left['sideEffect'] as SideEffectClass) : undefined,
    typeof right['sideEffect'] === 'string' ? (right['sideEffect'] as SideEffectClass) : undefined,
    rightEvidence,
  );
  for (const key of ['sideEffect', 'retriedEffect']) {
    if (left[key] !== undefined && right[key] !== undefined && left[key] !== right[key]) {
      merged[key] = 'unknown';
    }
  }
  if (
    left['httpMethod'] !== undefined &&
    right['httpMethod'] !== undefined &&
    left['httpMethod'] !== right['httpMethod']
  ) {
    merged['httpMethod'] = 'mixed';
  }
  return merged;
};

/** Component metadata carries exact effect constituents whenever its public scalar is an aggregate. */
export const mergeComponentEffectMetadata = (
  leftMetadata: Metadata,
  rightMetadata: Metadata,
  left: SideEffectClass | undefined,
  right: SideEffectClass | undefined,
  rightEvidence: readonly string[],
): Metadata => mergeEffectClasses(leftMetadata, rightMetadata, left, right, rightEvidence);

/** Evidence recorded by the builder for one exact effect constituent of a merged component. */
export const effectEvidenceFor = (metadata: Metadata, effect: SideEffectClass): readonly string[] =>
  metadataStrings(metadata[effectEvidenceKey(effect)]);

/** A component standing for conflicting operations cannot retain either operation's exact polarity. */
export const mergeSideEffect = (
  left: SideEffectClass | undefined,
  right: SideEffectClass | undefined,
): SideEffectClass | undefined => {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return left === right ? left : 'unknown';
};

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
