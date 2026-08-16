import {
  type Clock,
  formatTimestamp,
  projectId as makeProjectId,
  sha256Hex,
} from '@orchescope/domain';
import {
  createLogger,
  type Logger,
  type ProgressReporter,
  silentProgress,
} from '@orchescope/observability';
import {
  type ArtifactStore,
  createArtifactStore,
  createStore,
  type Database,
  openDatabase,
  type Store,
} from '@orchescope/persistence';
import { createRedactor, type Redactor } from '@orchescope/redaction';
import type { OrchescopeConfig, Sha256Hex } from '@orchescope/schema';
import { DEFAULT_CONFIG, loadConfig, writeConfig } from './config.ts';
import { type ExcludedConfig, excludedConfig } from './committable-config.ts';
import { type GitFacts, readGitFacts } from './git.ts';
import { type ManifestTemplateResult, writeManifestTemplate } from './manifest-template.ts';
import {
  ensureStateDirectories,
  resolvePaths,
  type WorkspacePaths,
  workspaceExists,
} from './paths.ts';

/**
 * Opening a workspace.
 *
 * This is the composition root for everything that touches the outside world: configuration, the database, the
 * artifact store, redaction, logging and git facts are constructed here and passed inward as values. No core
 * package reaches back out for them.
 */

export type Workspace = {
  readonly paths: WorkspacePaths;
  readonly config: OrchescopeConfig;
  readonly configSource: 'defaults' | 'file';
  /**
   * What the load had to say about the file it read: a setting that was retired, or one that moved.
   *
   * Carried rather than discarded because both notes existed and neither reached a reader. A file whose
   * keys were quietly relocated works, and the operator who reads it next has no idea why it no longer
   * matches the documentation.
   */
  readonly configProblems: readonly string[];
  readonly projectId: string;
  readonly projectName: string;
  readonly projectPathHash: Sha256Hex;
  readonly git: GitFacts | undefined;
  readonly store: Store;
  readonly database: Database;
  readonly artifacts: ArtifactStore;
  readonly redactor: Redactor;
  readonly logger: Logger;
  readonly progress: ProgressReporter;
  readonly clock: Clock;
  readonly close: () => void;
};

export type OpenWorkspaceOptions = {
  readonly root: string;
  readonly clock?: Clock;
  readonly progress?: ProgressReporter;
  readonly logSink?: Parameters<typeof createLogger>[0]['sink'];
  readonly logLevel?: 'debug' | 'info' | 'warning' | 'error';
  /** Overrides for a single invocation, for example a command line flag. Not written to disk. */
  readonly overrides?: (config: OrchescopeConfig) => OrchescopeConfig;
};

const systemClock: Clock = {
  now: () => formatTimestamp(Date.now()),
  monotonicMs: () => Number(process.hrtime.bigint() / 1_000_000n),
};

export const openWorkspace = (options: OpenWorkspaceOptions): Workspace => {
  const paths = resolvePaths(options.root);
  const clock = options.clock ?? systemClock;
  const loaded = loadConfig(paths);
  const config = options.overrides === undefined ? loaded.config : options.overrides(loaded.config);

  ensureStateDirectories(paths);

  const redactor = createRedactor({
    extraPatterns: config.redaction.extraPatterns,
    ...(config.redaction.sensitiveEnvFragments.length > 0
      ? { sensitiveFragments: config.redaction.sensitiveEnvFragments }
      : {}),
  });
  const logger = createLogger({
    level: options.logLevel ?? 'warning',
    sink:
      options.logSink ??
      (() => {
        // A workspace opened by a library caller stays silent unless a sink is supplied.
      }),
    redactor,
  });

  const database = openDatabase(paths.databaseFile);
  const artifacts = createArtifactStore(paths.artifacts, database, clock.now);
  const store = createStore({ database, artifacts, now: clock.now });

  const projectPathHash = sha256Hex(paths.root) as Sha256Hex;
  const projectId = makeProjectId(projectPathHash);
  const projectName = config.projectName ?? paths.root.split('/').pop() ?? 'project';
  const git = readGitFacts(paths.root);
  store.ensureProject(projectId, projectName, projectPathHash);

  return {
    paths,
    config,
    configSource: loaded.source,
    configProblems: loaded.problems,
    projectId,
    projectName,
    projectPathHash,
    git,
    store,
    database,
    artifacts,
    redactor,
    logger,
    progress: options.progress ?? silentProgress,
    clock,
    close: () => database.close(),
  };
};

export type InitResult = {
  readonly created: boolean;
  readonly configFile: string;
  readonly alreadyExisted: boolean;
  /** Present when a manifest template was asked for, whether or not it had to be written. */
  readonly manifest?: ManifestTemplateResult;
  /**
   * The git rule excluding the configuration file, when one does.
   *
   * Init tells a reader the file is meant to be committed. When a rule higher up the tree excludes the
   * whole directory, that sentence is false and only git can say so, so the answer travels with the
   * result rather than being asserted by the sentence.
   */
  readonly configIgnoredBy?: ExcludedConfig;
};

export type InitOptions = {
  readonly projectName?: string;
  /** Writes `.orchescope/manifest.yaml` from the template unless a manifest already exists. */
  readonly manifest?: boolean;
};

/**
 * Creates the workspace directory and a configuration file with the defaults written out in full, so the
 * settings are discoverable by reading the file rather than by reading the documentation.
 */
export const initWorkspace = (root: string, options: InitOptions = {}): InitResult => {
  const paths = resolvePaths(root);
  const existed = workspaceExists(paths);
  ensureStateDirectories(paths);
  if (!existed) {
    writeConfig(paths, {
      ...DEFAULT_CONFIG,
      ...(options.projectName === undefined ? {} : { projectName: options.projectName }),
    });
  }
  const ignoredBy = excludedConfig(paths.root);
  return {
    created: !existed,
    configFile: paths.configFile,
    alreadyExisted: existed,
    ...(options.manifest === true ? { manifest: writeManifestTemplate(paths) } : {}),
    ...(ignoredBy === undefined ? {} : { configIgnoredBy: ignoredBy }),
  };
};
