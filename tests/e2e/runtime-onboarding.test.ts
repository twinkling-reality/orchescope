import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

/**
 * Getting the first run in is where a reader gets stuck, so an empty run has to be a report rather than a dead
 * end: it names what Orchescope listened on, which variables the target was expected to honour, and the way
 * forward that needs no instrumentation. The target here is a process that exports nothing on purpose.
 *
 * The second half of this file is the audit that follows such a run. `trace` reported the empty run correctly
 * from the first release and `audit` then read it as a measurement: a run holding no span produced an exercise
 * rate of zero percent labelled `observed` at 0.98 confidence, a declared-not-exercised finding naming tools
 * that had run, seven checks that counted as having run on evidence that did not exist, and a loop that
 * declared step four done. Absence of measurement is not measurement of absence, and these cases are what
 * hold the two apart.
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

/**
 * The same silent target, with components declared so the reconciliation rules have something to be wrong
 * about. Without a declared component there is nothing to call unexercised and the bug cannot be reproduced.
 */
const declaredSilentProject = (): string => {
  const root = silentProject();
  mkdirSync(join(root, '.orchescope'), { recursive: true });
  writeFileSync(
    join(root, '.orchescope/manifest.yaml'),
    [
      'schemaVersion: 1',
      'components:',
      '  - kind: agent',
      '    name: orchestrator',
      '    definedIn: main.js',
      '  - kind: tool',
      '    name: issue_refund',
      '    definedIn: main.js',
      '    sideEffect: financial',
      'edges:',
      '  - kind: calls_tool',
      '    from: orchestrator',
      '    to: issue_refund',
      '',
    ].join('\n'),
  );
  return root;
};

type Finding = {
  readonly ruleId: string;
  readonly basis: string;
  readonly title: string;
  readonly severity: string;
};

type AuditDocument = {
  readonly data: {
    readonly reconciliation?: { readonly coverage: { readonly componentExerciseRate?: number } };
    readonly findings: readonly Finding[];
    readonly rulesEvaluated: readonly { readonly ruleId: string; readonly status: string }[];
    readonly loop: {
      readonly standingAt: string | null;
      readonly checkCoverage: {
        readonly ran: number;
        readonly blocked: number;
        readonly total: number;
      };
      readonly next: { readonly kind: string; readonly argv?: readonly string[] } | null;
    };
  };
};

const auditJson = async (root: string): Promise<AuditDocument['data']> => {
  const result = await run(['--cwd', root, 'audit', '--json']);
  assert.equal(result.code, 0, result.stderr);
  return (JSON.parse(result.stdout) as AuditDocument).data;
};

describe('a traced run that collects nothing', () => {
  it('says what it listened on, what it set, and how to proceed without instrumenting', async () => {
    const root = silentProject();
    const result = await run(['--cwd', root, 'trace', '--', 'node', 'main.js']);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /No spans arrived/);
    assert.match(result.stderr, /listened on http:\/\/127\.0\.0\.1:\d+/);
    assert.match(result.stderr, /OTEL_EXPORTER_OTLP_ENDPOINT/);
    assert.match(result.stderr, /OTEL_EXPORTER_OTLP_TRACES_ENDPOINT/);
    assert.match(result.stderr, /gRPC/);
    assert.match(result.stderr, /manifest\.yaml/);
    assert.match(result.stderr, /trace --import/);
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
    assert.match(result.stderr, /next: instrument the target/);
  });
});

