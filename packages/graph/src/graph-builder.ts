import {
  assertNoViolations,
  assignComponentIds,
  edgeId as buildEdgeId,
  componentViolations,
  dedupeEvidence,
  edgeViolations,
  evidenceId,
  identitiesAreUnique,
  identityFingerprint,
  identityKey,
  isTestFile,
  graphId as makeGraphId,
  OrchescopeError,
  sha256OfJson,
} from '@orchescope/domain';
import type {
  Component,
  ComponentId,
  ConfigLocation,
  Edge,
  Evidence,
  EvidenceId,
  GraphProvenance,
  ScanCoverage,
  Sha256Hex,
  SourceLocation,
  SystemGraph,
} from '@orchescope/schema';
import type { ComponentDraft, EdgeDraft } from './drafts.ts';
import {
  mergeBasis,
  mergeComponentEffectMetadata,
  mergeConfidence,
  mergeConfigLocations,
  mergeDetails,
  mergePermissions,
  mergePolicy,
  mergeRelationMetadata,
  mergeSideEffect,
  mergeSourceLocations,
  mergeStrings,
} from './merge.ts';

/**
 * Accumulates drafts from every adapter and produces one validated system graph.
 *
 * The builder is the only place component identifiers are minted, so identifier assignment sees the
 * whole scan and stays deterministic. Nothing is emitted that fails a domain invariant.
 */

/**
 * Whether every place that declares this is a test file.
 *
 * Asked here and in no adapter, because the answer is only true of the merged set. One adapter reading a
 * fixture and another reading the module it exercises describe one component, and either half asked on its
 * own gives the wrong answer: the fixture alone says the system does not declare it, and the module alone
 * says no test does. The builder is where the locations from every adapter meet, so it is the only place
 * that can be asked.
 *
 * That it is derived rather than set is the point. A new adapter is covered by writing the source location
 * it already writes, and the invariant cannot be honoured by four adapters out of thirteen again.
 */
const declaredOnlyInTests = (locations: Component['sourceLocations']): boolean =>
  locations.length > 0 && locations.every((location) => isTestFile(location.file));

type PendingComponent = {
  draft: ComponentDraft;
  presence: { static: boolean; runtime: boolean; manifest: boolean };
  sourceLocations: Component['sourceLocations'];
  configLocations: Component['configLocations'];
  permissions: Component['permissions'];
  discoveredBy: string[];
  evidenceIds: string[];
  tags: string[];
  metadata: Component['metadata'];
  basis: Component['basis'];
  confidence: number;
  details: Component['details'];
  sideEffect: Component['sideEffect'];
  description: string | undefined;
  displayName: string;
};

type PendingEdge = {
  draft: EdgeDraft;
  discoveredBy: string[];
  evidenceIds: string[];
  sourceLocations: Edge['sourceLocations'];
  configLocations: Edge['configLocations'];
  basis: Edge['basis'];
  confidence: number;
  policy: Edge['policy'];
  metadata: Edge['metadata'];
};

/**
 * The digest of a file as this scan read it, so a location can be checked rather than trusted.
 *
 * A component's declaration is spread across files: 39 agents in the pinned CrewAI examples now carry a
 * document entry and the call that builds it, in two files with two lifetimes. A location that names only a
 * path and a line is true of the revision it was read at and says nothing about any other, which is what
 * makes a stored graph, an exported bundle and a hand written manifest all unfalsifiable once the working
 * tree moves. The digest is what makes staleness detectable per file rather than per scan.
 *
 * Answered per path rather than carried on every fact, because the scan already knows the digest of every
 * file it parsed and a fact model that repeated it would carry one digest for every location instead of one
 * for every file.
 */
export type FileDigests = (path: string) => Sha256Hex | undefined;

const stampSource = (digests: FileDigests, location: SourceLocation): SourceLocation => {
  if (location.fileHash !== undefined) return location;
  const fileHash = digests(location.file);
  return fileHash === undefined ? location : { ...location, fileHash };
};

const stampConfig = (digests: FileDigests, location: ConfigLocation): ConfigLocation => {
  if (location.fileHash !== undefined) return location;
  const fileHash = digests(location.file);
  return fileHash === undefined ? location : { ...location, fileHash };
};

