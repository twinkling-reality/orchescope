import type { ComponentId, EdgeId, Finding, Metadata } from '@orchescope/schema';
import { canonicalJson } from './canonical-json.ts';
import { OrchescopeError } from './errors.ts';
import { sha256Hex, sha256OfJson } from './hash.ts';

/** The version recorded beside findings whose identifiers come from a semantic key. */
export const SEMANTIC_FINDING_IDENTITY = 'semantic-sha256-v1';

export type FindingSemanticSubject =
  | { readonly kind: 'occurrence'; readonly key: string }
  | {
      readonly kind: 'entities';
      readonly components: readonly ComponentId[];
      readonly edges: readonly EdgeId[];
    }
  | { readonly kind: 'system'; readonly key: string };

export type FindingSemanticKey = {
  readonly ruleId: string;
  readonly polarity: Finding['polarity'];
  readonly situation: string;
  readonly remediation?: string;
  readonly subject: FindingSemanticSubject;
  readonly discriminator?: string;
};

export type FindingIdentity = {
  readonly id: string;
  /** Full digest retained so the shorter displayed projection is never treated as collision proof. */
  readonly semanticKeyDigest: string;
  readonly semanticSubjectDigest: string;
  readonly canonicalKey: string;
};

const DISPLAY_LETTERS = 5;
const DISPLAY_DIGITS = 10_000n;
const LETTER_RADIX = 26n;
const DISPLAY_SPACE = LETTER_RADIX ** BigInt(DISPLAY_LETTERS) * DISPLAY_DIGITS;

const nonEmpty = (value: string, field: string): string => {
  if (value.trim().length > 0) return value;
  throw new OrchescopeError('INVALID_ARGUMENT', `Finding identity ${field} must not be empty.`);
};

const sortedUnique = <T extends string>(values: readonly T[]): readonly T[] =>
  [...new Set(values)].sort();

const canonicalSubject = (subject: FindingSemanticSubject): FindingSemanticSubject => {
  if (subject.kind === 'occurrence') {
    return { kind: 'occurrence', key: nonEmpty(subject.key, 'occurrence key') };
  }
  if (subject.kind === 'system') {
    return { kind: 'system', key: nonEmpty(subject.key, 'whole-system subject') };
  }
  const components = sortedUnique(subject.components);
  const edges = sortedUnique(subject.edges);
  if (components.length === 0 && edges.length === 0) {
    throw new OrchescopeError(
      'INVALID_ARGUMENT',
      'A finding entity subject must name a component or edge.',
    );
  }
  return { kind: 'entities', components, edges };
};

/** Canonicalises every set-valued input before it becomes part of a finding identity. */
export const canonicalFindingSemanticKey = (input: FindingSemanticKey): FindingSemanticKey => ({
  ruleId: nonEmpty(input.ruleId, 'rule'),
  polarity: input.polarity,
  situation: nonEmpty(input.situation, 'situation'),
  ...(input.remediation === undefined
    ? {}
    : { remediation: nonEmpty(input.remediation, 'remediation branch') }),
  subject: canonicalSubject(input.subject),
  ...(input.discriminator === undefined
    ? {}
    : { discriminator: nonEmpty(input.discriminator, 'discriminator') }),
});

const displayProjection = (digest: string): string => {
  let projected = BigInt(`0x${digest}`) % DISPLAY_SPACE;
  const digits = projected % DISPLAY_DIGITS;
  projected /= DISPLAY_DIGITS;
  const letters = Array<string>(DISPLAY_LETTERS);
  for (let index = DISPLAY_LETTERS - 1; index >= 0; index -= 1) {
    letters[index] = String.fromCharCode(65 + Number(projected % LETTER_RADIX));
    projected /= LETTER_RADIX;
  }
  return `OSC-${letters.join('')}-${digits.toString().padStart(4, '0')}`;
};

