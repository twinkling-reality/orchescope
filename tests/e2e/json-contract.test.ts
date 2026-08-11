import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

/**
 * One document, one shape, whatever happened.
 *
 * A coding agent reads `ok`, `command`, `version` and `data` the same way on every command, and reads `error` when
 * `ok` is false. A command that answers with a different shape, or with two documents, or with none, forces a
 * caller to special case it, which is how an agent ends up parsing prose. Both outcomes are checked here for every
 * command that takes `--json`.
 */

const execFileAsync = promisify(execFile);
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliEntry = join(repositoryRoot, 'apps/cli/src/main.ts');

type Result = { readonly stdout: string; readonly stderr: string; readonly code: number };

const run = async (args: readonly string[]): Promise<Result> => {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cliEntry, ...args], {
      cwd: repositoryRoot,
      maxBuffer: 64 * 1024 * 1024,
      timeout: 240_000,
      env: { ...process.env, NO_COLOR: '1' },
    });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: failure.stdout ?? '', stderr: failure.stderr ?? '', code: failure.code ?? 1 };
  }
};

const roots: string[] = [];
let demo: string;

before(async () => {
  demo = mkdtempSync(join(tmpdir(), 'orchescope-json-'));
  roots.push(demo);
  cpSync(join(repositoryRoot, 'apps/demo'), demo, {
    recursive: true,
    filter: (source) => !source.includes('/node_modules') && !source.includes('/state'),
  });
  // A stored report is what `export`, `open` and `goals` read, so one audit runs first.
  await run(['--cwd', demo, 'audit', '--json']);
});

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

type Envelope = {
  readonly ok: boolean;
  readonly command: string;
  readonly version: string;
  readonly data: unknown;
  readonly error?: { readonly code: string; readonly category: string; readonly message: string };
};

/** Parses standard output as exactly one JSON document and holds the shape every command shares. */
const envelopeOf = (label: string, result: Result): Envelope => {
  const text = result.stdout.trim();
  assert.ok(text.length > 0, `${label} wrote no document at all`);
  assert.ok(
    text.startsWith('{') && text.endsWith('}'),
    `${label} did not write one JSON object: ${text.slice(0, 120)}`,
  );
  let document: Envelope;
  try {
    document = JSON.parse(text) as Envelope;
  } catch (error) {
    throw new Error(
      `${label} wrote something that is not one JSON document (${(error as Error).message}): ${text.slice(0, 120)}`,
    );
  }
  assert.equal(typeof document.ok, 'boolean', `${label} has no boolean ok`);
  assert.equal(typeof document.command, 'string', `${label} does not name its command`);
  assert.match(document.version, /^\d+\.\d+\.\d+$/, `${label} does not carry a version`);
  assert.ok('data' in document, `${label} has no data key`);
  return document;
};

const SUCCEEDING: readonly { readonly label: string; readonly args: readonly string[] }[] = [
  { label: 'audit', args: ['audit'] },
  { label: 'doctor', args: ['doctor'] },
  { label: 'init', args: ['init'] },
  { label: 'init --manifest', args: ['init', '--manifest'] },
  { label: 'goals', args: ['goals'] },
  { label: 'export json', args: ['export', '--format', 'json'] },
  { label: 'export mermaid', args: ['export', '--format', 'mermaid'] },
  { label: 'mcp install --list', args: ['mcp', 'install', '--list'] },
];

const FAILING: readonly {
  readonly label: string;
  readonly args: readonly string[];
  readonly command: string;
  readonly code: number;
}[] = [
  {
    label: 'export of a format that does not exist',
    args: ['export', '--format', 'pdf'],
    command: 'export',
    code: 2,
  },
  {
    label: 'compare of runs that do not exist',
    args: ['compare', 'nope', 'nope'],
    command: 'compare',
    code: 2,
  },
  {
    label: 'test of a scenario that does not exist',
    args: ['test', '--scenario', 'not-a-scenario'],
    command: 'test',
    code: 2,
  },
  {
    label: 'goal create from a finding that does not exist',
    args: ['goal', 'create', 'OSC-NOPE-9999'],
    command: 'goal create',
    code: 2,
  },
  {
    label: 'goal show of a goal that does not exist',
    args: ['goal', 'show', 'OSC-GOAL-9999'],
    command: 'goal show',
    code: 2,
  },
];