/**
 * Evidence carries the same location and is content addressed, so stamping it re-mints the identifier.
 *
 * That is the identifier being correct rather than being changed: an evidence record's identifier is the
 * digest of its content, and after this the content includes which revision of the file the span was read
 * from. Two scans of one revision still produce one record, and two scans across an edit now produce two,
 * which is the whole reason for writing the digest.
 */
const stampEvidence = (digests: FileDigests, record: Evidence): Evidence => {
  if (record.kind === 'source_span') {
    const location = stampSource(digests, record.location);
    if (location === record.location) return record;
    const { id: _minted, ...rest } = record;
    const stamped = { ...rest, location };
    return { ...stamped, id: evidenceId(stamped) as EvidenceId };
  }
  if (record.kind === 'config_entry') {
    const location = stampConfig(digests, record.location);
    if (location === record.location) return record;
    const { id: _minted, ...rest } = record;
    const stamped = { ...rest, location };
    return { ...stamped, id: evidenceId(stamped) as EvidenceId };
  }
  return record;
};

const defaultPresence = (draft: ComponentDraft) => ({
  static: draft.presence?.static ?? true,
  runtime: draft.presence?.runtime ?? false,
  manifest: draft.presence?.manifest ?? false,
});

/** A relation an adapter reported and the graph could not keep, with the adapter that produced it. */
export type DiscardedEdge = {
  readonly discoveredBy: readonly string[];
  readonly kind: string;
  readonly from: string;
  readonly to: string;
};

export type BuiltGraph = {
  readonly graph: SystemGraph;
  /** Every evidence record referenced by the graph, deduplicated and ready to persist. */
  readonly evidence: readonly Evidence[];
  /**
   * Relations discarded because an endpoint was never added.
   *
   * That is a defect in the adapter that reported the relation, and it used to end the whole scan. A repository
   * with three thousand files is not worth abandoning over one unbuildable relation, so the relation is dropped,
   * the graph stays valid, and the defect is reported with the adapter that caused it.
   */
  readonly discardedEdges: readonly DiscardedEdge[];
};

export class SystemGraphBuilder {
  private readonly components = new Map<string, PendingComponent>();
  private readonly edges = new Map<string, PendingEdge>();
  private readonly evidence = new Map<string, Evidence>();
  private readonly digests: FileDigests;

  /**
   * Every draft passes through here, which is why the digest is stamped here rather than in each producer.
   *
   * Thirteen adapters and the manifest reader all write locations, and a stamp applied per producer is one
   * a fourteenth would have to remember. A builder with no digests answers nothing and every location keeps
   * exactly what its producer wrote, which is what a test constructing a graph by hand wants.
   */
  constructor(digests: FileDigests = () => undefined) {
    this.digests = digests;
  }

  addComponent(draft: ComponentDraft): void {
    if (draft.identity.kind !== draft.kind) {
      throw new OrchescopeError(
        'INVALID_ARGUMENT',
        'Component draft kind and identity kind disagree.',
        {
          detail: { kind: draft.kind, identityKind: draft.identity.kind, name: draft.displayName },
        },
      );
    }
    const key = identityKey(draft.identity);
    const sourceLocations = (draft.sourceLocations ?? []).map((location) =>
      stampSource(this.digests, location),
    );
    const configLocations = (draft.configLocations ?? []).map((location) =>
      stampConfig(this.digests, location),
    );
    const evidenceIds = this.recordEvidence(draft.evidence);
    const existing = this.components.get(key);
    const presence = defaultPresence(draft);

    if (existing === undefined) {
      this.components.set(key, {
        draft,
        presence,
        sourceLocations,
        configLocations,
        permissions: [...(draft.permissions ?? [])],
        discoveredBy: [draft.discoveredBy],
        evidenceIds,
        tags: [...(draft.tags ?? [])],
        metadata: mergeComponentEffectMetadata(
          {},
          draft.metadata ?? {},
          undefined,
          draft.sideEffect,
          evidenceIds,
        ),
        basis: draft.basis,
        confidence: draft.confidence,
        details: draft.details,
        sideEffect: draft.sideEffect,
        description: draft.description,
        displayName: draft.displayName,
      });
      return;
    }

    existing.presence = {
      static: existing.presence.static || presence.static,
      runtime: existing.presence.runtime || presence.runtime,
      manifest: existing.presence.manifest || presence.manifest,
    };
    existing.sourceLocations = mergeSourceLocations(existing.sourceLocations, sourceLocations);
    existing.configLocations = mergeConfigLocations(existing.configLocations, configLocations);
    existing.permissions = mergePermissions(existing.permissions, draft.permissions ?? []);
    existing.discoveredBy = mergeStrings(existing.discoveredBy, [draft.discoveredBy]);
    existing.evidenceIds = mergeStrings(existing.evidenceIds, evidenceIds);
    existing.tags = mergeStrings(existing.tags, draft.tags ?? []);
    existing.metadata = mergeComponentEffectMetadata(
      existing.metadata,
      draft.metadata ?? {},
      existing.sideEffect,
      draft.sideEffect,
      evidenceIds,
    );
    existing.basis = mergeBasis(existing.basis, draft.basis);
    existing.confidence = mergeConfidence(existing.confidence, draft.confidence);
    existing.details = mergeDetails(existing.details, draft.details);
    existing.sideEffect = mergeSideEffect(existing.sideEffect, draft.sideEffect);
    existing.description = existing.description ?? draft.description;
  }

