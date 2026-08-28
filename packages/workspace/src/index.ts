/**
 * The workspace: the composition root that turns a repository path into configuration, storage, redaction and
 * logging. Everything outward facing is constructed here and injected inward.
 */

export { type ConfigLoad, DEFAULT_CONFIG, loadConfig, writeConfig } from './config.ts';
export { DEFAULT_EXCLUDED_DIRECTORIES } from './excluded.ts';
export { type ExcludedConfig, excludedConfig } from './committable-config.ts';
export {
  type GitFacts,
  readGitFacts,
  readGitRepositoryPath,
  readTrackedPaths,
  resolveRevision,
} from './git.ts';
export {
  type ManifestTemplateResult,
  manifestTemplate,
  writeManifestTemplate,
} from './manifest-template.ts';
export type { ScenarioNeed } from './scenario-composition.ts';
export {
  type ScenarioTemplateResult,
  scenarioTemplate,
  writeScenarioTemplate,
} from './scenario-template.ts';
export {
  type InitOptions,
  type InitResult,
  initWorkspace,
  type OpenWorkspaceOptions,
  openWorkspace,
  type Workspace,
} from './open.ts';
export {
  ensureStateDirectories,
  ORCHESCOPE_DIRECTORY,
  parentDirectory,
  resolveInsideRoot,
  resolvePaths,
  type WorkspacePaths,
  workspaceExists,
} from './paths.ts';
