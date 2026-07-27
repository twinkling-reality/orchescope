/**
 * Directory names never entered during analysis.
 *
 * Duplicated from the traversal defaults on purpose: the workspace writes this list into a user editable
 * configuration file, and a user who removes an entry should get that behaviour rather than have it silently
 * restored. packages/usecases/test/excluded-directories.test.ts holds the two in step.
 */
export const DEFAULT_EXCLUDED_DIRECTORIES: readonly string[] = [
  '.git',
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  '.orchescope',
  'target',
  'vendor',
  '.tox',
  '.idea',
  '.vscode-test',
  'Pods',
  '.build',
  'DerivedData',
  'Carthage',
  '.gradle',
];