  addEdge(draft: EdgeDraft): void {
    const key = `${draft.kind}\u0000${identityKey(draft.from)}\u0000${identityKey(draft.to)}`;
    const sourceLocations = (draft.sourceLocations ?? []).map((location) =>
      stampSource(this.digests, location),
    );
    const configLocations = (draft.configLocations ?? []).map((location) =>
      stampConfig(this.digests, location),
    );
    const evidenceIds = this.recordEvidence(draft.evidence);
    const existing = this.edges.get(key);
    if (existing === undefined) {
      this.edges.set(key, {
        draft,
        discoveredBy: [draft.discoveredBy],
        evidenceIds,
        sourceLocations,
        configLocations,
        basis: draft.basis,
        confidence: draft.confidence,
        policy: draft.policy,
        metadata: mergeRelationMetadata({}, draft.metadata ?? {}, evidenceIds),
      });
      return;
    }
    existing.discoveredBy = mergeStrings(existing.discoveredBy, [draft.discoveredBy]);
    existing.evidenceIds = mergeStrings(existing.evidenceIds, evidenceIds);
    existing.sourceLocations = mergeSourceLocations(existing.sourceLocations, sourceLocations);
    existing.configLocations = mergeConfigLocations(existing.configLocations, configLocations);
    existing.basis = mergeBasis(existing.basis, draft.basis);
    existing.confidence = mergeConfidence(existing.confidence, draft.confidence);
    existing.policy = mergePolicy(existing.policy, draft.policy);
    existing.metadata = mergeRelationMetadata(existing.metadata, draft.metadata ?? {}, evidenceIds);
  }

  hasComponent(identity: Parameters<typeof identityKey>[0]): boolean {
    return this.components.has(identityKey(identity));
  }

  /**
   * Whether anything of these kinds has been added yet.
   *
   * Adapters run in a fixed order so that a cross cutting adapter can attach to what the framework adapters
   * found. This is how such an adapter asks whether there is anything to attach to, instead of contributing a
   * component that nothing in the repository connects to.
   */
  hasAnyOfKind(kinds: readonly Component['kind'][]): boolean {
    for (const pending of this.components.values()) {
      if (kinds.includes(pending.draft.kind)) return true;
    }
    return false;
  }

  get componentCount(): number {
    return this.components.size;
  }

  get edgeCount(): number {
    return this.edges.size;
  }

  private recordEvidence(records: readonly Evidence[]): string[] {
    const ids: string[] = [];
    for (const record of dedupeEvidence(
      records.map((entry) => stampEvidence(this.digests, entry)),
    )) {
      this.evidence.set(record.id, record);
      ids.push(record.id);
    }
    return ids;
  }

