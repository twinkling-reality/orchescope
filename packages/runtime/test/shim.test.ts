import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildTargetEnv } from '../src/session.ts';
import { locateShim, targetRunsNode, withShim } from '../src/shim.ts';

/**
 * Deciding whether a target can be instrumented, and getting the shim into it without changing anything
 * else about how it runs.
 *
 * The second half is the part with teeth. `NODE_OPTIONS` is an environment variable a project may already
 * be using for something it needs, and a tracer that overwrote it would have changed how the program runs
 * in order to watch it run.
 */

describe('which targets the shim can reach', () => {
  it('recognises the ways a Node program is started, including through a package manager', () => {
    for (const command of ['node', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'deno']) {
      assert.equal(targetRunsNode([command, 'start']), true, `${command} runs a Node process`);
    }
    assert.equal(targetRunsNode(['/usr/local/bin/node', 'main.js']), true);
    assert.equal(targetRunsNode(['npm.cmd', 'start']), true);
  });

  /*
   * The boundary from the field report. A traced integration suite spawned `wrangler dev`, so the server
   * under test ran in workerd as a child process and `NODE_OPTIONS` meant nothing to it. Saying so is the
   * difference between a reader learning where their system actually runs and concluding it is silent.
   */
  it('knows it cannot reach a target that is not a Node process', () => {
    for (const command of ['python3', 'uvicorn', 'docker', 'wrangler', 'go', './server']) {
      assert.equal(targetRunsNode([command, 'run']), false, `${command} is not a Node process`);
    }
    assert.equal(targetRunsNode([]), false);
  });
});

describe('putting the shim in the environment', () => {
  it('adds itself to what the environment already asked for rather than replacing it', () => {
    assert.equal(
      withShim('--max-old-space-size=4096', '/opt/orchescope/instrument.mjs'),
      '--max-old-space-size=4096 --import "/opt/orchescope/instrument.mjs"',
    );
  });

  it('quotes the path, because an installation directory may contain a space', () => {
    assert.equal(
      withShim(undefined, '/Users/a b/orchescope/instrument.mjs'),
      '--import "/Users/a b/orchescope/instrument.mjs"',
    );
  });

  it('sets nothing when the run is not injecting a shim', () => {
    const env = buildTargetEnv({
      baseEnv: { NODE_OPTIONS: '--enable-source-maps' },
      endpoint: 'http://127.0.0.1:4318',
      serviceName: 'fixture',
      runId: 'run_0000000000000001',
      resultFile: '/tmp/result.json',
    });
    assert.equal(env['NODE_OPTIONS'], '--enable-source-maps');
  });

  it('exports the endpoint and the run identifier the shim gates itself on', () => {
    const env = buildTargetEnv({
      baseEnv: {},
      endpoint: 'http://127.0.0.1:4318',
      serviceName: 'fixture',
      runId: 'run_0000000000000001',
      resultFile: '/tmp/result.json',
      shimPath: '/opt/orchescope/instrument.mjs',
    });
    assert.match(env['NODE_OPTIONS'] ?? '', /--import "\/opt\/orchescope\/instrument\.mjs"/);
    assert.equal(env['ORCHESCOPE_OTLP_ENDPOINT'], 'http://127.0.0.1:4318');
    assert.equal(env['ORCHESCOPE_RUN_ID'], 'run_0000000000000001');
  });
});

describe('finding the shim on disk', () => {
  /*
   * Two layouts have to work: an installed bundle with the shim beside it, and a source checkout running
   * the TypeScript directly. Asserting it resolves in this one rather than describing which layout this is
   * means a change to either layout fails here instead of silently disabling instrumentation.
   */
  it('resolves in the layout this test is running in', () => {
    const found = locateShim(import.meta.url);
    assert.ok(found !== undefined, 'the shim has to be findable from the runtime package');
    assert.match(found, /instrument(ation\/src\/register\.ts|\.mjs)$/);
  });

  it('reports absence rather than guessing when there is no shim beside it', () => {
    assert.equal(locateShim('file:///nowhere/that/exists/session.ts'), undefined);
  });
});
