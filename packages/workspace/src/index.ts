/**
 * The workspace: the composition root that turns a repository path into configuration, storage, redaction and
 * logging. Everything outward facing is constructed here and injected inward.
 */

export {
  type ConfigLoad,
  DEFAULT_CONFIG,
  loadConfig,
  STATE_GITIGNORE,
  writeConfig,
} from './config.ts';
export { DEFAULT_EXCLUDED_DIRECTORIES } from './excluded.ts';
export { type GitFacts, readGitFacts, resolveRevision } from './git.ts';
export {
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
