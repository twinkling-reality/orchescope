import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { createDeadline, fixedClock } from '@orchescope/domain';
import { ANALYZER_VERSION, analyzeFileSet, cacheKey, inMemoryFactCache } from '../src/analyzer.ts';
import { collectFiles, DEFAULT_EXCLUDED_DIRECTORIES } from '../src/file-set.ts';

/**
 * The cache exists for a process that scans one repository more than once, which is one process.
 *
 * `inMemoryFactCache` and the optional `cache` on a scan were written together and neither had a caller for
 * as long as they existed: a gate opening onto nothing, which is the shape ADR 0002 was written about. The
 * producer is `orchescope mcp serve`, a server a coding agent holds open while it works, and the loop this
 * repository documents is to scan, change something and scan again. Measured on the pinned checkouts, a
 * second scan in one process is 375ms against 4.0s on `crewai` and 352ms against 5.5s on `pydantic-ai`.
 *
 * The bound is the other half. A server watching a repository being edited would otherwise keep every
 * version of every file it ever parsed, which is a queue with no ceiling wearing a cache's name.
 */

const traversal = {
  maxFileBytes: 512 * 1024,
  maxFiles: 500,
  followSymlinks: false,
  excludeDirectories: DEFAULT_EXCLUDED_DIRECTORIES,
  excludePrefixes: [],
};

const roots: string[] = [];
const clock = fixedClock(0);

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const write = (root: string, file: string, text: string): void => {
  const target = join(root, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
};

const analyse = async (root: string, cache?: ReturnType<typeof inMemoryFactCache>) => {
  const deadline = createDeadline(30_000, clock.monotonicMs);
  try {
    return await analyzeFileSet(collectFiles(root, traversal), {
      deadline,
      concurrency: 4,
      ...(cache === undefined ? {} : { cache }),
    });
  } finally {
    deadline.dispose();
  }
};

const projectOf = (count: number): string => {
  const root = mkdtempSync(join(tmpdir(), 'orchescope-fact-cache-'));
  roots.push(root);
  for (let index = 0; index < count; index += 1) {
    write(root, `src/module${index}.ts`, `export const value${index} = ${index};\n`);
  }
  return root;
};

describe('the fact cache', () => {
  it('invalidates facts produced before router returns were retained', () => {
    assert.equal(ANALYZER_VERSION, '2');
    assert.match(
      cacheKey(
        {
          path: 'src/graph.py',
          absolutePath: '/fixture/src/graph.py',
          language: 'python',
          byteLength: 1,
        },
        'a'.repeat(64),
      ),
      /^2:python:src\/graph\.py:/,
    );
  });

  it('serves the second scan of a repository nothing has changed', async () => {
    const root = projectOf(4);
    const cache = inMemoryFactCache(traversal.maxFiles);

    const first = await analyse(root, cache);
    assert.equal(first.cacheHits, 0, 'an empty cache cannot serve anything');
    assert.equal(cache.size(), first.facts.length);

    const second = await analyse(root, cache);
    assert.equal(second.cacheHits, first.facts.length, 'every file was parsed again');
    assert.deepEqual(
      second.facts.map((module) => module.contentHash),
      first.facts.map((module) => module.contentHash),
      'the second scan produced different facts from the first',
    );
  });

  it('reparses the one file that changed and serves the rest', async () => {
    const root = projectOf(4);
    const cache = inMemoryFactCache(traversal.maxFiles);
    const first = await analyse(root, cache);

    write(root, 'src/module0.ts', 'export const value0 = 99;\n');
    const second = await analyse(root, cache);

    assert.equal(
      second.cacheHits,
      first.facts.length - 1,
      'the edit either invalidated everything or nothing',
    );
    assert.equal(
      cache.size(),
      first.facts.length + 1,
      'the earlier revision was not kept beside it',
    );
  });

  it('holds one whole scan and no more, so an editing session cannot grow it forever', async () => {
    const root = projectOf(6);
    const cache = inMemoryFactCache(6);
    await analyse(root, cache);
    assert.equal(cache.size(), 6);

    for (let revision = 0; revision < 5; revision += 1) {
      write(root, 'src/module0.ts', `export const value0 = ${revision};\n`);
      await analyse(root, cache);
      assert.equal(cache.size(), 6, `the cache grew past its capacity on revision ${revision}`);
    }
  });
});
