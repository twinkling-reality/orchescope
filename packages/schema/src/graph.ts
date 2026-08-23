import { type Static, Type } from '@sinclair/typebox';
import { Component } from './component.ts';
import { Edge } from './edge.ts';
import { SourceLocation } from './evidence.ts';
import { ComponentIdentity } from './identity.ts';
import {
  Document,
  literals,
  Metadata,
  NonEmptyString,
  NonNegativeInt,
  RelativePath,
  SemverString,
  Sha256Hex,
  Timestamp,
} from './primitives.ts';
import { SCHEMA_VERSIONS, schemaId } from './version.ts';

/**
 * Honest coverage reporting. A report that does not say what it failed to inspect is not evidence,
 * so the graph carries the skip list, the adapter list and the unsupported areas.
 */
export const SkippedFile = Type.Object(
  {
    file: RelativePath,
    reason: literals([
      'too_large',
      'binary',
      'parse_error',
      'unsupported_language',
      'ignored',
      'symlink',
      'unreadable',
      /**
       * Written by a program rather than by a person, recognised from the file rather than from its path.
       *
       * Kept apart from `ignored`, which means the configuration excluded it. A reader who sees a file
       * they did not exclude reported as ignored has been told the wrong thing about their own scan.
       */
      'generated',
    ] as const),
    detail: Type.Optional(Type.String({ maxLength: 500 })),
  },
  { additionalProperties: false },
);
export type SkippedFile = Static<typeof SkippedFile>;

const AdapterApplicabilitySample = Type.Object(
  {
    module: NonEmptyString(),
    imported: NonEmptyString(),
    location: SourceLocation,
  },
  { additionalProperties: false },
);

/**
 * Exact source imports that made an adapter relevant, with bounded auditable evidence.
 *
 * Optional for version 1 compatibility. `relevantImports` and `distinctFiles` are full counts;
 * `sample` is deterministic and `omittedImports` states the part outside its ceiling.
 */
const AdapterApplicability = Type.Object(
  {
    relevantImports: NonNegativeInt,
    distinctFiles: NonNegativeInt,
    sample: Type.Array(AdapterApplicabilitySample, { maxItems: 10 }),
    omittedImports: NonNegativeInt,
  },
  { additionalProperties: false },
);

export const AdapterRun = Type.Object(
  {
    adapterId: NonEmptyString(),
    adapterVersion: NonEmptyString(),
    /**
     * The languages of the files this run actually inspected.
     *
     * Measured rather than declared. The field it replaces was a constant on the adapter, so an adapter
     * covering both ecosystems had to pick one and six of them picked `javascript`: a Python majority
     * repository read its coverage block and was told, per adapter, that JavaScript had been read. The
     * fact model is language neutral by design, which is exactly why an adapter cannot answer this and
     * only the scan can.
     */
    languages: Type.Array(NonEmptyString()),
    componentsFound: NonNegativeInt,
    edgesFound: NonNegativeInt,
    filesInspected: NonNegativeInt,
    durationMs: Type.Number({ minimum: 0 }),
    status: literals(['completed', 'not_applicable', 'failed'] as const),
    applicability: Type.Optional(AdapterApplicability),
    detail: Type.Optional(Type.String({ maxLength: 500 })),
  },
  { additionalProperties: false },
);
export type AdapterRun = Static<typeof AdapterRun>;

/**
 * Why an area is unsupported, separated because the causes belong to different owners: a language
 * nobody has written a parser for is a limit of this release, an adapter that read nothing from a
 * framework it claims may be a reader that is behind, and a discarded relation is a defect in the
 * adapter that reported it. A reader that has to match on prose cannot tell them apart.
 *
 * `adapter_found_nothing` states what happened and stops there, which is the whole of the change from
 * the name it replaces. `adapter_blind_spot` said the gap was Orchescope's, while the reason travelling
 * beside it has always named two causes and declined to choose: either this build does not read the form
 * a repository uses, or that repository imports a framework as a client and declares nothing an adapter
 * could read. A kind that decides what the reason refuses to decide is an inference wearing the clothes
 * of an observation, which is the one thing this schema exists to keep apart.
 *
 * The old name is accepted for reading and never emitted, the way the trace attribute vocabulary handles
 * a convention that moved. That keeps a graph stored by an earlier build readable, so nothing has to be
 * migrated and no document version moves.
 */
