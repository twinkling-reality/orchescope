import { type Static, Type } from '@sinclair/typebox';
import { ComponentKind, Permission, SideEffectClass } from './component.ts';
import { EdgeKind, EdgePolicy } from './edge.ts';
import { Document, literals, Metadata, NonEmptyString, RelativePath } from './primitives.ts';
import { SCHEMA_VERSIONS, schemaId } from './version.ts';

/**
 * The extension mechanism for systems Orchescope cannot read automatically.
 *
 * A manifest at `.orchescope/manifest.yaml` lets a project declare components and relations that no
 * bundled adapter understands, for example an agent written in a language with no adapter. Manifest
 * declared facts are labelled `discovered` with the manifest as their evidence, never `observed`,
 * and they are merged with automatic discovery rather than replacing it.
 */

export const ManifestComponent = Type.Object(
  {
    name: NonEmptyString({ description: 'Semantic name, becomes the component local name.' }),
    kind: ComponentKind,
    displayName: Type.Optional(NonEmptyString()),
    description: Type.Optional(Type.String({ maxLength: 1000 })),
    /** File the component is defined in, so the report can link to real source. */
    definedIn: Type.Optional(RelativePath),
    definedAtLine: Type.Optional(Type.Integer({ minimum: 1 })),
    sideEffect: Type.Optional(SideEffectClass),
    permissions: Type.Optional(Type.Array(Permission)),
    /** Name reported by the running system, used to match runtime spans to this declaration. */
    runtimeName: Type.Optional(NonEmptyString()),
    tags: Type.Optional(Type.Array(NonEmptyString())),
    metadata: Type.Optional(Metadata),
  },
  { additionalProperties: false },
);
export type ManifestComponent = Static<typeof ManifestComponent>;

export const ManifestEdge = Type.Object(
  {
    from: NonEmptyString({
      description: 'Component name declared in this manifest or discovered name.',
    }),
    to: NonEmptyString(),
    kind: EdgeKind,
    policy: Type.Optional(EdgePolicy),
    note: Type.Optional(Type.String({ maxLength: 500 })),
  },
  { additionalProperties: false },
);
export type ManifestEdge = Static<typeof ManifestEdge>;

export const Manifest = Document(
  schemaId('manifest'),
  SCHEMA_VERSIONS.manifest,
  Type.Object({
    project: Type.Optional(
      Type.Object(
        {
          name: Type.Optional(NonEmptyString()),
          description: Type.Optional(Type.String({ maxLength: 1000 })),
          ecosystem: Type.Optional(literals(['javascript', 'python', 'other'] as const)),
        },
        { additionalProperties: false },
      ),
    ),
    components: Type.Array(ManifestComponent),
    edges: Type.Array(ManifestEdge),
    /** Paths the project asks Orchescope to ignore, in addition to the defaults. */
    exclude: Type.Optional(Type.Array(NonEmptyString())),
  }),
);
export type Manifest = Static<typeof Manifest>;
