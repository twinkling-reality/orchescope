import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { DEFAULT_ADAPTERS } from '../../packages/discovery/src/index.ts';
import { claimDifference, differences } from '../../scripts/corpus/comparison.mjs';
import {
  isOffline,
  isRequired,
  readCorpus,
  readCorpusDocument,
  readMultiRepositorySystems,
} from '../../scripts/corpus/definition.mjs';

/**
 * The corpus harness measured against itself.
 *
 * Two claims are made here. The corpus covers what it says it covers: every framework adapter this repository
 * claims appears in at least one entry, and enough repositories that are not agent systems are pinned to keep the
 * readers honest in the other direction. And the check is a real gate: a number that moves is reported with the
 * path that moved, which for an adapter that went quiet is the adapter's own identifier.
 */

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const execFileAsync = promisify(execFile);

/**
 * The adapters that claim a framework, derived rather than listed.
 *
 * This was a hand written array of six where the set is eight, omitting `adapter:mcp` and
 * `adapter:search-index`. Both happen to be covered, so nothing failed, and that is the point: a list
 * written by hand covers what its author remembered on the day, and a corpus entry that stops exercising
 * an adapter nobody listed goes quiet exactly as if it had never been added. It is the anti pattern
 * `rule-input-producers.test.ts` and `goal-eligible-rules.test.ts` were written to replace, and it was
 * sitting inside the test that guards the corpus.
 *
 * An adapter claims a framework by declaring the packages it reads, which is the same field discovery
 * compares against what a repository imports. A fourteenth reader is covered here on the day it declares
 * one.
 */
const FRAMEWORK_ADAPTERS = DEFAULT_ADAPTERS.filter((adapter) => adapter.packages.length > 0).map(
  (adapter) => adapter.id,
);

type Expectation = {
  readonly name: string;
  readonly kind: string;
  readonly agentSystemDetected: boolean;
  readonly adapters: Record<
    string,
    { readonly status: string; readonly componentsFound: number; readonly edgesFound: number }
  >;
};

const entries = readCorpus(repositoryRoot) as readonly {
  name: string;
  kind: string;
  source: string;
  url?: string;
  commit?: string;
  exercise?: unknown;
  requiredArchive?: {
    url: string;
    treeSha256: string;
    licensePath: string;
    licenseSha256: string;
  };
  acceptance?: {
    type?: string;
    expectedAgentSystemDetected?: boolean;
  };
}[];

const multiRepositorySystems = readMultiRepositorySystems(repositoryRoot) as readonly {
  name: string;
  repositories: readonly { name: string; url: string; commit: string }[];
  crossingEvidence: string;
  falsifier: string;
  exercise?: { runtimeRepository: string; script: string; nodePackages: readonly string[] };
}[];

const expectationOf = (name: string): Expectation =>
  JSON.parse(readFileSync(join(repositoryRoot, 'corpus/expected', `${name}.json`), 'utf8'));