const UnsupportedAreaKind = literals([
  'language_not_analysed',
  'adapter_found_nothing',
  'adapter_blind_spot',
  'discarded_relation',
  'topology_incomplete',
  /*
   * A directory the configuration excluded that the repository tracks files inside. The owner of this
   * one is the configuration rather than this build or the repository, which is why it is its own kind:
   * the remediation is a setting to narrow, not a parser to write or a form to report.
   */
  'excluded_from_analysis',
] as const);

export const UnsupportedArea = Type.Object(
  {
    area: NonEmptyString({
      description: 'What Orchescope could not model, for example "Go source files".',
    }),
    kind: Type.Optional(UnsupportedAreaKind),
    /** Missing means the gap can affect every property in version 1 documents. */
    scope: Type.Optional(literals(['control_flow', 'prompt_use'] as const)),
    reason: NonEmptyString(),
    remediation: Type.Optional(
      NonEmptyString({ description: 'How the user can supply the missing facts.' }),
    ),
  },
  { additionalProperties: false },
);
export type UnsupportedArea = Static<typeof UnsupportedArea>;

const TopologyProducerCoverage = Type.Object(
  {
    adapterId: NonEmptyString(),
    /** Missing means control flow for version 1 documents. */
    scope: Type.Optional(literals(['control_flow', 'prompt_use'] as const)),
    status: literals(['complete', 'incomplete'] as const),
    inspectedInputs: NonNegativeInt,
    relationsFound: NonNegativeInt,
  },
  { additionalProperties: false },
);

const TopologyBoundaryFact = Type.Object(
  {
    kind: literals(['entry', 'terminal'] as const),
    location: SourceLocation,
  },
  { additionalProperties: false },
);

const TopologyConfigurationBound = Type.Object(
  {
    name: NonEmptyString(),
    /** Static literal default. It is not an observed value or proof that validation rejects negatives. */
    defaultValue: Type.Integer(),
    reference: SourceLocation,
    declaration: SourceLocation,
  },
  { additionalProperties: false },
);

const TopologyUnresolved = Type.Object(
  {
    kind: literals([
      'node_registration',
      'explicit_relation',
      'conditional_destination',
      'entry_boundary',
      'terminal_boundary',
      'config_backed_bound',
      'adapter_input',
      'prompt_input',
    ] as const),
    /** Missing means control flow for version 1 documents. */
    scope: Type.Optional(literals(['control_flow', 'prompt_use'] as const)),
    reason: NonEmptyString({ maxLength: 500 }),
    location: Type.Optional(SourceLocation),
  },
  { additionalProperties: false },
);

/**
 * Evidence population over which topology properties may be claimed.
 *
 * Optional for version 1 compatibility. Absence means unknown, not complete. Counts name the whole
 * inspected population; the bounded arrays are samples that retain enough source context to investigate
 * a handled boundary, configuration ceiling, or refusal without making graph size unbounded.
 */
export const TopologyCoverage = Type.Object(
  {
    status: literals(['complete', 'incomplete'] as const),
    producers: Type.Array(TopologyProducerCoverage),
    inspectedInputs: NonNegativeInt,
    explicitRelations: NonNegativeInt,
    conditionalConstructs: NonNegativeInt,
    conditionalDestinations: NonNegativeInt,
    entryBoundaries: NonNegativeInt,
    /** Full deterministic identities reached by handled entry boundaries; never derived from the bounded sample. */
    entryTargets: Type.Array(ComponentIdentity),
    terminalBoundaries: NonNegativeInt,
    boundaryFacts: Type.Array(TopologyBoundaryFact, { maxItems: 10 }),
    configurationBounds: NonNegativeInt,
    configurationBoundFacts: Type.Array(TopologyConfigurationBound, { maxItems: 10 }),
    unresolvedCount: NonNegativeInt,
    /** Exact full-population counts; missing keeps an earlier version 1 document conservative. */
    controlFlowUnresolvedCount: Type.Optional(NonNegativeInt),
    promptUseUnresolvedCount: Type.Optional(NonNegativeInt),
    unresolved: Type.Array(TopologyUnresolved, { maxItems: 10 }),
  },
  { additionalProperties: false },
);
export type TopologyCoverage = Static<typeof TopologyCoverage>;

