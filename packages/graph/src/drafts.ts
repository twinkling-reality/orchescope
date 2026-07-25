import type {
  ClaimBasis,
  ComponentDetails,
  ComponentIdentity,
  ComponentKind,
  ConfigLocation,
  EdgeKind,
  EdgePolicy,
  Evidence,
  Metadata,
  Permission,
  SideEffectClass,
  SourceLocation,
} from '@orchescope/schema';

/**
 * Drafts are what discovery adapters produce.
 *
 * A draft names its endpoints by identity rather than by identifier, because identifiers are only
 * assigned once the whole scan is known: two components that would collide on a readable identifier
 * both get a namespace derived suffix, and that decision cannot be made one adapter at a time.
 */

export type ComponentDraft = {
  readonly identity: ComponentIdentity;
  readonly kind: ComponentKind;
  readonly displayName: string;
  readonly description?: string;
  readonly basis: ClaimBasis;
  readonly confidence: number;
  readonly discoveredBy: string;
  readonly presence?: Partial<{ static: boolean; runtime: boolean; manifest: boolean }>;
  readonly sourceLocations?: readonly SourceLocation[];
  readonly configLocations?: readonly ConfigLocation[];
  readonly evidence: readonly Evidence[];
  readonly details?: ComponentDetails;
  readonly sideEffect?: SideEffectClass;
  readonly permissions?: readonly Permission[];
  readonly tags?: readonly string[];
  readonly metadata?: Metadata;
};

export type EdgeDraft = {
  readonly kind: EdgeKind;
  readonly from: ComponentIdentity;
  readonly to: ComponentIdentity;
  readonly basis: ClaimBasis;
  readonly confidence: number;
  readonly discoveredBy: string;
  readonly sourceLocations?: readonly SourceLocation[];
  readonly configLocations?: readonly ConfigLocation[];
  readonly evidence: readonly Evidence[];
  readonly policy?: EdgePolicy;
  readonly metadata?: Metadata;
};
