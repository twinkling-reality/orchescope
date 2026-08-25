/**
 * Internal markdown links must resolve. Code is not a link.
 *
 * `listeners[i](1)` is a call. A grep pattern that contains parentheses is a pattern. The previous
 * checker matched every `](...)` in the file, including those inside fences and backticks, and then
 * treated the captured text as a path. That is how two documents that contain no hyperlink failed
 * the gate, and why the check has to strip code before it looks for links.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOTS = [
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'AGENTS.md',
  'PLANS.md',
  'CODE_OF_CONDUCT.md',
];

const walkMarkdown = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walkMarkdown(path);
    return path.endsWith('.md') ? [path] : [];
  });

/** Remove fenced and inline code so a call or a regex cannot be read as a hyperlink. */
export const proseOf = (markdown) =>
  markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');

export const internalTargets = (markdown) => {
  const targets = [];
  for (const match of proseOf(markdown).matchAll(/\]\(([^)#][^)]*)\)/g)) {
    const target = match[1]?.split('#')[0] ?? '';
    if (target.length === 0 || /^[a-z]+:/.test(target)) continue;
    targets.push(target);
  }
  return targets;
};

export const brokenInternalLinks = (files) => {
  const broken = [];
  for (const file of files) {
    for (const target of internalTargets(readFileSync(file, 'utf8'))) {
      if (!existsSync(resolve(dirname(file), target))) broken.push(`${file} -> ${target}`);
    }
  }
  return broken;
};

export const documentationFiles = (root) =>
  DEFAULT_ROOTS.filter((file) => existsSync(join(root, file)))
    .map((file) => join(root, file))
    .concat(existsSync(join(root, 'docs')) ? walkMarkdown(join(root, 'docs')) : []);

const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const files = documentationFiles(root);
  const broken = brokenInternalLinks(files);
  if (broken.length > 0) {
    throw new Error(`broken links:\n${broken.join('\n')}`);
  }
  console.log(`${files.length} documents checked, every internal link resolves`);
}