/** Projects a semantic key into the accepted version-1 finding identifier grammar. */
export const findingIdentity = (input: FindingSemanticKey): FindingIdentity => {
  const key = canonicalFindingSemanticKey(input);
  const canonicalKey = canonicalJson(key);
  const semanticKeyDigest = sha256Hex(canonicalKey);
  return {
    id: displayProjection(semanticKeyDigest),
    semanticKeyDigest,
    semanticSubjectDigest: sha256OfJson(key.subject),
    canonicalKey,
  };
};

export type FindingIdentityAssignment = Pick<FindingIdentity, 'id' | 'canonicalKey'>;

/**
 * Refuses two meanings for one displayed token.
 *
 * The projection is deliberately shorter than SHA-256 so a set-level check is mandatory. Scan order is
 * not a source of entropy and is never used to repair a collision.
 */
export const assertNoFindingIdentityCollisions = (
  assignments: readonly FindingIdentityAssignment[],
): void => {
  const keysById = new Map<string, string>();
  for (const assignment of assignments) {
    const existing = keysById.get(assignment.id);
    if (existing !== undefined) {
      if (existing === assignment.canonicalKey) {
        throw new OrchescopeError(
          'INVALID_STATE',
          `Duplicate semantic finding identity at ${assignment.id}.`,
          { detail: { findingId: assignment.id, semanticKeyDigest: sha256Hex(existing) } },
        );
      }
      throw new OrchescopeError(
        'INVALID_STATE',
        `Finding identity collision at ${assignment.id}.`,
        {
          detail: {
            findingId: assignment.id,
            firstSemanticKeyDigest: sha256Hex(existing),
            secondSemanticKeyDigest: sha256Hex(assignment.canonicalKey),
          },
        },
      );
    }
    keysById.set(assignment.id, assignment.canonicalKey);
  }
};

export const semanticFindingKeyDigest = (metadata: Metadata): string | undefined => {
  const value = metadata['findingSemanticKey'];
  return metadata['findingIdentity'] === SEMANTIC_FINDING_IDENTITY && typeof value === 'string'
    ? value
    : undefined;
};

export const usesSemanticFindingIdentity = (metadata: Metadata): boolean =>
  metadata['findingIdentity'] === SEMANTIC_FINDING_IDENTITY;

export const semanticFindingSubjectDigest = (metadata: Metadata): string | undefined => {
  const value = metadata['findingSemanticSubject'];
  return metadata['findingIdentity'] === SEMANTIC_FINDING_IDENTITY && typeof value === 'string'
    ? value
    : undefined;
};

/** The bounded subject available in version-1 findings and goals that predate semantic metadata. */
export const legacyFindingSubject = (input: {
  readonly components: readonly ComponentId[];
  readonly edges?: readonly EdgeId[];
}): string =>
  canonicalJson({
    components: sortedUnique(input.components),
    edges: sortedUnique(input.edges ?? []),
  });

/**
 * Whether two persisted findings make the same claim.
 *
 * Documents carrying semantic metadata compare the complete key. If either side lacks that metadata,
 * compatibility is deliberately narrower: rule, polarity and the stored component/edge subject agree.
 */
export const findingsShareIdentity = (
  left: Pick<Finding, 'ruleId' | 'polarity' | 'components' | 'edges' | 'metadata'>,
  right: Pick<Finding, 'ruleId' | 'polarity' | 'components' | 'edges' | 'metadata'>,
): boolean => {
  if (left.ruleId !== right.ruleId || left.polarity !== right.polarity) return false;
  const leftKey = semanticFindingKeyDigest(left.metadata);
  const rightKey = semanticFindingKeyDigest(right.metadata);
  if (usesSemanticFindingIdentity(left.metadata) && leftKey === undefined) return false;
  if (usesSemanticFindingIdentity(right.metadata) && rightKey === undefined) return false;
  if (leftKey !== undefined && rightKey !== undefined) return leftKey === rightKey;
  return legacyFindingSubject(left) === legacyFindingSubject(right);
};
