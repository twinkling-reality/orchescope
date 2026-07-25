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

export const UnsupportedArea = Type.Object(
  {
    area: NonEmptyString({
      description: 'What Orchescope could not model, for example "Go source files".',
    }),
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
    filesParsed: NonNegativeInt,
    bytesParsed: NonNegativeInt,
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
