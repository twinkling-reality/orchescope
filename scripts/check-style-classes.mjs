#!/usr/bin/env node
/**
 * Fail when a new conflicting CSS class property appears across apps/web/src/styles.
 *
 * Sharing a class across files is normal in this design system: overview retunes primitives, and
 * layout files compose the same tile. What must not grow quietly is a second owner that sets the
 * same property to a different value, which is how `.progress` rendered at the wrong height. The
 * current conflicts are recorded in `style-class-baseline.json`; this check fails only on additions.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stylesDir = path.join(root, 'apps/web/src/styles');
const baselinePath = path.join(root, 'scripts/style-class-baseline.json');
const writeBaseline = process.argv.includes('--write-baseline');

/** @param {string} text @param {number} from */
function skipComment(text, from) {
  const end = text.indexOf('*/', from + 2);
  return end === -1 ? text.length : end + 2;
}

/** @param {string} text @param {number} openIndex */
function skipBlock(text, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    if (text.startsWith('/*', i)) {
      i = skipComment(text, i) - 1;
      continue;
    }
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return text.length - 1;
}

/** @param {string} text @param {number} from */
function skipAtRule(text, from) {
  let i = from;
  while (i < text.length && text[i] !== '{' && text[i] !== ';') i += 1;
  if (text[i] === ';') return i + 1;
  if (text[i] === '{') return skipBlock(text, i) + 1;
  return text.length;
}

/** @param {string} body */
function flattenRuleBody(body) {
  let flat = '';
  for (let i = 0; i < body.length; ) {
    if (body.startsWith('/*', i)) {
      i = skipComment(body, i);
      continue;
    }
    if (body[i] === '{') {
      i = skipBlock(body, i) + 1;
      continue;
    }
    flat += body[i];
    i += 1;
  }
  return flat;
}

/** @param {string} body @returns {Map<string, string>} */
function properties(body) {
  /** @type {Map<string, string>} */
  const props = new Map();
  for (const part of flattenRuleBody(body).split(';')) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    const prop = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 1).trim();
    if (prop.length === 0 || value.length === 0 || prop.startsWith('--')) continue;
    props.set(prop, value);
  }
  return props;
}

/** @param {string} selector */
function classNames(selector) {
  return [...selector.matchAll(/(?:^|[,\s>+~])\.([A-Za-z_][\w-]*)/g)].map((match) => match[1]);
}

/**
 * @param {string} text
 * @returns {Map<string, Map<string, string>>}
 */
function classDeclarations(text) {
  /** @type {Map<string, Map<string, string>>} */
  const out = new Map();
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('/*', i)) {
      i = skipComment(text, i);
      continue;
    }
    if (text[i] === '@') {
      i = skipAtRule(text, i);
      continue;
    }
    if (text[i] === '{') {
      i = skipBlock(text, i) + 1;
      continue;
    }
    const open = text.indexOf('{', i);
    if (open === -1) break;
    const selector = text.slice(i, open).trim();
    const close = skipBlock(text, open);
    const props = properties(text.slice(open + 1, close));
    i = close + 1;
    if (props.size === 0) continue;
    for (const name of classNames(selector)) {
      const existing = out.get(name) ?? new Map();
      for (const [prop, value] of props) existing.set(prop, value);
      out.set(name, existing);
    }
  }
  return out;
}

/** @returns {Promise<string[]>} */
async function collectConflicts() {
  const files = (await readdir(stylesDir)).filter((name) => name.endsWith('.css')).sort();
  /** @type {Map<string, { file: string, props: Map<string, string> }[]>} */
  const byClass = new Map();

  for (const file of files) {
    if (file === 'responsive.css') continue;
    const text = await readFile(path.join(stylesDir, file), 'utf8');
    for (const [name, props] of classDeclarations(text)) {
      const list = byClass.get(name) ?? [];
      list.push({ file, props });
      byClass.set(name, list);
    }
  }

  /** @type {string[]} */
  const conflicts = [];
  for (const [name, owners] of [...byClass.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (owners.length < 2) continue;
    for (let i = 0; i < owners.length; i += 1) {
      for (let j = i + 1; j < owners.length; j += 1) {
        const left = owners[i];
        const right = owners[j];
        for (const [prop, value] of left.props) {
          const other = right.props.get(prop);
          if (other !== undefined && other !== value) {
            conflicts.push(`.${name} ${prop}: ${left.file}="${value}" vs ${right.file}="${other}"`);
          }
        }
      }
    }
  }
  return conflicts.sort();
}

const conflicts = await collectConflicts();

if (writeBaseline) {
  await writeFile(baselinePath, `${JSON.stringify(conflicts, null, 2)}\n`);
  console.log(`wrote ${conflicts.length} conflict(s) to ${path.relative(root, baselinePath)}`);
  process.exit(0);
}

/** @type {string[]} */
let baseline = [];
try {
  baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
} catch (error) {
  console.error(
    `Missing style-class baseline at ${path.relative(root, baselinePath)}. Run with --write-baseline.`,
  );
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const baselineSet = new Set(baseline);
const novel = conflicts.filter((entry) => !baselineSet.has(entry));
const resolved = baseline.filter((entry) => !conflicts.includes(entry));

if (novel.length === 0) {
  console.log(
    `style classes: ${conflicts.length} known conflict(s), ${resolved.length} resolved since baseline`,
  );
  if (resolved.length > 0) {
    console.log('Resolved (safe to drop from the baseline with --write-baseline):');
    for (const entry of resolved) console.log(`  ${entry}`);
  }
  process.exit(0);
}

console.error('New conflicting CSS class property values (not in the baseline):');
for (const entry of novel) console.error(`  ${entry}`);
console.error(
  'Rename one of the owners, or if the conflict is intentional refresh the baseline with --write-baseline.',
);
process.exit(1);
