import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ADAPTERS } from '../../packages/discovery/src/index.ts';

/**
 * The adapter guide is a page an author copies, so what it declares has to be what the interface is.
 *
 * It drifted, and nothing said so: it declared an `ecosystem` field that does not exist, omitted `packages`
 * entirely, passed `filesInspected: files.size` where the type is a list of paths, and imported three
 * helpers from a module that does not export them. Every one of those is a compile error in an adapter
 * written by following it, and the page had no way to fail.
 *
 * Both checks here derive their expectation from the build rather than restating it, which is what makes a
 * fourteenth field or a moved helper fail here on the day it moves.
 */

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const guide = join(repositoryRoot, 'docs/guides/adapter-development.md');

const typescriptBlocks = (markdown: string): readonly string[] => {
  const blocks: string[] = [];
  const pattern = /```ts\n([\s\S]*?)\n```/g;
  for (;;) {
    const match = pattern.exec(markdown);
    if (match === null) break;
    blocks.push(match[1] ?? '');
  }
  return blocks;
};

/** Every value import in the guide, as the module it names and the bindings it takes from it. */
const valueImports = (block: string): readonly { module: string; names: readonly string[] }[] => {
  const imports: { module: string; names: readonly string[] }[] = [];
  const pattern = /^import\s+\{([^}]+)\}\s+from\s+'([^']+)';$/gm;
  for (;;) {
    const match = pattern.exec(block);
    if (match === null) break;
    const names = (match[1] ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0 && !name.startsWith('type '));
    if (names.length > 0) imports.push({ module: match[2] ?? '', names });
  }
  return imports;
};

/**
 * Where a relative specifier in the guide points. The examples are written as a file would be, from inside
 * `packages/discovery/src/adapters`, which is where an author puts one.
 */
const resolveModule = (specifier: string): string =>
  specifier.startsWith('.')
    ? join(repositoryRoot, 'packages/discovery/src', specifier.replace(/^\.\.\//, ''))
    : join(repositoryRoot, 'packages', specifier.replace('@orchescope/', ''), 'src/index.ts');

describe('the adapter guide', () => {
  const blocks = typescriptBlocks(readFileSync(guide, 'utf8'));

  it('has the examples it is meant to check', () => {
    assert.ok(blocks.length >= 2, `found ${blocks.length} TypeScript blocks in the guide`);
  });

  it('imports only bindings the modules it names actually export', async () => {
    for (const block of blocks) {
      for (const entry of valueImports(block)) {
        const module: Record<string, unknown> = await import(resolveModule(entry.module));
        for (const name of entry.names) {
          assert.ok(
            name in module,
            `the guide imports ${name} from ${entry.module}, which does not export it`,
          );
        }
      }
    }
  });

  it('declares exactly the fields an adapter declares', () => {
    const example = blocks.find((block) => block.includes(': AgentSystemAdapter = {'));
    assert.ok(example !== undefined, 'the guide no longer shows an adapter');
    const declared = new Set(
      example
        .split('\n')
        .map((line) => /^ {2}(\w+):/.exec(line)?.[1])
        .filter((name): name is string => name !== undefined),
    );
    const real = DEFAULT_ADAPTERS[0];
    assert.ok(real !== undefined, 'no adapter is registered');
    assert.deepEqual(
      [...declared].sort(),
      Object.keys(real).sort(),
      'the guide and the registered adapters do not declare the same fields',
    );
  });
});
