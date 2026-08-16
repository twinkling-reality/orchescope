import { type Static, Type } from '@sinclair/typebox';
import { Component } from './component.ts';
import { Edge } from './edge.ts';
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

export const AdapterRun = Type.Object(
  {
    adapterId: NonEmptyString(),
    adapterVersion: NonEmptyString(),
    ecosystem: literals(['javascript', 'python', 'configuration', 'manifest', 'runtime'] as const),
    componentsFound: NonNegativeInt,
    edgesFound: NonNegativeInt,
    filesInspected: NonNegativeInt,
    durationMs: Type.Number({ minimum: 0 }),
    status: literals(['completed', 'not_applicable', 'failed'] as const),
    detail: Type.Optional(Type.String({ maxLength: 500 })),
  },
  { additionalProperties: false },
);
export type AdapterRun = Static<typeof AdapterRun>;

/**
 * Why an area is unsupported, separated because the three causes belong to different owners: a
 * language nobody has written a parser for is a limit of this release, an adapter that read nothing
 * from a framework it claims is a reader that is behind, and a discarded relation is a defect in the
 * adapter that reported it. A reader that has to match on prose cannot tell them apart.
 */
const UnsupportedAreaKind = literals([
  'language_not_analysed',
  'adapter_blind_spot',
  'discarded_relation',
] as const);

export const UnsupportedArea = Type.Object(
  {
    area: NonEmptyString({
      description: 'What Orchescope could not model, for example "Go source files".',
    }),
    kind: Type.Optional(UnsupportedAreaKind),
    reason: NonEmptyString(),
    remediation: Type.Optional(
      NonEmptyString({ description: 'How the user can supply the missing facts.' }),
    ),
  },
  { additionalProperties: false },
);
export type UnsupportedArea = Static<typeof UnsupportedArea>;

export const ScanCoverage = Type.Object(
  {
    filesDiscovered: NonNegativeInt,
    /**
     * How many of the discovered files are in a language this build reads.
     *
     * Without it, `filesParsed` over `filesDiscovered` reads as a coverage rate and measures something else: a
     * repository of a thousand test fixtures and six hundred Python files would report a third, when every Python
     * file was read. This is the denominator that means what a reader assumes it means.
     */
    filesInSupportedLanguages: Type.Optional(NonNegativeInt),
    filesParsed: NonNegativeInt,
    bytesParsed: NonNegativeInt,
    /**
     * How many files were skipped in total. `skipped` lists a bounded sample of them, because a repository with a
     * vendored dependency tree in it can skip thousands of files for one reason, and a list that long is not a
     * report. The count is separate so that bounding the list never changes the measurement.
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