describe('the corpus', () => {
  it('records an expectation for every pinned repository', () => {
    for (const entry of entries) {
      const path = join(repositoryRoot, 'corpus/expected', `${entry.name}.json`);
      assert.ok(existsSync(path), `${entry.name} has no recorded expectation`);
      const expectation = expectationOf(entry.name);
      assert.equal(expectation.name, entry.name);
      assert.equal(expectation.kind, entry.kind);
      const expectedDetection =
        entry.acceptance?.type === 'completed_zero'
          ? entry.acceptance.expectedAgentSystemDetected
          : entry.kind === 'agent_system';
      assert.equal(
        expectation.agentSystemDetected,
        expectedDetection,
        `${entry.name} has the wrong recorded classification`,
      );
    }
  });

  it('has a framework adapter set to cover, derived from the registry', () => {
    assert.ok(
      FRAMEWORK_ADAPTERS.length >= 8,
      `only ${FRAMEWORK_ADAPTERS.length} adapters claim a package, so this file covers less than it says`,
    );
  });

  it('covers every framework adapter this repository claims', () => {
    const contributing = new Set<string>();
    for (const entry of entries) {
      for (const [adapterId, run] of Object.entries(expectationOf(entry.name).adapters)) {
        if (run.componentsFound > 0 || run.edgesFound > 0) contributing.add(adapterId);
      }
    }
    const missing = FRAMEWORK_ADAPTERS.filter((adapter) => !contributing.has(adapter));
    assert.deepEqual(missing, [], `no corpus entry exercises ${missing.join(', ')}`);
  });

  it('pins repositories in both polarities, an offline subset and bounded required archives', () => {
    const precision = entries.filter((entry) => entry.kind === 'not_agent_system');
    assert.ok(
      precision.length >= 3,
      `a precision test needs at least three repositories that are not agent systems, saw ${precision.length}`,
    );
    assert.ok(entries.length >= 8, `the corpus holds ${entries.length} repositories`);
    assert.ok(
      entries.some((entry) => isOffline(entry)),
      'contributors need a network-free subset',
    );
    const requiredArchives = entries.filter((entry) => isRequired(entry) && !isOffline(entry));
    assert.equal(requiredArchives.length, 4);
    assert.ok(requiredArchives.some((entry) => entry.kind === 'agent_system'));
    assert.ok(requiredArchives.some((entry) => entry.kind === 'not_agent_system'));
    for (const entry of requiredArchives) {
      assert.equal(entry.exercise, undefined, `${entry.name} is not a static required entry`);
      assert.equal(
        entry.requiredArchive?.url,
        entry.url?.replace(
          /^https:\/\/github\.com\/(.+)\/(.+)\.git$/,
          `https://api.github.com/repos/$1/$2/tarball/${entry.commit}`,
        ),
      );
      assert.match(entry.requiredArchive?.treeSha256 ?? '', /^[0-9a-f]{64}$/);
      assert.match(entry.requiredArchive?.licenseSha256 ?? '', /^[0-9a-f]{64}$/);
    }
    const blindRegression = requiredArchives.find(
      (entry) => entry.name === 'local-deep-researcher',
    );
    assert.equal(blindRegression?.commit, 'a53b13c7022bb1352dc1ca994d07ade3cd3bd62e');
    assert.equal(
      blindRegression?.requiredArchive?.treeSha256,
      'c5b3e4993be4f26d27335ce5c2087b6cd9682c2eec4eed7ea35195b143fe514f',
    );
    assert.equal(blindRegression?.requiredArchive?.licensePath, 'LICENSE');
    assert.equal(
      blindRegression?.requiredArchive?.licenseSha256,
      'ed165e58751856b6d12fdb6372402f7c04e3bd8ceea5f928e3da343ab27d1021',
    );
  });

  it('pins every repository in a real multi-repository system by URL and revision', () => {
    assert.ok(multiRepositorySystems.length > 0, 'no multi-repository system is pinned');
    for (const system of multiRepositorySystems) {
      assert.ok(system.repositories.length >= 2, `${system.name} has fewer than two repositories`);
      assert.ok(
        system.crossingEvidence.includes('trace'),
        `${system.name} names no trace evidence`,
      );
      assert.ok(
        system.falsifier.toLowerCase().includes('refuse'),
        `${system.name} states no refusal`,
      );
      for (const coordinate of system.repositories) {
        const entry = entries.find((candidate) => candidate.name === coordinate.name);
        assert.equal(entry?.url, coordinate.url, `${system.name} has a stale URL`);
        assert.equal(entry?.commit, coordinate.commit, `${system.name} has a stale commit`);
      }
    }
  });

  it('records every exercised multi-repository system separately', () => {
    const exercised = multiRepositorySystems.filter((system) => system.exercise !== undefined);
    assert.ok(
      exercised.length > 0,
      'no multi-repository system can exercise its crossing evidence',
    );
    for (const system of exercised) {
      assert.ok(
        system.repositories.some(
          (repository) => repository.name === system.exercise?.runtimeRepository,
        ),
        `${system.name} stores its run outside the participating repositories`,
      );
      assert.ok(
        existsSync(join(repositoryRoot, 'corpus/expected', `${system.name}.federation.json`)),
        `${system.name} has no federated expectation`,
      );
    }
  });
});

