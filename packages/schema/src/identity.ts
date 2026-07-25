import { type Static, Type } from '@sinclair/typebox';
import { literals, NonEmptyString, ShortHash } from './primitives.ts';

/**
 * Component identity.
 *
 * An identity key is the semantic address of a component and never contains a line number,
 * a display label or a byte offset. Two scans of the same repository produce the same identity
 * key for a component as long as the component still means the same thing, even when the file
 * around it was edited, reformatted or moved within its module.
 *
 * `namespace` is the stable container of the component:
 *   - source defined components: the module path relative to the project root without extension
 *   - configuration defined components: the configuration file path relative to the project root
 *   - runtime only components: the literal string `runtime`
 *   - manifest declared components: the literal string `manifest`
 *
 * `localName` is the semantic name inside that namespace: an agent name, a tool name, a model
 * identifier, an MCP server key. It comes from the analysed source or configuration, never from a
 * generated label.
 */
export const ComponentIdentity = Type.Object(
  {
    kind: Type.String({ minLength: 1, description: 'ComponentKind of the identified component.' }),
    namespace: NonEmptyString({
      description: 'Stable container: module path, configuration path, "runtime" or "manifest".',
    }),
    localName: NonEmptyString({
      description: 'Semantic name of the component inside its namespace.',
    }),
  },
  { additionalProperties: false },
);
export type ComponentIdentity = Static<typeof ComponentIdentity>;

/**
 * Human readable, deterministic component identifier: `kind:slug` and, when two components in a
 * scan would otherwise collide, `kind:slug~<6 hex>` derived from the namespace.
 *
 * Identifiers appear in CLI output, findings, goals and MCP responses, so readability matters.
 */
export const ComponentId = Type.String({
  pattern: '^[a-z_]+:[a-z0-9@][a-z0-9_.@/-]*(?:~[0-9a-f]{6})?$',
  description:
    'Stable component identifier, for example "agent:orchestrator" or "tool:refund~1a2b3c".',
});
export type ComponentId = Static<typeof ComponentId>;

export const EdgeId = Type.String({
  pattern: '^[a-z_]+:[0-9a-f]{16}$',
  description: 'Stable edge identifier derived from edge kind plus endpoint identities.',
});
export type EdgeId = Static<typeof EdgeId>;

/**
 * How a component identity relates to the previous scan. Recorded so that a rename can be
 * distinguished from a deletion plus an addition when graphs are compared.
 */
export const IdentityContinuity = literals(['new', 'unchanged', 'renamed', 'merged'] as const, {
  description: 'Relationship of this identity to the identity observed in the compared scan.',
});
export type IdentityContinuity = Static<typeof IdentityContinuity>;

export const ComponentAlias = Type.Object(
  {
    identity: ComponentIdentity,
    reason: literals(['renamed', 'runtime_merge', 'manifest_merge'] as const),
    disambiguator: Type.Optional(ShortHash),
  },
  { additionalProperties: false },
);
export type ComponentAlias = Static<typeof ComponentAlias>;
