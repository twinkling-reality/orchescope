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
