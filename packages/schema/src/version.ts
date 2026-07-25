/**
 * Every persisted or exported Orchescope document carries a `schemaVersion`.
 *
 * Rules for changing a version:
 *  - Adding an optional property is a compatible change and does not bump the version.
 *  - Removing a property, renaming a property, narrowing an enum or changing a meaning
 *    is a breaking change and requires a version bump plus a migration in @orchescope/persistence.
 *  - A reader must refuse a document whose version it does not know how to read.
 */

export const SCHEMA_VERSIONS = {
  systemGraph: 1,
  finding: 1,
  scenario: 1,
  scenarioResult: 1,
  benchmark: 1,
  chaos: 1,
  comparison: 1,
  goal: 1,
  report: 1,
  traceBundle: 1,
  manifest: 1,
  config: 2,
} as const;

export type SchemaName = keyof typeof SCHEMA_VERSIONS;

/** URN of a document schema, used as the JSON Schema `$id` and in exported artifacts. */
export const schemaId = (name: SchemaName): string =>
  `urn:orchescope:schema:${kebab(name)}:${SCHEMA_VERSIONS[name]}`;

const kebab = (value: string): string => value.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/**
 * The lowest document version this build can read for each schema. Kept explicit so that
 * dropping support for an old artifact is a deliberate, reviewable change.
 */
export const MIN_READABLE_VERSIONS: Record<SchemaName, number> = {
  systemGraph: 1,
  finding: 1,
  scenario: 1,
  scenarioResult: 1,
  benchmark: 1,
  chaos: 1,
  comparison: 1,
  goal: 1,
  report: 1,
  traceBundle: 1,
  manifest: 1,
  config: 1,
};
