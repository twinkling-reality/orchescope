import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { SCHEMA_VERSIONS } from '@orchescope/schema';
import { DEFAULT_CONFIG, loadConfig } from '../src/config.ts';
import { resolvePaths } from '../src/paths.ts';

/**
 * Configuration is committed to a repository, so a build that retires a setting meets files that still carry it.
 * Refusing them would be honest and useless; dropping them silently is neither honest nor useless. The rule here is
 * that a retired setting is ignored and said out loud.
 */

const roots: string[] = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const withConfig = (document: unknown) => {
  const root = mkdtempSync(join(tmpdir(), 'orchescope-config-'));
  roots.push(root);
  const paths = resolvePaths(root);
  mkdirSync(paths.orchescope, { recursive: true });
  writeFileSync(paths.configFile, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
  return loadConfig(paths);
};

describe('loadConfig', () => {
  it('reads a configuration written before model based analysis was removed', () => {
    const loaded = withConfig({
      schemaVersion: 1,
      semanticAnalysis: {
        enabled: true,
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        apiKeyEnv: 'ANTHROPIC_API_KEY',
        maxTasks: 4,
        maxTokensPerTask: 4000,
        maxCostUsd: 1,
        requestTimeoutMs: 60000,
      },
      policy: { allowOutboundNetwork: true },
    });
    assert.equal(loaded.source, 'file');
    assert.equal(loaded.config.schemaVersion, SCHEMA_VERSIONS.config);
    assert.equal(
      loaded.config.policy.allowOutboundNetwork,
      true,
      'the rest of the file still applies',
    );
    assert.equal(loaded.problems.length, 1);
    assert.match(loaded.problems[0] ?? '', /^semanticAnalysis: /);
    assert.match(loaded.problems[0] ?? '', /no longer does anything/);
    assert.equal(
      'semanticAnalysis' in (loaded.config as Record<string, unknown>),
      false,
      'a retired setting must not survive into the configuration the product uses',
    );
  });

  /*
   * The two settings that decide whether a process starts used to sit beside the ones constraining
   * Orchescope itself, and a reader taking the block as a whole concluded that a traced command was
   * sandboxed. A file written before the split still names them where they were, and it is read rather
   * than refused, for the same reason a retired setting is dropped rather than refused: the file is
   * committed to a repository and an upgrade should not fail an audit on a key that used to work.
   */
  it('reads a configuration written before the execution settings moved out of policy', () => {
    const loaded = withConfig({
      schemaVersion: 2,
      policy: { allowProcessSpawn: false, allowedCommands: ['node'], allowPaidModels: true },
    });
    assert.equal(loaded.config.execution.allowProcessSpawn, false);
    assert.deepEqual(loaded.config.execution.allowedCommands, ['node']);
    assert.equal(loaded.config.policy.allowPaidModels, true, 'the rest of the block still applies');
    assert.equal(
      'allowProcessSpawn' in (loaded.config.policy as Record<string, unknown>),
      false,
      'a moved setting must not survive in the block it left',
    );
    assert.equal(loaded.problems.length, 2);
    for (const problem of loaded.problems) assert.match(problem, /is now execution\./);
  });

  /*
   * Picking a winner would discard one of the two values the operator wrote, and the direction that gets
   * discarded is the one that denies something. A user following stale documentation, adding
   * `policy.allowProcessSpawn: false` beneath the block this build wrote, would believe they had denied
   * process execution and would be wrong.
   */
  it('refuses a file that names a moved setting in both places', () => {
    assert.throws(
      () =>
        withConfig({
          schemaVersion: SCHEMA_VERSIONS.config,
          policy: { allowProcessSpawn: false },
          execution: { allowProcessSpawn: true },
        }),
      /both policy.allowProcessSpawn and execution.allowProcessSpawn/,
    );
  });

  it('says nothing about retired settings when the file carries none', () => {
    const loaded = withConfig({ schemaVersion: SCHEMA_VERSIONS.config, report: { port: 4321 } });
    assert.deepEqual(loaded.problems, []);
    assert.equal(loaded.config.report.port, 4321);
  });

  it('still refuses a setting that was never real', () => {
    assert.throws(
      () => withConfig({ schemaVersion: SCHEMA_VERSIONS.config, semanticAnalyis: {} }),
      /is not a setting Orchescope understands/,
    );
  });

  it('falls back to the defaults when there is no file', () => {
    const root = mkdtempSync(join(tmpdir(), 'orchescope-config-'));
    roots.push(root);
    const loaded = loadConfig(resolvePaths(root));
    assert.equal(loaded.source, 'defaults');
    assert.deepEqual(loaded.config, DEFAULT_CONFIG);
  });
});
