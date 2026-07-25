import {
  buildIdentity,
  CONFIDENCE_BANDS,
  configEntryEvidence,
  configNamespace,
  moduleNamespace,
  sourceSpanEvidence,
} from '@orchescope/domain';
import type { ComponentDraft, EdgeDraft } from '@orchescope/graph';
import type {
  ClaimBasis,
  ComponentDetails,
  ComponentIdentity,
  ComponentKind,
  EdgeKind,
  EdgePolicy,
  Metadata,
  Permission,
  SideEffectClass,
  SourceLocation,
} from '@orchescope/schema';

/**
 * Draft construction shared by adapters.
 *
 * Every component and relation an adapter reports arrives with a source or configuration location, an
 * evidence record naming the adapter that produced it, and a confidence band. Making that the only
 * convenient way to add a draft is how the "no finding without evidence" rule is enforced at the point
 * of production rather than at the point of reporting.
 */

export type DraftFactory = {
  readonly producer: string;
  readonly sourceComponent: (input: SourceComponentInput) => ComponentDraft;
  readonly configComponent: (input: ConfigComponentInput) => ComponentDraft;
  readonly edge: (input: EdgeInput) => EdgeDraft;
};

export type SourceComponentInput = {
  readonly kind: ComponentKind;
  readonly file: string;
  readonly name: string;
  /**
   * Overrides the identity derived from the file. Used for components that belong to the project
   * rather than to a module, such as a model referenced from several files.
   */
  readonly identity?: ComponentIdentity;
  readonly displayName?: string;
  readonly description?: string;
  readonly location: SourceLocation;
  readonly symbol?: string;
  readonly excerpt?: string;
  readonly details?: ComponentDetails;
  readonly sideEffect?: SideEffectClass;
  readonly permissions?: readonly Permission[];
  readonly metadata?: Metadata;
  readonly confidence?: number;
  readonly tags?: readonly string[];
};

export type ConfigComponentInput = {
  readonly kind: ComponentKind;
  readonly configFile: string;
  readonly pointer: string;
  readonly name: string;
  readonly displayName?: string;
  readonly description?: string;
  readonly value?: string;
  readonly details?: ComponentDetails;
  readonly sideEffect?: SideEffectClass;
  readonly permissions?: readonly Permission[];
  readonly metadata?: Metadata;
  readonly confidence?: number;
  readonly tags?: readonly string[];
};

export type EdgeInput = {
  readonly kind: EdgeKind;
  readonly from: ComponentIdentity;
  readonly to: ComponentIdentity;
  readonly location?: SourceLocation;
  readonly configFile?: string;
  readonly pointer?: string;
  readonly symbol?: string;
  readonly policy?: EdgePolicy;
  readonly metadata?: Metadata;
  readonly confidence?: number;
  readonly basis?: ClaimBasis;
};

/**
 * Namespaces for components that belong to the project rather than to a module.
 *
 * A model, a provider, a host or a datastore referenced from three files is one component, so its
 * identity cannot be derived from whichever module happened to mention it first.
 */
export const GLOBAL_NAMESPACES = {
  model: 'models',
  provider: 'providers',
  service: 'services',
  datastore: 'datastores',
  queue: 'queues',
  memory: 'memory',
  retrieval: 'retrieval',
} as const;

export const globalIdentity = (
  kind: ComponentKind,
  namespace: string,
  name: string,
): ComponentIdentity => buildIdentity(kind, namespace, name);

export const sourceIdentity = (
  kind: ComponentKind,
  file: string,
  name: string,
): ComponentIdentity => buildIdentity(kind, moduleNamespace(file), name);

export const configIdentity = (
  kind: ComponentKind,
  configFile: string,
  name: string,
): ComponentIdentity => buildIdentity(kind, configNamespace(configFile), name);

export const createDrafts = (producer: string): DraftFactory => ({
  producer,
  sourceComponent: (input) => {
    const identity = input.identity ?? sourceIdentity(input.kind, input.file, input.name);
    return {
      identity,
      kind: input.kind,
      displayName: input.displayName ?? input.name,
      ...(input.description === undefined ? {} : { description: input.description }),
      basis: 'discovered',
      confidence: input.confidence ?? CONFIDENCE_BANDS.strongStructural,
      discoveredBy: producer,
      sourceLocations: [input.location],
      evidence: [
        sourceSpanEvidence({
          producer,
          location: input.location,
          ...(input.symbol === undefined ? {} : { symbol: input.symbol }),
          ...(input.excerpt === undefined ? {} : { excerpt: input.excerpt }),
        }),
      ],
      ...(input.details === undefined ? {} : { details: input.details }),
      ...(input.sideEffect === undefined ? {} : { sideEffect: input.sideEffect }),
      ...(input.permissions === undefined ? {} : { permissions: input.permissions }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      ...(input.tags === undefined ? {} : { tags: input.tags }),
    };
  },
  configComponent: (input) => {
    const identity = configIdentity(input.kind, input.configFile, input.name);
    return {
      identity,
      kind: input.kind,
      displayName: input.displayName ?? input.name,
      ...(input.description === undefined ? {} : { description: input.description }),
      basis: 'discovered',
      confidence: input.confidence ?? CONFIDENCE_BANDS.deterministic,
      discoveredBy: producer,
      configLocations: [{ file: input.configFile, pointer: input.pointer }],
      evidence: [
        configEntryEvidence({
          producer,
          location: { file: input.configFile, pointer: input.pointer },
          ...(input.value === undefined ? {} : { value: input.value }),
        }),
      ],
      ...(input.details === undefined ? {} : { details: input.details }),
      ...(input.sideEffect === undefined ? {} : { sideEffect: input.sideEffect }),
      ...(input.permissions === undefined ? {} : { permissions: input.permissions }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      ...(input.tags === undefined ? {} : { tags: input.tags }),
    };
  },
  edge: (input) => {
    const evidence =
      input.location !== undefined
        ? sourceSpanEvidence({
            producer,
            location: input.location,
            ...(input.symbol === undefined ? {} : { symbol: input.symbol }),
          })
        : configEntryEvidence({
            producer,
            location: {
              file: input.configFile ?? 'unknown',
              pointer: input.pointer ?? '',
            },
          });
    return {
      kind: input.kind,
      from: input.from,
      to: input.to,
      basis: input.basis ?? 'discovered',
      confidence: input.confidence ?? CONFIDENCE_BANDS.strongStructural,
      discoveredBy: producer,
      ...(input.location === undefined ? {} : { sourceLocations: [input.location] }),
      ...(input.configFile === undefined
        ? {}
        : { configLocations: [{ file: input.configFile, pointer: input.pointer ?? '' }] }),
      evidence: [evidence],
      ...(input.policy === undefined ? {} : { policy: input.policy }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    };
  },
});
