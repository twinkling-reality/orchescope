import { readFileSync, writeFileSync } from 'node:fs';
import { OrchescopeError, stableJson } from '@orchescope/domain';
import {
  formatIssues,
  MIN_READABLE_VERSIONS,
  type OrchescopeConfig,
  OrchescopeConfig as OrchescopeConfigSchema,
  SCHEMA_VERSIONS,
  validateDocument,
} from '@orchescope/schema';
import { DEFAULT_EXCLUDED_DIRECTORIES } from './excluded.ts';
import type { WorkspacePaths } from './paths.ts';

/**
 * Typed configuration.
 *
 * Defaults are chosen so that the first run of `orchescope audit` is read only and offline: no outbound network,
 * no paid models, no filesystem writes outside `.orchescope`, chaos limited to the local deterministic
 * environment. Anything that could cost money or change something outside the store has to be turned on
 * deliberately, and the refusal message names the setting.
 *
 * Configuration is read once at the edge and passed inward as a value. Nothing in the core reads a file.
 */

export const DEFAULT_CONFIG: OrchescopeConfig = {
  schemaVersion: SCHEMA_VERSIONS.config,
  analysis: {
    include: ['**/*'],
    exclude: [...DEFAULT_EXCLUDED_DIRECTORIES],
    maxFileBytes: 512 * 1024,
    maxFiles: 20_000,
    concurrency: 8,
    followSymlinks: false,
    timeoutMs: 120_000,
  },
  runtime: {
    receiverHost: '127.0.0.1',
    receiverPort: 0,
    maxSpansPerRun: 50_000,
    maxSpanAttributeBytes: 4_096,
    maxRequestBytes: 8 * 1024 * 1024,
    exportDrainMs: 400,
  },
  report: {
    host: '127.0.0.1',
    port: 0,
    openByDefault: false,
    retainReports: 20,
  },
  policy: {
    allowProcessSpawn: true,
    allowOutboundNetwork: false,
    allowPaidModels: false,
    allowFilesystemWrites: false,
    maxCostUsd: 0,
    maxRunDurationMs: 300_000,
    maxConcurrentRuns: 4,
    maxTotalRuns: 200,
    allowedChaosEnvironments: ['local_deterministic'],
    allowedCommands: [
      'node',
      'npm',
      'npx',
      'pnpm',
      'yarn',
      'python3',
      'python',
      'uv',
      'deno',
      'bun',
    ],
  },
  redaction: {
    extraPatterns: [],
    sensitiveEnvFragments: [],
  },
};

export type ConfigLoad = {
  readonly config: OrchescopeConfig;
  readonly source: 'defaults' | 'file';
  readonly problems: readonly string[];
};

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * Merges a partial configuration document over the defaults, one section at a time. A section is merged rather
 * than replaced so that setting one policy value does not silently reset the rest.
 */
const SECTIONS = ['analysis', 'runtime', 'report', 'policy', 'redaction'] as const;

/**
 * Settings that were real and are not any more.
 *
 * A retired setting is dropped with the reason stated rather than refused, because a configuration file is
 * committed to a repository and a user who upgrades should not have their audit fail on a key that used to work.
 * Refusing it would be honest and useless; dropping it silently would be neither.
 */
const RETIRED_SETTINGS: Readonly<Record<string, string>> = {
  semanticAnalysis:
    'model based analysis was removed in favour of deterministic analysis, so this setting no longer does anything and was ignored',
};

/**
 * A key that is present but wrong is refused rather than ignored.
 *
 * A misspelled setting that is silently dropped is how a user comes to believe they granted or denied something they did
 * not, which is the failure this check exists to prevent. Absence is fine: an absent key takes the default.
 */
