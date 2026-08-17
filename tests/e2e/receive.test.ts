import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Collecting from a system Orchescope did not start.
 *
 * `trace` wraps a command, which cannot help with the systems most worth reconciling: a development server, a worker,
 * anything already running. This is the other half, and the contract it has to keep is narrow: say where to export
 * before anything can arrive, accept what arrives, and store it as a run that an audit reconciles like any other.
 */

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliEntry = join(repositoryRoot, 'apps/cli/src/main.ts');

const roots: string[] = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const project = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'orchescope-receive-'));
  roots.push(root);
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify({ name: 'already-running', private: true, type: 'module' })}\n`,
  );
  return root;
};

const span = (model: string) => ({
  resourceSpans: [
    {
      resource: {
        attributes: [{ key: 'service.name', value: { stringValue: 'already-running' } }],
      },
      scopeSpans: [
        {
          scope: { name: 'by-hand' },
          spans: [
            {
              traceId: '00000000000000000000000000000001',
              spanId: '0000000000000001',
              name: `chat ${model}`,
              kind: 3,
              startTimeUnixNano: '1000000000000000000',
              endTimeUnixNano: '1000000005000000000',
              attributes: [
                { key: 'gen_ai.operation.name', value: { stringValue: 'chat' } },
                { key: 'gen_ai.request.model', value: { stringValue: model } },
                { key: 'gen_ai.usage.input_tokens', value: { intValue: '99' } },
              ],
              status: {},
            },
          ],
        },
      ],
    },
  ],
});

type Received = {
  readonly stdout: string;
  /** The run report, which is a diagnostic and shares the stream the privileges notice uses. */
  readonly stderr: string;
  readonly code: number | null;
  readonly endpoint: string;
};

/**
 * Starts the command, waits for the endpoint it prints, posts spans to it, and lets the window close by itself.
 * The wait is on the output rather than on a timer: the endpoint is the signal that the receiver is ready.
 */
const receiveAndPost = async (root: string, args: readonly string[]): Promise<Received> => {
  const child = spawn(process.execPath, [cliEntry, '--cwd', root, 'receive', ...args], {
    cwd: repositoryRoot,
    env: { ...process.env, NO_COLOR: '1' },
  });
  let stdout = '';
  let stderr = '';
  let endpoint = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const listening = new Promise<string>((resolve, reject) => {
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      const match = /http:\/\/127\.0\.0\.1:\d+/.exec(stdout);
      if (match !== null && endpoint === '') {
        endpoint = match[0];
        resolve(endpoint);
      }
    });
    child.on('error', reject);
    child.on('exit', () => {
      if (endpoint === '') reject(new Error(`the receiver exited before listening: ${stdout}`));
    });
  });

  const url = await listening;
  const response = await fetch(`${url}/v1/traces`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(span('gpt-4o-mini')),
  });
  assert.equal(response.ok, true, `the receiver refused the export: ${response.status}`);

  const code = await new Promise<number | null>((resolve) => {
    child.on('exit', (value) => resolve(value));
  });
  return { stdout, stderr, code, endpoint: url };
};

describe('receiving spans from a system that is already running', () => {
  it('says where to export to, stores what arrives, and ends its own window', async () => {
    const root = project();
    const result = await receiveAndPost(root, ['--for', '3s']);
    assert.equal(result.code, 0, result.stdout);
    assert.match(result.stdout, /Listening on http:\/\/127\.0\.0\.1:\d+ for 3s/);
    assert.match(result.stdout, /OTEL_EXPORTER_OTLP_ENDPOINT=http:\/\/127\.0\.0\.1:\d+/);
    assert.match(result.stderr, /1 span\(s\) from 1 service\(s\)/);
    assert.equal(result.stderr.includes('No spans arrived'), false);
  });

  it('names its causes when the window closes with nothing in it', async () => {
    const root = project();
    const child = spawn(process.execPath, [cliEntry, '--cwd', root, 'receive', '--for', '1s'], {
      cwd: repositoryRoot,
      env: { ...process.env, NO_COLOR: '1' },
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
    assert.equal(code, 0, stderr);
    assert.match(stderr, /0 span\(s\)/);
    assert.match(stderr, /No spans arrived/);
  });

  it('refuses a window that is not a duration, and says what one looks like', async () => {
    const root = project();
    const child = spawn(process.execPath, [cliEntry, '--cwd', root, 'receive', '--for', 'soon'], {
      cwd: repositoryRoot,
      env: { ...process.env, NO_COLOR: '1' },
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
    assert.equal(code, 2, output);
    assert.match(output, /soon is not a duration/);
    assert.match(output, /90s, 10m or 1h/);
  });
});