export const ScanCoverage = Type.Object(
  {
    /**
     * Files traversal reached and recognised as some language, whether or not this build parses it.
     *
     * These four counts are four different sets and not a partition, and a reader who adds them expecting
     * one is right to be confused. A discovered file may be in a language nothing here reads, so it is
     * counted here and not in `filesInSupportedLanguages`. A skipped path may never have been discovered
     * at all, because a directory declined before it is entered takes its contents with it and is counted
     * once. Each number answers its own question and none of them is the remainder of another.
     */
    filesDiscovered: NonNegativeInt,
    /**
     * How many files the index lists, which is the only whole a reader can check the rest against.
     *
     * Absent where the root is not a checkout, because then nothing states what the repository is and a
     * count of what traversal happened to reach would be this build marking its own paper.
     *
     * Every other count here is a population this build chose. This one is the repository's own, so it is
     * what makes the difference between them visible: on one field report's target, 4224 tracked against
     * 4043 discovered leaves 181 files that no count in this block reached, 176 of them in extensions the
     * language map does not name and so counted nowhere at all.
     */
    filesTracked: Type.Optional(NonNegativeInt),
    /**
     * How many of the discovered files are in a language this build reads.
     *
     * Without it, `filesParsed` over `filesDiscovered` reads as a coverage rate and measures something else: a
     * repository of a thousand test fixtures and six hundred Python files would report a third, when every Python
     * file was read. This is the denominator that means what a reader assumes it means.
     */
    filesInSupportedLanguages: Type.Optional(NonNegativeInt),
    /** How many of the files in a language this build reads were actually read. */
    filesParsed: NonNegativeInt,
    bytesParsed: NonNegativeInt,
    /**
     * How many paths were skipped in total, files and declined directories together.
     *
     * A directory is one entry standing for everything inside it, because traversal stops at a directory
     * it does not enter and never learns what was there. Excluding those entries from the count was how a
     * repository came to report `filesSkipped: 0` with six tracked source files removed.
     *
     * `skipped` lists a bounded sample, because a repository with a vendored dependency tree in it can
     * skip thousands of files for one reason and a list that long is not a report. The count is separate
     * so that bounding the list never changes the measurement.
     */
    filesSkipped: Type.Optional(NonNegativeInt),
    skipped: Type.Array(SkippedFile),
    languages: Type.Array(
      Type.Object(
        { language: NonEmptyString(), fileCount: NonNegativeInt },
        { additionalProperties: false },
      ),
    ),
    adapters: Type.Array(AdapterRun),
    /** Missing on old graphs and scans whose producers did not state an inspected topology population. */
    topology: Type.Optional(TopologyCoverage),
    /**
     * How many discovered components every source location of which is a test file.
     *
     * The rules whose population is the system under audit leave these out, so without the count a reader
     * is shown a smaller answer than the scan produced and nothing says why. It belongs beside the other
     * disclosures rather than in the component totals, because it is a statement about what was read and
     * not about what the repository declares.
     */
    componentsDeclaredInTest: Type.Optional(NonNegativeInt),
    unsupported: Type.Array(UnsupportedArea),
    durationMs: Type.Number({ minimum: 0 }),
    /** True when analysis was cut short by a deadline or a resource limit. */
    truncated: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type ScanCoverage = Static<typeof ScanCoverage>;

/**
 * Provenance never contains an absolute path. Exported graphs are shareable, and a home directory
 * layout is user data.
 */
export const GraphProvenance = Type.Object(
  {
    orchescopeVersion: SemverString,
    scanId: Type.String({ pattern: '^scan_[0-9a-f]{16}$' }),
    projectId: Type.String({ pattern: '^prj_[0-9a-f]{16}$' }),
    projectName: NonEmptyString(),
    generatedAt: Timestamp,
    git: Type.Optional(
      Type.Object(
        {
          commit: Type.Optional(Type.String({ pattern: '^[0-9a-f]{7,40}$' })),
          ref: Type.Optional(NonEmptyString()),
          repositoryUrl: Type.Optional(NonEmptyString()),
          /** Git-root-relative path of the scan root, absent when the two roots are equal. */
          repositoryPath: Type.Optional(RelativePath),
          dirty: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
    ),
    /** Digest of the repository root path, so two machines can tell the same project apart. */
    projectPathHash: Sha256Hex,
    /** Run identifiers whose runtime evidence is folded into this graph. */
    runIds: Type.Array(NonEmptyString()),
  },
  { additionalProperties: false },
);
export type GraphProvenance = Static<typeof GraphProvenance>;

export const SystemGraph = Document(
  schemaId('systemGraph'),
  SCHEMA_VERSIONS.systemGraph,
  Type.Object({
    graphId: Type.String({ pattern: '^graph_[0-9a-f]{16}$' }),
    provenance: GraphProvenance,
    coverage: ScanCoverage,
    components: Type.Array(Component),
    edges: Type.Array(Edge),
    metadata: Metadata,
  }),
);
export type SystemGraph = Static<typeof SystemGraph>;
