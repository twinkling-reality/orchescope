import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createDeadline, fixedClock } from '@orchescope/domain';
import { DEFAULT_EXCLUDED_DIRECTORIES } from '@orchescope/source-analysis';
import {
  createTempWorkspace,
  LOOKALIKE_CONFIGURATIONS,
  writeNodeProject,
} from '@orchescope/testkit';
import { discover } from '../src/discover.ts';
import { DEFAULT_ADAPTERS } from '../src/registry.ts';

/**
 * The dependency property, stated over a repository that uses no framework at all.
 *
 * *A component attributed to an adapter whose declared packages the repository does not use must say whose
 * it is, and must not make the repository an agent system.* Both recorded precision failures were exactly
 * that: an adapter reached a repository through a configuration door rather than through a dependency, and
 * what it found there was reported as the repository's own.
 *
 * The repository below declares one ordinary web framework and imports nothing else, so no framework
 * adapter's packages are used and the property applies to every one of them without having to be told
 * which. The adapter set is read from `DEFAULT_ADAPTERS` rather than written out, which is what makes a
 * fourteenth reader covered on the day it declares its `packages` instead of on the day somebody remembers
 * to add it here. The shapes are the same table the corpus harness writes into every pinned repository that
 * is not an agent system; what runs here is the half that needs no checkout and no network, so it holds in
 * the gate a change has to pass rather than only in the corpus.
 */

const traversal = {
  maxFileBytes: 512 * 1024,
  maxFiles: 500,
  followSymlinks: false,
  excludeDirectories: DEFAULT_EXCLUDED_DIRECTORIES,
  excludePrefixes: [],
};

const workspaces: { dispose: () => void }[] = [];

after(() => {
  for (const workspace of workspaces) workspace.dispose();
});

const PACKAGE_DECLARING = DEFAULT_ADAPTERS.filter((adapter) => adapter.packages.length > 0);

const scanWith = async (file: string, contents: string) => {
  const workspace = createTempWorkspace('orchescope-lookalike-');
  workspaces.push(workspace);
  writeNodeProject(workspace, { name: 'deployments', dependencies: { express: '^4.19.0' } });
  workspace.write(
    'src/server.js',
    "const express = require('express');\nmodule.exports = express();\n",
  );
  workspace.write(file, contents);
  const clock = fixedClock(0);
  const handle = createDeadline(60_000, clock.monotonicMs);
  try {
    return await discover({
      root: workspace.root,
      projectName: 'lookalike',
      orchescopeVersion: '0.1.0',
      clock,
      deadline: handle,
      traversal,
      concurrency: 4,
    });
  } finally {
    handle.dispose();
  }
};

describe('a repository that uses no agent framework', () => {
  it('is measured against every adapter that claims one', () => {
    assert.ok(
      PACKAGE_DECLARING.length >= 8,
      `only ${PACKAGE_DECLARING.length} adapters declare packages, so this file is checking less than it says`,
    );
    assert.ok(
      LOOKALIKE_CONFIGURATIONS.length > 0,
      'the table of shapes that have fooled this build is empty',
    );
  });

  for (const shape of LOOKALIKE_CONFIGURATIONS) {
    it(`stays one when it holds ${shape.name} at ${shape.file}`, async () => {
      const result = await scanWith(shape.file, shape.contents);
      const attributed = result.graph.components.filter((component) =>
        component.discoveredBy.some((id) => PACKAGE_DECLARING.some((adapter) => adapter.id === id)),
      );

      for (const component of attributed) {
        const details = component.details;
        assert.equal(
          details !== undefined && 'role' in details ? details.role : undefined,
          'developer_tooling',
          `${component.id} was attributed to ${component.discoveredBy.join(', ')} in a repository using none of it, and says nothing about whose it is`,
        );
      }

      assert.equal(
        result.agentSystemDetected,
        false,
        `${shape.file} made a repository depending on express and nothing else an agent system`,
      );

      if (shape.outcome === 'declines') {
        assert.deepEqual(
          attributed.map((component) => component.id),
          [],
          `${shape.name} is meant to be declined`,
        );
      } else {
        assert.ok(
          attributed.length > 0,
          `${shape.name} is meant to be read as developer tooling and nothing read it, so this row tests nothing`,
        );
      }
    });
  }
});