describe('the audit that follows a run which collected nothing', () => {
  it('refuses to derive an absence from it, and says a run was recorded and produced no spans', async () => {
    const root = declaredSilentProject();
    const before = await auditJson(root);
    const traced = await run(['--cwd', root, 'trace', '--', 'node', 'main.js']);
    assert.equal(traced.code, 0, traced.stderr);
    const after = await auditJson(root);

    const statusOf = (data: AuditDocument['data'], ruleId: string) =>
      data.rulesEvaluated.find((rule) => rule.ruleId === ruleId)?.status;

    // Nothing was exercised and nothing was found unexercised: neither claim has evidence behind it.
    assert.equal(statusOf(after, 'declared-not-exercised'), 'insufficient_evidence');
    assert.equal(
      after.findings.some((finding) => finding.ruleId === 'declared-not-exercised'),
      false,
    );

    const coverage = after.findings.find((finding) => finding.ruleId === 'observability-coverage');
    assert.ok(coverage !== undefined, 'observability-coverage must still speak');
    assert.match(coverage.title, /recorded and produced no spans/);
    assert.equal(coverage.basis, 'discovered');
    assert.equal(
      /percent of declared components were exercised/.test(coverage.title),
      false,
      'an exercise rate is a measurement and none was taken',
    );

    // No delta at all, so no rate can be read from one either.
    assert.equal(after.reconciliation, undefined);

    // The run bought no coverage, so the count of checks that ran must not move.
    assert.deepEqual(after.loop.checkCoverage, before.loop.checkCoverage);

    // And the loop still points at the thing that would actually help.
    assert.equal(after.loop.standingAt, 'measure');
    assert.deepEqual(after.loop.next, {
      kind: 'command',
      argv: ['orchescope', 'trace', '--', '<the command that starts your system>'],
    });
  });

  it('keeps every finding it does report free of an observed basis', async () => {
    const root = declaredSilentProject();
    await run(['--cwd', root, 'trace', '--', 'node', 'main.js']);
    const after = await auditJson(root);
    assert.deepEqual(
      after.findings.filter((finding) => finding.basis === 'observed').map((f) => f.ruleId),
      [],
    );
  });
});

/**
 * A target with no OpenTelemetry anywhere in it, which is almost every target.
 *
 * The three variables a traced run sets are inert unless something in the process already loads an
 * OpenTelemetry SDK, and essentially no Node project does: two independent sessions across thirty seven
 * runs of real systems collected zero spans between them, and an audit was inventory for all of them.
 * These cases are the difference between what the product claims and what it delivers, so they run the
 * whole chain: a process is loaded with the shim, makes an ordinary HTTP call, and the audit that follows
 * names what it reached.
 */
describe('a traced run of a target that has no instrumentation of its own', () => {
  /** A target that talks to a service over plain HTTP. It imports nothing and knows nothing about tracing. */
  const httpProject = (): string => {
    const root = silentProject();
    writeFileSync(
      join(root, 'main.js'),
      `import { createServer } from 'node:http';

const server = createServer((request, response) => {
  const body = JSON.stringify({ ok: true });
  response.writeHead(200, {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(body)),
  });
  response.end(body);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;

await fetch(origin + '/v1/lookup');
await fetch(origin + '/v1/charge', {
  method: 'POST',
  headers: { 'idempotency-key': 'order-42' },
  body: '{}',
});
server.close();
`,
    );
    return root;
  };

  it('collects spans from it, and says it loaded the instrumentation that did so', async () => {
    const root = httpProject();
    const result = await run(['--cwd', root, 'trace', '--json', '--', 'node', 'main.js']);
    const document = JSON.parse(result.stdout.trim()) as {
      data: {
        spanCount: number;
        instrumentation: { injected: boolean };
      };
    };
    assert.equal(document.data.instrumentation.injected, true);
    assert.equal(
      document.data.spanCount,
      2,
      'both outbound requests should have been recorded as spans',
    );
  });

  it('turns the run into a reconciliation that names what the system reached', async () => {
    const root = httpProject();
    await run(['--cwd', root, 'trace', '--', 'node', 'main.js']);
    const after = await auditJson(root);
    const undeclared = after.findings.find(
      (finding) => finding.ruleId === 'exercised-not-declared',
    );
    assert.ok(undeclared !== undefined, 'a component that ran and was never declared is the point');
    assert.equal(undeclared.basis, 'observed');
    assert.match(undeclared.title, /127\.0\.0\.1/);
  });

  it('leaves the target alone when the operator turns it off', async () => {
    const root = httpProject();
    mkdirSync(join(root, '.orchescope'), { recursive: true });
    writeFileSync(
      join(root, '.orchescope/config.json'),
      `${JSON.stringify({ schemaVersion: 2, runtime: { autoInstrument: false } }, null, 2)}\n`,
    );
    const result = await run(['--cwd', root, 'trace', '--json', '--', 'node', 'main.js']);
    const document = JSON.parse(result.stdout.trim()) as {
      data: { spanCount: number; instrumentation: { injected: boolean; reason?: string } };
    };
    assert.equal(document.data.instrumentation.injected, false);
    assert.equal(document.data.instrumentation.reason, 'disabled');
    assert.equal(document.data.spanCount, 0);
  });

  /*
   * The boundary from the field report. A test suite spawned `wrangler dev`, so the server under test ran
   * in workerd and the variable meant nothing to it. Perfect Node instrumentation would have captured the
   * client and missed the server, and a reader who is not told that concludes their system is silent.
   */
  it('says plainly when the target is a runtime it cannot reach', async () => {
    const root = silentProject();
    const result = await run(['--cwd', root, 'trace', '--', 'python3', '-c', 'pass']);
    assert.match(result.stderr, /not a Node process/);
    assert.match(result.stderr, /Point its own exporter at http:\/\/127\.0\.0\.1:\d+/);
  });
});