  build(input: {
    readonly provenance: Omit<GraphProvenance, 'runIds'> & { runIds?: readonly string[] };
    readonly coverage: ScanCoverage;
  }): BuiltGraph {
    const identities = [...this.components.values()].map((pending) => pending.draft.identity);
    const ids = assignComponentIds(identities);

    const components: Component[] = [...this.components.values()]
      .map((pending) => {
        const key = identityKey(pending.draft.identity);
        const id = ids.get(key);
        if (id === undefined) {
          throw new OrchescopeError(
            'INVALID_STATE',
            'Component identity was not assigned an identifier.',
            {
              detail: { identity: key },
            },
          );
        }
        const component: Component = {
          id,
          identity: pending.draft.identity,
          fingerprint: identityFingerprint(pending.draft.identity) as Sha256Hex,
          kind: pending.draft.kind,
          displayName: pending.displayName,
          ...(pending.description === undefined ? {} : { description: pending.description }),
          presence: pending.presence,
          basis: pending.basis,
          confidence: pending.confidence,
          discoveredBy: pending.discoveredBy,
          sourceLocations: pending.sourceLocations,
          configLocations: pending.configLocations,
          ...(declaredOnlyInTests(pending.sourceLocations) ? { declaredInTest: true } : {}),
          evidence: pending.evidenceIds,
          ...(pending.details === undefined ? {} : { details: pending.details }),
          ...(pending.sideEffect === undefined ? {} : { sideEffect: pending.sideEffect }),
          permissions: pending.permissions,
          aliases: [],
          tags: pending.tags,
          metadata: pending.metadata,
        };
        return component;
      })
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

    const componentIds = new Set(components.map((component) => component.id));

    const discardedEdges: DiscardedEdge[] = [];
    const edges: Edge[] = [...this.edges.values()]
      .flatMap((pending) => {
        const from = ids.get(identityKey(pending.draft.from));
        const to = ids.get(identityKey(pending.draft.to));
        if (from === undefined || to === undefined) {
          discardedEdges.push({
            discoveredBy: pending.discoveredBy,
            kind: pending.draft.kind,
            from: identityKey(pending.draft.from),
            to: identityKey(pending.draft.to),
          });
          return [];
        }
        const edge: Edge = {
          id: buildEdgeId(pending.draft.kind, from, to),
          kind: pending.draft.kind,
          from,
          to,
          basis: pending.basis,
          confidence: pending.confidence,
          discoveredBy: pending.discoveredBy,
          sourceLocations: pending.sourceLocations,
          configLocations: pending.configLocations,
          ...(declaredOnlyInTests(pending.sourceLocations) ? { declaredInTest: true } : {}),
          evidence: pending.evidenceIds,
          ...(pending.policy === undefined ? {} : { policy: pending.policy }),
          runtimeOnly: false,
          metadata: pending.metadata,
        };
        return [edge];
      })
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

    assertNoViolations(
      [
        ...identitiesAreUnique(components),
        ...components.flatMap((component) => componentViolations(component)),
        ...edges.flatMap((edge) => edgeViolations(edge, componentIds)),
      ],
      'Static graph construction',
    );

    const contentDigest = sha256OfJson({
      components: components.map((component) => component.fingerprint),
      edges: edges.map((edge) => edge.id),
    });

    const provenance: GraphProvenance = {
      ...input.provenance,
      runIds: [...(input.provenance.runIds ?? [])],
    };

    /*
     * Counted here because only the built set knows. Coverage is otherwise an input to this method, and a
     * caller cannot state how many components a test declared before the components exist.
     */
    const declaredInTest = components.filter(
      (component) => component.declaredInTest === true,
    ).length;

    const graph: SystemGraph = {
      schemaVersion: 1,
      graphId: makeGraphId({
        scanId: provenance.scanId,
        componentCount: components.length,
        edgeCount: edges.length,
        contentDigest,
      }),
      provenance,
      coverage: {
        ...input.coverage,
        ...(declaredInTest === 0 ? {} : { componentsDeclaredInTest: declaredInTest }),
      },
      components,
      edges,
      metadata: {},
    };

    return { graph, evidence: [...this.evidence.values()], discardedEdges };
  }
}

export const componentIdIndex = (graph: SystemGraph): ReadonlyMap<string, ComponentId> => {
  const index = new Map<string, ComponentId>();
  for (const component of graph.components)
    index.set(identityKey(component.identity), component.id);
  return index;
};