describe('the corpus check', () => {
  const baseline = () => expectationOf('demonstration-system');

  it('reports nothing when a scan reproduces its expectation', () => {
    assert.deepEqual(differences(baseline(), baseline()), []);
  });

  it('compares list entries by their values rather than their object identities', () => {
    const expected = {
      coverage: [{ attribute: 'code.file.path', observedComponents: 3 }],
    };
    const same = {
      coverage: [{ observedComponents: 3, attribute: 'code.file.path' }],
    };
    assert.deepEqual(differences(expected, same), []);

    const moved = {
      coverage: [{ attribute: 'code.file.path', observedComponents: 2 }],
    };
    const found = differences(expected, moved);
    assert.equal(found.length, 2);
    assert.ok(found.every((difference) => difference.path === 'coverage'));
  });

  it('names the adapter when one goes quiet', () => {
    const observed = baseline();
    const broken = {
      ...observed,
      adapters: {
        ...observed.adapters,
        'adapter:manifest': {
          status: 'completed',
          componentsFound: 0,
          edgesFound: 0,
          filesInspected: 1,
        },
      },
    };
    const found = differences(baseline(), broken);
    assert.ok(found.length > 0, 'an adapter contributing nothing has to be a difference');
    for (const difference of found) {
      assert.match(
        difference.path,
        /^adapters\.adapter:manifest\./,
        `a difference outside the broken adapter was reported: ${difference.path}`,
      );
    }
    assert.ok(
      found.some((difference) => difference.expected === '18' && difference.observed === '0'),
      `expected the component count to be named, saw ${JSON.stringify(found)}`,
    );
  });

  it('holds the claim the corpus file makes, not only the recorded numbers', () => {
    const entry = { name: 'flask', kind: 'not_agent_system' };
    const verdict = { held: 0, total: 0, broken: [] };
    assert.equal(claimDifference(entry, { agentSystemDetected: false }, verdict), undefined);
    const difference = claimDifference(entry, { agentSystemDetected: true }, verdict);
    assert.equal(difference?.path, 'agentSystemDetected');
    assert.match(difference?.expected ?? '', /not_agent_system/);
  });

  it('passes over the offline subset', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [join(repositoryRoot, 'scripts/corpus.mjs'), '--check', '--offline'],
      {
        cwd: repositoryRoot,
        maxBuffer: 64 * 1024 * 1024,
        timeout: 240_000,
        env: { ...process.env, NO_COLOR: '1' },
      },
    );
    assert.match(stdout, /0 differing, 0 not measured/);
    assert.match(stdout, /parse rate/);
    assert.match(stdout, /adapters /);
    assert.match(stdout, /found nothing/);
  });
});

describe('required archive definitions', () => {
  const validEntry = {
    name: 'measured-repository',
    source: 'git',
    url: 'https://github.com/example/measured-repository.git',
    commit: '1'.repeat(40),
    kind: 'agent_system',
    why: 'It is a bounded real repository.',
    requiredArchive: {
      url: `https://api.github.com/repos/example/measured-repository/tarball/${'1'.repeat(40)}`,
      treeSha256: '2'.repeat(64),
      licensePath: 'LICENSE',
      licenseSha256: '3'.repeat(64),
    },
  };

  const readTemporary = (entry: object) => {
    const prefix = join(tmpdir(), 'orchescope-corpus-definition-');
    const root = mkdtempSync(prefix);
    if (!root.startsWith(prefix)) throw new Error('unexpected temporary corpus root');
    try {
      mkdirSync(join(root, 'corpus'));
      writeFileSync(
        join(root, 'corpus/corpus.yaml'),
        JSON.stringify({ schemaVersion: 2, repositories: [entry] }),
      );
      return readCorpusDocument(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  it('accepts a static Git entry whose archive repeats all exact pins', () => {
    assert.equal(readTemporary(validEntry).repositories[0]?.name, 'measured-repository');
  });

  it('rejects archive coordinates, digests, paths and exercise scope that are not exact', () => {
    const invalid = [
      {
        entry: {
          ...validEntry,
          requiredArchive: { ...validEntry.requiredArchive, url: 'https://example.com/source.tgz' },
        },
        message: /archive API URL for the exact clone and commit/,
      },
      {
        entry: {
          ...validEntry,
          requiredArchive: { ...validEntry.requiredArchive, treeSha256: 'short' },
        },
        message: /treeSha256 has to be a lowercase SHA-256/,
      },
      {
        entry: {
          ...validEntry,
          requiredArchive: { ...validEntry.requiredArchive, licensePath: '../LICENSE' },
        },
        message: /licensePath has to name a normalized repository-relative file/,
      },
      {
        entry: {
          ...validEntry,
          requiredArchive: { ...validEntry.requiredArchive, licenseSha256: 'short' },
        },
        message: /licenseSha256 has to be a lowercase SHA-256/,
      },
      {
        entry: {
          ...validEntry,
          exercise: {
            script: 'corpus/runs/example.mjs',
            nodePackages: ['example'],
            why: 'It runs an example.',
          },
        },
        message: /requiredArchive belongs to a static entry/,
      },
    ];
    for (const test of invalid) {
      assert.throws(() => readTemporary(test.entry), test.message);
    }
  });
});
