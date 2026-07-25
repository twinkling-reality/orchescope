import { type SchemaOptions, type Static, type TSchema, Type } from '@sinclair/typebox';

/**
 * Shared primitive schemas. Every persisted Orchescope document is built from these so that
 * emitted JSON Schema, runtime validation and TypeScript types cannot drift apart.
 */

export const NonEmptyString = (options: SchemaOptions = {}) =>
  Type.String({ minLength: 1, ...options });

/**
 * RFC 3339 timestamp in UTC with millisecond precision.
 *
 * Constrained with `pattern` rather than `format` so that Orchescope, browsers and third party
 * JSON Schema validators all agree without a format vocabulary being registered first.
 */
export const Timestamp = Type.String({
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
  description: 'UTC timestamp, RFC 3339 with millisecond precision.',
});
export type Timestamp = Static<typeof Timestamp>;

export const Sha256Hex = Type.String({
  pattern: '^[0-9a-f]{64}$',
  description: 'Lowercase hexadecimal SHA-256 digest.',
});
export type Sha256Hex = Static<typeof Sha256Hex>;

export const ShortHash = Type.String({
  pattern: '^[0-9a-f]{6,16}$',
  description: 'Truncated lowercase hexadecimal digest used for human readable disambiguation.',
});

export const SemverString = Type.String({
  pattern: '^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$',
});

/**
 * Confidence in a claim, expressed on a continuous scale. Bands used by Orchescope:
 * 0.95 and above deterministic evidence, 0.75 to 0.95 strong structural evidence,
 * 0.5 to 0.75 heuristic match, below 0.5 weak signal that must never drive a high severity finding.
 */
export const Confidence = Type.Number({
  minimum: 0,
  maximum: 1,
  description: 'Confidence in the claim, from 0 to 1.',
});
export type Confidence = Static<typeof Confidence>;

export const NonNegativeInt = Type.Integer({ minimum: 0 });
export const PositiveInt = Type.Integer({ minimum: 1 });
export const NonNegativeNumber = Type.Number({ minimum: 0 });

/** Repository relative POSIX path. Absolute paths and parent traversal are rejected. */
export const RelativePath = Type.String({
  minLength: 1,
  pattern: '^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$)).+$',
  description: 'Repository relative POSIX path.',
});
export type RelativePath = Static<typeof RelativePath>;

export const OneBasedLine = Type.Integer({ minimum: 1 });
export const ZeroBasedColumn = Type.Integer({ minimum: 0 });

/**
 * Free-form metadata attached to graph elements. Values are restricted to JSON scalars and
 * shallow arrays so that metadata can be rendered, diffed and hashed deterministically.
 */
export const MetadataValue = Type.Union([
  Type.String(),
  Type.Number(),
  Type.Boolean(),
  Type.Null(),
  Type.Array(Type.Union([Type.String(), Type.Number(), Type.Boolean()])),
]);
export type MetadataValue = Static<typeof MetadataValue>;

export const Metadata = Type.Record(Type.String(), MetadataValue, {
  description: 'Shallow, JSON scalar metadata. Never used to carry secrets.',
});
export type Metadata = Static<typeof Metadata>;

/** A closed union of string literals. Kept as a helper so validation and JSON Schema agree. */
export const literals = <const T extends readonly string[]>(
  values: T,
  options: SchemaOptions = {},
) =>
  Type.Union(
    values.map((value) => Type.Literal(value)),
    options,
  ) as unknown as TSchema & { static: T[number] };

export const Document = <T extends TSchema>(
  schemaId: string,
  version: number,
  properties: T,
  options: SchemaOptions = {},
) =>
  Type.Composite([Type.Object({ schemaVersion: Type.Literal(version) }), properties], {
    $id: schemaId,
    additionalProperties: false,
    ...options,
  });