describe('the json contract on success', () => {
  for (const testCase of SUCCEEDING) {
    it(`${testCase.label} writes one document that says it succeeded`, async () => {
      const result = await run(['--cwd', demo, ...testCase.args, '--json']);
      const document = envelopeOf(testCase.label, result);
      assert.equal(document.ok, true, `${testCase.label} reported failure: ${result.stderr}`);
      assert.equal(document.error, undefined, `${testCase.label} carries an error while ok`);
      assert.notEqual(document.data, null, `${testCase.label} succeeded with no data`);
    });
  }

  it('never writes colour into a document, even when colour is forced', async () => {
    const result = await run(['--cwd', demo, 'audit', '--color', '--json']);
    assert.equal(result.stdout.includes('['), false);
  });
});

describe('the json contract on failure', () => {
  for (const testCase of FAILING) {
    it(`${testCase.label} writes one document naming the command and the error`, async () => {
      const result = await run(['--cwd', demo, ...testCase.args, '--json']);
      assert.equal(result.code, testCase.code, `${testCase.label} used an unexpected exit code`);
      const document = envelopeOf(testCase.label, result);
      assert.equal(document.ok, false);
      assert.equal(document.command, testCase.command);
      assert.equal(document.data, null, 'a failure carries no data');
      assert.ok(document.error !== undefined, 'a failure carries no error');
      assert.ok(document.error.code.length > 0, 'the error has no code');
      assert.ok(document.error.message.length > 0, 'the error has no message');
    });
  }

  it('names the setting to change when policy refused the action', async () => {
    const root = mkdtempSync(join(tmpdir(), 'orchescope-json-policy-'));
    roots.push(root);
    cpSync(demo, root, { recursive: true, filter: (source) => !source.includes('/state') });
    await run(['--cwd', root, 'init']);
    const configPath = join(root, '.orchescope/config.json');
    const { readFileSync, writeFileSync } = await import('node:fs');
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      policy: Record<string, unknown>;
    };
    config.policy['allowProcessSpawn'] = false;
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

    const result = await run(['--cwd', root, 'trace', '--json', '--', 'node', '--version']);
    assert.equal(result.code, 3);
    const document = envelopeOf('a refused trace', result);
    assert.equal(document.ok, false);
    assert.equal(document.command, 'trace');
    const detail = document.error?.['detail' as keyof typeof document.error] as
      | { setting?: string }
      | undefined;
    assert.equal(
      detail?.setting,
      'policy.allowProcessSpawn',
      'a refusal did not name the setting that would grant it',
    );
  });
});

describe('exporting as a document', () => {
  it('carries the artifact when there is no file to put it in', async () => {
    const result = await run(['--cwd', demo, 'export', '--format', 'mermaid', '--json']);
    const document = envelopeOf('export without --out', result);
    const data = document.data as { format: string; out: string | null; content: string | null };
    assert.equal(data.format, 'mermaid');
    assert.equal(data.out, null);
    assert.ok((data.content ?? '').includes('graph'), 'the mermaid document is not in the payload');
  });

  it('names the file and keeps the artifact out of the document when one was given', async () => {
    const target = join(demo, '.orchescope/state/contract-json.mermaid');
    const result = await run([
      '--cwd',
      demo,
      'export',
      '--format',
      'mermaid',
      '--out',
      target,
      '--json',
    ]);
    const document = envelopeOf('export with --out', result);
    const data = document.data as { out: string | null; content: string | null; bytes: number };
    assert.equal(data.out, target);
    assert.equal(data.content, null);
    assert.ok(data.bytes > 0);
    const { readFileSync } = await import('node:fs');
    assert.equal(readFileSync(target, 'utf8').length, data.bytes);
  });
});
