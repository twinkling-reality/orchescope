import { type Static, Type } from '@sinclair/typebox';
import { ComponentDetails, ComponentKind, Permission, SideEffectClass } from './component.ts';
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

const manifestComponentProperties = {
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
};

const ManifestComponentV1 = Type.Object(manifestComponentProperties, {
  additionalProperties: false,
});

export const ManifestComponent = Type.Object(
  {
    ...manifestComponentProperties,
    /** Kind-specific facts, under the same discriminated vocabulary as a discovered component. */
    details: Type.Optional(ComponentDetails),
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

const manifestProperties = <T extends typeof ManifestComponent | typeof ManifestComponentV1>(
  component: T,
) =>
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
    components: Type.Array(component),
    edges: Type.Array(ManifestEdge),
    /** Paths the project asks Orchescope to ignore, in addition to the defaults. */
    exclude: Type.Optional(Type.Array(NonEmptyString())),
  });

/** Closed version 1 shape retained so a readable older document cannot smuggle in version 2 fields. */
export const ManifestV1 = Document(
  'urn:orchescope:schema:manifest:1',
  1,
  manifestProperties(ManifestComponentV1),
);

export const Manifest = Document(
  schemaId('manifest'),
  SCHEMA_VERSIONS.manifest,
  manifestProperties(ManifestComponent),
);
export type Manifest = Static<typeof Manifest>;