const assertShape = (partial: Record<string, unknown>, file: string): void => {
  const problems: string[] = [];
  const known = new Set<string>([
    ...SECTIONS,
    ...Object.keys(RETIRED_SETTINGS),
    'schemaVersion',
    'projectName',
  ]);
  for (const key of Object.keys(partial)) {
    if (!known.has(key)) problems.push(`${key} is not a setting Orchescope understands`);
  }
  for (const section of SECTIONS) {
    const value = partial[section];
    if (value === undefined) continue;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      problems.push(`${section} must be an object`);
    }
  }
  if (partial['schemaVersion'] !== undefined && typeof partial['schemaVersion'] !== 'number') {
    problems.push('schemaVersion must be a number');
  }
  if (partial['projectName'] !== undefined && typeof partial['projectName'] !== 'string') {
    problems.push('projectName must be a string');
  }
  if (problems.length > 0) {
    throw new OrchescopeError(
      'CONFIG_INVALID',
      `The configuration is not valid: ${problems.join('; ')}`,
      {
        detail: { file },
        remediation:
          'Correct the reported fields, or delete the file to fall back to the defaults.',
      },
    );
  }
};

/**
 * A configuration written by an older build is read, not refused: the retired keys are named in the problems the
 * caller reports, and the document is validated at the version this build writes.
 */
const retiredSettings = (partial: Record<string, unknown>): readonly string[] =>
  Object.entries(RETIRED_SETTINGS)
    .filter(([key]) => partial[key] !== undefined)
    .map(([key, reason]) => `${key}: ${reason}`);

const mergeConfig = (partial: Record<string, unknown>): OrchescopeConfig => {
  const merged: Mutable<OrchescopeConfig> = {
    ...DEFAULT_CONFIG,
    analysis: { ...DEFAULT_CONFIG.analysis },
    runtime: { ...DEFAULT_CONFIG.runtime },
    report: { ...DEFAULT_CONFIG.report },
    policy: { ...DEFAULT_CONFIG.policy },
    redaction: { ...DEFAULT_CONFIG.redaction },
  };
  for (const section of SECTIONS) {
    const value = partial[section];
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      merged[section] = { ...merged[section], ...(value as object) } as never;
    }
  }
  if (typeof partial['projectName'] === 'string') merged.projectName = partial['projectName'];
  return merged;
};

export const loadConfig = (paths: WorkspacePaths): ConfigLoad => {
  let text: string;
  try {
    text = readFileSync(paths.configFile, 'utf8');
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') {
      return { config: DEFAULT_CONFIG, source: 'defaults', problems: [] };
    }
    throw new OrchescopeError('CONFIG_INVALID', 'The configuration file could not be read.', {
      cause: error,
      detail: { file: paths.configFile },
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    throw new OrchescopeError('CONFIG_INVALID', 'The configuration file is not valid JSON.', {
      cause: error,
      detail: { file: paths.configFile },
      remediation: 'Fix the JSON syntax, or delete the file to fall back to the defaults.',
    });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new OrchescopeError(
      'CONFIG_INVALID',
      'The configuration file must contain a JSON object.',
      {
        detail: { file: paths.configFile },
      },
    );
  }
  const document = parsed as Record<string, unknown>;
  assertShape(document, paths.configFile);
  const problems = retiredSettings(document);
  const merged = mergeConfig(document);
  const validated = validateDocument(
    OrchescopeConfigSchema,
    SCHEMA_VERSIONS.config,
    MIN_READABLE_VERSIONS.config,
    merged,
  );
  if (!validated.ok) {
    throw new OrchescopeError(
      'CONFIG_INVALID',
      `The configuration is not valid: ${formatIssues(validated.issues)}`,
      {
        detail: { file: paths.configFile },
        remediation:
          'Correct the reported fields, or delete the file to fall back to the defaults.',
      },
    );
  }
  return { config: validated.value as OrchescopeConfig, source: 'file', problems };
};

export const writeConfig = (paths: WorkspacePaths, config: OrchescopeConfig): void => {
  writeFileSync(paths.configFile, `${stableJson(config)}\n`, { mode: 0o600 });
};

export const STATE_GITIGNORE = `# Orchescope keeps analysis state here. Configuration is meant to be committed; state is not.
state/
cache/
`;
