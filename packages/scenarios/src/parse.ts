import {
  MIN_READABLE_VERSIONS,
  SCHEMA_VERSIONS,
  Scenario,
  type ValidationResult,
  validateDocument,
} from '@orchescope/schema';
import { parse as parseYaml } from 'yaml';

/**
 * Scenario parsing.
 *
 * A scenario file is authored by a human and committed to a repository, so it is treated as untrusted
 * input: the YAML is parsed as data and never evaluated, and the alias budget is bounded because an
 * expanding alias graph is an easy way to exhaust memory from a file that looks small.
 *
 * Defaults are filled before validation so that a short scenario is legal without restating the fields
 * that only have one sensible value. Validation then decides, and a rejection is returned rather than
 * thrown: the loader reports every broken file instead of stopping at the first one.
 */

const MAX_ALIAS_COUNT = 20;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const withTargetDefaults = (target: Record<string, unknown>): Record<string, unknown> => ({
  ...target,
  resultSource: target['resultSource'] ?? 'result_file',
  stopSignal: target['stopSignal'] ?? 'SIGTERM',
});

const withDefaults = (document: Record<string, unknown>): Record<string, unknown> => {
  const target = document['target'];
  return {
    ...document,
    schemaVersion: document['schemaVersion'] ?? SCHEMA_VERSIONS.scenario,
    evaluators: document['evaluators'] ?? [],
    faults: document['faults'] ?? [],
    budgets: document['budgets'] ?? {},
    requiredPermissions: document['requiredPermissions'] ?? [],
    tags: document['tags'] ?? [],
    metadata: document['metadata'] ?? {},
    repetitions: document['repetitions'] ?? 1,
    ...(isRecord(target) ? { target: withTargetDefaults(target) } : {}),
  };
};

export const parseScenario = (text: string, sourcePath: string): ValidationResult<Scenario> => {
  let document: unknown;
  try {
    document = parseYaml(text, { maxAliasCount: MAX_ALIAS_COUNT }) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'the document could not be parsed';
    return {
      ok: false,
      issues: [{ path: '/', message: `${sourcePath} is not valid YAML: ${reason}` }],
    };
  }
  if (!isRecord(document)) {
    return {
      ok: false,
      issues: [{ path: '/', message: `${sourcePath} does not contain a YAML mapping.` }],
    };
  }
  return validateDocument(
    Scenario,
    SCHEMA_VERSIONS.scenario,
    MIN_READABLE_VERSIONS.scenario,
    withDefaults(document),
  );
};
