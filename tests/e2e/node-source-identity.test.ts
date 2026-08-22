import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const helperUrl = new URL('../../corpus/instrumentation/node_source_identity.mjs', import.meta.url)
  .href;

const run = (command: string, arguments_: readonly string[], cwd: string): string =>
  execFileSync(command, arguments_, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

test('captures a tracked caller from a clean checkout and refuses it when dirty', () => {
  const checkout = mkdtempSync(join(tmpdir(), 'orchescope-node-source-'));
  const target = join(checkout, 'target.mjs');
  writeFileSync(
    target,
    `import { captureNodeSourceIdentity } from ${JSON.stringify(helperUrl)};\n` +
      `process.stdout.write(JSON.stringify(captureNodeSourceIdentity() ?? null));\n`,
    { mode: 0o644 },
  );
  run('git', ['init', '--quiet'], checkout);
  run('git', ['config', 'user.email', 'corpus@example.invalid'], checkout);
  run('git', ['config', 'user.name', 'Corpus Test'], checkout);
  run(
    'git',
    ['remote', 'add', 'origin', 'https://github.com/Example/Runtime-Target.git'],
    checkout,
  );
  run('git', ['add', 'target.mjs'], checkout);
  run('git', ['commit', '--quiet', '-m', 'Pin runtime target'], checkout);

  const revision = run('git', ['rev-parse', 'HEAD'], checkout);
  const observed = JSON.parse(run(process.execPath, [target], checkout)) as Record<string, unknown>;
  assert.deepEqual(observed, {
    absoluteFile: realpathSync(target),
    repositoryFile: 'target.mjs',
    repositoryUrl: 'https://github.com/Example/Runtime-Target',
    revision,
    line: 2,
  });

  appendFileSync(target, '\n');
  assert.equal(run(process.execPath, [target], checkout), 'null');
});
