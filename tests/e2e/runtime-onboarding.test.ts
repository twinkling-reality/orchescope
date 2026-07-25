import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

/**
 * Getting the first run in is where a reader gets stuck, so an empty run has to be a report rather than a dead
 * end: it names what Orchescope listened on, which variables the target was expected to honour, and the way
 * forward that needs no instrumentation. The target here is a process that exports nothing on purpose.
 */

const execFileAsync = promisify(execFile);
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliEntry = join(repositoryRoot, 'apps/cli/src/main.ts');

const roots: string[] = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

type Result = { readonly stdout: string; readonly stderr: string; readonly code: number };

const run = async (args: readonly string[]): Promise<Result> => {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cliEntry, ...args], {
      cwd: repositoryRoot,
      maxBuffer: 32 * 1024 * 1024,
      timeout: 180_000,
      env: { ...process.env, NO_COLOR: '1' },
    });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: failure.stdout ?? '', stderr: failure.stderr ?? '', code: failure.code ?? 1 };
  }
};

/** A project whose entry point runs and exports no telemetry at all. */
const silentProject = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'orchescope-onboarding-'));
  roots.push(root);
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify({ name: 'silent', private: true, type: 'module' })}\n`,
  );
  writeFileSync(join(root, 'main.js'), "console.log('worked, exported nothing');\n");
  return root;
};

describe('a traced run that collects nothing', () => {
  it('says what it listened on, what it set, and how to proceed without instrumenting', async () => {
    const root = silentProject();
    const result = await run(['--cwd', root, 'trace', '--', 'node', 'main.js']);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /No spans arrived/);
    assert.match(result.stdout, /listened on http:\/\/127\.0\.0\.1:\d+/);
    assert.match(result.stdout, /OTEL_EXPORTER_OTLP_ENDPOINT/);
    assert.match(result.stdout, /OTEL_EXPORTER_OTLP_TRACES_ENDPOINT/);
    assert.match(result.stdout, /gRPC/);
    assert.match(result.stdout, /manifest\.yaml/);
    assert.match(result.stdout, /trace --import/);
  });

  it('reports the same machine readably, including the variables it set', async () => {
    const root = silentProject();
    const result = await run(['--cwd', root, 'trace', '--json', '--', 'node', 'main.js']);
    const document = JSON.parse(result.stdout.trim()) as {
      ok: boolean;
      data: {
        spanCount: number;
        receiverUrl: string;
        otlpVariables: readonly string[];
      };
    };
    assert.equal(document.ok, true);
    assert.equal(document.data.spanCount, 0);
    assert.match(document.data.receiverUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.deepEqual(document.data.otlpVariables, [
      'OTEL_EXPORTER_OTLP_ENDPOINT',
      'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
      'OTEL_TRACES_EXPORTER',
    ]);
  });

  it('does not tell the reader to open a report that has no runtime evidence in it', async () => {
    const root = silentProject();
    const result = await run(['--cwd', root, 'trace', '--', 'node', 'main.js']);
    assert.match(result.stdout, /next: instrument the target/);
  });
});

describe('a traced run that exports spans', () => {
  it('stores them and points at the report', async () => {
    const root = silentProject();
    // The target exports one span by hand, over OTLP JSON, to the endpoint Orchescope exported. No SDK is
    // involved: the point is that honouring the variable is the whole contract.
    writeFileSync(
      join(root, 'main.js'),
      `const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
const now = 1_000_000_000_000_000_000n;
const body = {
  resourceSpans: [
    {
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'silent' } }] },
      scopeSpans: [
        {
          scope: { name: 'by-hand' },
          spans: [
            {
              traceId: '00000000000000000000000000000001',
              spanId: '0000000000000001',
              name: 'chat gpt-4.1-mini',
              kind: 3,
              startTimeUnixNano: String(now),
              endTimeUnixNano: String(now + 5_000_000n),
              attributes: [
                { key: 'gen_ai.operation.name', value: { stringValue: 'chat' } },
                { key: 'gen_ai.request.model', value: { stringValue: 'gpt-4.1-mini' } },
              ],
              status: {},
            },
          ],
        },
      ],
    },
  ],
};
const response = await fetch(endpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
if (!response.ok) throw new Error('the receiver refused the export: ' + response.status);
`,
    );
    const result = await run(['--cwd', root, 'trace', '--', 'node', 'main.js']);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /1 span\(s\) from 1 service\(s\)/);
    assert.equal(result.stdout.includes('No spans arrived'), false);
    assert.match(result.stdout, /next: orchescope audit --open/);
  });
});