/**
 * A tool call to a Model Context Protocol server the target started itself.
 *
 * This is the one thing the shim cannot reach through a global: the client spawns the server and speaks to
 * it over standard input, so nothing about the call passes `fetch`. The package is written into the fixture
 * rather than installed, which keeps the test offline and pins the two things that actually went wrong when
 * this was first tried against a real SDK: the exports map reaches its builds through a wildcard, and a
 * package that ships both a CommonJS and an ES module build is two objects at runtime. Patching the one
 * `require` happens to find reported success and produced no spans at all.
 */
describe('a traced run that calls a tool over standard input', () => {
  const clientSource = `export class Client {
  async callTool(params) {
    return { content: [{ type: 'text', text: 'refunded ' + params.arguments.chargeId }] };
  }
}
`;

  const clientSourceCommonJs = `class Client {
  async callTool(params) {
    return { content: [{ type: 'text', text: 'refunded ' + params.arguments.chargeId }] };
  }
}
module.exports = { Client };
`;

  const withFakeSdk = (): string => {
    const root = silentProject();
    const pkg = join(root, 'node_modules/@modelcontextprotocol/sdk');
    mkdirSync(join(pkg, 'dist/esm/client'), { recursive: true });
    mkdirSync(join(pkg, 'dist/cjs/client'), { recursive: true });
    writeFileSync(
      join(pkg, 'package.json'),
      `${JSON.stringify(
        {
          name: '@modelcontextprotocol/sdk',
          version: '1.0.0',
          type: 'module',
          exports: {
            './*': { import: './dist/esm/*', require: './dist/cjs/*' },
          },
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(join(pkg, 'dist/esm/client/index.js'), clientSource);
    writeFileSync(join(pkg, 'dist/cjs/client/index.js'), clientSourceCommonJs);
    writeFileSync(join(pkg, 'dist/cjs/package.json'), `${JSON.stringify({ type: 'commonjs' })}\n`);
    writeFileSync(
      join(root, 'main.js'),
      `import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const client = new Client();
const result = await client.callTool({ name: 'issue_refund', arguments: { chargeId: 'ch_1' } });
console.log(result.content[0].text);
`,
    );
    return root;
  };

  it('records the tool by name, which is what the reconciliation joins on', async () => {
    const root = withFakeSdk();
    const result = await run(['--cwd', root, 'trace', '--json', '--', 'node', 'main.js']);
    const document = JSON.parse(result.stdout.trim()) as {
      data: {
        spanCount: number;
        instrumentation: { patches?: readonly { target: string; patched: boolean }[] };
      };
    };
    assert.deepEqual(document.data.instrumentation.patches, [
      { patched: true, target: '@modelcontextprotocol/sdk/client/index.js' },
    ]);
    assert.equal(document.data.spanCount, 1, 'the tool call is the span');
  });

  /*
   * A patch that declined has to reach somebody. Without this a target whose client is a shape this build
   * does not know produces a trace with no tool calls in it, which is indistinguishable from a target that
   * made none.
   */
  it('says so when the package is there and its shape is not the one this build knows', async () => {
    const root = withFakeSdk();
    const pkg = join(root, 'node_modules/@modelcontextprotocol/sdk');
    writeFileSync(join(pkg, 'dist/esm/client/index.js'), 'export const Client = {};\n');
    writeFileSync(join(pkg, 'dist/cjs/client/index.js'), 'module.exports = { Client: {} };\n');
    writeFileSync(join(root, 'main.js'), "console.log('no tool call here');\n");
    const result = await run(['--cwd', root, 'trace', '--json', '--', 'node', 'main.js']);
    const document = JSON.parse(result.stdout.trim()) as {
      data: { instrumentation: { patches?: readonly { patched: boolean; reason?: string }[] } };
    };
    assert.equal(document.data.instrumentation.patches?.[0]?.patched, false);
    assert.match(
      document.data.instrumentation.patches?.[0]?.reason ?? '',
      /not the shape this build knows/,
    );
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
    assert.match(result.stderr, /1 span\(s\) from 1 service\(s\)/);
    assert.equal(result.stderr.includes('No spans arrived'), false);
    assert.match(result.stderr, /next: orchescope audit/);
  });
});

/**
 * The contract a pipeline reads: a status that says what the target did, and a standard output stream
 * carrying what the target wrote and nothing else.
 *
 * All three of these blocked continuous integration adoption together. A failing command reported 4
 * whatever it exited with, so a step could tell that the target had failed and not how. The run report
 * shared standard output with the traced program, so anything the caller piped arrived with a run summary
 * in the middle of it. And under `--json` the target's output was dropped rather than moved, so an agent
 * that traced a build to read its output got a document about the run and none of what the run said.
 */
describe('the contract a traced command exposes to its caller', () => {
  /** A target that writes to both streams and exits with whatever it is told to. */
  const noisyProject = (): string => {
    const root = mkdtempSync(join(tmpdir(), 'orchescope-streams-'));
    roots.push(root);
    writeFileSync(
      join(root, 'package.json'),
      `${JSON.stringify({ name: 'noisy', private: true, type: 'module' })}\n`,
    );
    writeFileSync(
      join(root, 'main.js'),
      'process.stdout.write("OUT-1\\n");\nprocess.stderr.write("ERR-1\\n");\nprocess.exit(Number(process.env.RC || 0));\n',
    );
    return root;
  };

  const traced = async (root: string, rc: string, extra: readonly string[] = []) => {
    try {
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        [cliEntry, '--cwd', root, 'trace', ...extra, '--', process.execPath, join(root, 'main.js')],
        {
          cwd: repositoryRoot,
          maxBuffer: 32 * 1024 * 1024,
          timeout: 180_000,
          env: { ...process.env, NO_COLOR: '1', RC: rc },
        },
      );
      return { stdout, stderr, code: 0 };
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; code?: number };
      return {
        stdout: failure.stdout ?? '',
        stderr: failure.stderr ?? '',
        code: failure.code ?? 1,
      };
    }
  };

  it('exits with the status the target exited with', async () => {
    const root = noisyProject();
    assert.equal((await traced(root, '3')).code, 3, 'a wrapper reports what it wrapped');
    assert.equal((await traced(root, '0')).code, 0);
  });

  it('leaves standard output to the target alone', async () => {
    const result = await traced(noisyProject(), '0');
    assert.equal(result.stdout, 'OUT-1\n', 'the run report belongs on the diagnostic stream');
    assert.match(result.stderr, /ERR-1/);
    assert.match(result.stderr, /span\(s\) from/, 'the report should still be printed somewhere');
  });

  it('moves the target output aside under --json rather than dropping it', async () => {
    const result = await traced(noisyProject(), '5', ['--json']);
    assert.equal(result.code, 5);
    const document = JSON.parse(result.stdout.trim()) as {
      ok: boolean;
      data: { exitCode: number };
    };
    assert.equal(document.ok, true, 'standard output has to stay one parseable document');
    assert.equal(document.data.exitCode, 5);
    assert.match(result.stderr, /OUT-1/, 'the target output was discarded rather than relocated');
    assert.match(result.stderr, /ERR-1/);
  });
});
