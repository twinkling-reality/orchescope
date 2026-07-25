import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';

/**
 * Manifest reading, the cheapest discovery layer.
 *
 * Dependencies establish which model providers, agent frameworks and adapters a project could be using
 * before a single source file is parsed, which is what makes the rest of discovery targeted rather than
 * exhaustive. Every reader is total: a malformed manifest produces a recorded problem, never an
 * exception that ends a scan.
 */

export type DeclaredDependency = {
  readonly name: string;
  readonly versionRange: string | undefined;
  readonly ecosystem: 'npm' | 'pypi';
  readonly manifest: string;
  readonly development: boolean;
};

export type ManifestSet = {
  readonly projectName: string | undefined;
  readonly dependencies: readonly DeclaredDependency[];
  readonly manifests: readonly string[];
  readonly problems: readonly { readonly file: string; readonly detail: string }[];
  readonly ecosystems: readonly ('javascript' | 'python')[];
};

type Problem = { file: string; detail: string };

const readJson = (root: string, relativePath: string, problems: Problem[]): unknown => {
  try {
    return JSON.parse(readFileSync(join(root, relativePath), 'utf8')) as unknown;
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return undefined;
    problems.push({
      file: relativePath,
      detail: error instanceof Error ? error.message : 'could not be read',
    });
    return undefined;
  }
};

const readText = (root: string, relativePath: string, problems: Problem[]): string | undefined => {
  try {
    return readFileSync(join(root, relativePath), 'utf8');
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return undefined;
    problems.push({
      file: relativePath,
      detail: error instanceof Error ? error.message : 'could not be read',
    });
    return undefined;
  }
};

const recordDependencyMap = (
  value: unknown,
  manifest: string,
  development: boolean,
  into: DeclaredDependency[],
): void => {
  if (typeof value !== 'object' || value === null) return;
  for (const [name, range] of Object.entries(value as Record<string, unknown>)) {
    into.push({
      name,
      versionRange: typeof range === 'string' ? range : undefined,
      ecosystem: 'npm',
      manifest,
      development,
    });
  }
};

/** Splits a PEP 508 requirement into its distribution name and the remainder. */
export const parsePythonRequirement = (
  requirement: string,
): { readonly name: string; readonly versionRange: string | undefined } | undefined => {
  const trimmed = requirement.split('#')[0]?.trim() ?? '';
  if (trimmed.length === 0 || trimmed.startsWith('-')) return undefined;
  const withoutExtras = trimmed.replace(/\[[^\]]*\]/, '');
  const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(.*)$/.exec(withoutExtras);
  if (match?.[1] === undefined) return undefined;
  const rest = (match[2] ?? '').trim();
  return {
    name: match[1].toLowerCase(),
    versionRange: rest.length === 0 ? undefined : rest,
  };
};

const readPackageJson = (
  root: string,
  problems: Problem[],
  dependencies: DeclaredDependency[],
  manifests: string[],
): string | undefined => {
  const parsed = readJson(root, 'package.json', problems);
  if (parsed === undefined) return undefined;
  manifests.push('package.json');
  if (typeof parsed !== 'object' || parsed === null) {
    problems.push({ file: 'package.json', detail: 'the manifest is not a JSON object' });
    return undefined;
  }
  const manifest = parsed as Record<string, unknown>;
  recordDependencyMap(manifest['dependencies'], 'package.json', false, dependencies);
  recordDependencyMap(manifest['optionalDependencies'], 'package.json', false, dependencies);
  recordDependencyMap(manifest['peerDependencies'], 'package.json', false, dependencies);
  recordDependencyMap(manifest['devDependencies'], 'package.json', true, dependencies);
  const name = manifest['name'];
  return typeof name === 'string' ? name : undefined;
};

/** Optional dependency groups are development dependencies: they are not needed to run the system. */
const collectPythonRequirements = (
  declared: unknown,
  dependencies: DeclaredDependency[],
  development: boolean,
): void => {
  if (!Array.isArray(declared)) return;
  for (const entry of declared) {
    if (typeof entry !== 'string') continue;
    const requirement = parsePythonRequirement(entry);
    if (requirement === undefined) continue;
    dependencies.push({
      name: requirement.name,
      versionRange: requirement.versionRange,
      ecosystem: 'pypi',
      manifest: 'pyproject.toml',
      development,
    });
  }
};

const readPyProject = (
  root: string,
  problems: Problem[],
  dependencies: DeclaredDependency[],
  manifests: string[],
): string | undefined => {
  const text = readText(root, 'pyproject.toml', problems);
  if (text === undefined) return undefined;
  manifests.push('pyproject.toml');
  let parsed: unknown;
  try {
    parsed = parseToml(text);
  } catch (error) {
    problems.push({
      file: 'pyproject.toml',
      detail: error instanceof Error ? error.message : 'could not be parsed',
    });
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const project = (parsed as Record<string, unknown>)['project'];
  if (typeof project !== 'object' || project === null) return undefined;
  const table = project as Record<string, unknown>;
  collectPythonRequirements(table['dependencies'], dependencies, false);
  const optional = table['optional-dependencies'];
  if (typeof optional === 'object' && optional !== null) {
    for (const group of Object.values(optional as Record<string, unknown>)) {
      collectPythonRequirements(group, dependencies, true);
    }
  }
  const name = table['name'];
  return typeof name === 'string' ? name : undefined;
};

const REQUIREMENT_FILES = ['requirements.txt', 'requirements-dev.txt', 'requirements/base.txt'];

const readRequirements = (
  root: string,
  problems: Problem[],
  dependencies: DeclaredDependency[],
  manifests: string[],
): void => {
  for (const file of REQUIREMENT_FILES) {
    const text = readText(root, file, problems);
    if (text === undefined) continue;
    manifests.push(file);
    for (const line of text.split('\n')) {
      const requirement = parsePythonRequirement(line);
      if (requirement === undefined) continue;
      dependencies.push({
        name: requirement.name,
        versionRange: requirement.versionRange,
        ecosystem: 'pypi',
        manifest: file,
        development: file.includes('dev'),
      });
    }
  }
};

export const readManifests = (root: string): ManifestSet => {
  const problems: Problem[] = [];
  const dependencies: DeclaredDependency[] = [];
  const manifests: string[] = [];

  const npmName = readPackageJson(root, problems, dependencies, manifests);
  const pythonName = readPyProject(root, problems, dependencies, manifests);
  readRequirements(root, problems, dependencies, manifests);

  const ecosystems: ('javascript' | 'python')[] = [];
  if (
    dependencies.some((entry) => entry.ecosystem === 'npm') ||
    manifests.includes('package.json')
  ) {
    ecosystems.push('javascript');
  }
  if (
    dependencies.some((entry) => entry.ecosystem === 'pypi') ||
    manifests.some((file) => file !== 'package.json')
  ) {
    ecosystems.push('python');
  }

  return {
    projectName: npmName ?? pythonName,
    dependencies,
    manifests,
    problems,
    ecosystems,
  };
};

/** True when any declared dependency name matches one of the given names exactly. */
export const hasDependency = (
  manifests: ManifestSet,
  names: readonly string[],
): DeclaredDependency | undefined =>
  manifests.dependencies.find((entry) => names.includes(entry.name));
