import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

/**
 * What a run measured, all the way from a span to the map a reader looks at.
 *
 * Deriving a topology, attributing it to components, storing it, and reading it back into overlays is a chain with
 * no exception anywhere in it: when a link is missing every overlay is simply absent, the rules report insufficient
 * evidence, and the report is indistinguishable from one produced for a system that did nothing. That is what this
 * test exists to catch, so it asserts on the numbers rather than on the exit code.
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

/**
 * A project that declares one model and one tool, and exports spans naming both.
 *
 * The names match the declarations on purpose: reconciliation is what turns an observed name into a component
 * identity, and metrics that never reach an identity are the failure being guarded against.
 */
const tracedProject = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'orchescope-metrics-'));
  roots.push(root);
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify(
      { name: 'traced', private: true, type: 'module', dependencies: { openai: '4.0.0' } },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(root, 'agent.js'),
    `import OpenAI from 'openai';

const client = new OpenAI();

export const answer = async (question) =>
  client.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: question }] });
`,
  );
  const span = (name: string, attributes: string, startOffset: number, tokens: boolean) => `
            {
              traceId: '00000000000000000000000000000001',
              spanId: '000000000000000${startOffset}',
              name: '${name}',
              kind: 3,
              startTimeUnixNano: String(now + ${startOffset}000000n),
              endTimeUnixNano: String(now + ${startOffset + 5}000000n),
              attributes: [${attributes}${
                tokens
                  ? `,
                { key: 'gen_ai.usage.input_tokens', value: { intValue: '1200' } },
                { key: 'gen_ai.usage.output_tokens', value: { intValue: '300' } }`
                  : ''
              }],
              status: {},
            }`;
  writeFileSync(
    join(root, 'main.js'),
    `const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
const now = 1_000_000_000_000_000_000n;
const body = {
  resourceSpans: [
    {
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'traced' } }] },
      scopeSpans: [
        {
          scope: { name: 'by-hand' },
          spans: [${span(
            'chat gpt-4o-mini',
            `
                { key: 'gen_ai.operation.name', value: { stringValue: 'chat' } },
                { key: 'gen_ai.provider.name', value: { stringValue: 'openai' } },
                { key: 'gen_ai.request.model', value: { stringValue: 'gpt-4o-mini' } }`,
            1,
            true,
          )},${span(
            'execute_tool lookup',
            `
                { key: 'gen_ai.operation.name', value: { stringValue: 'execute_tool' } },
                { key: 'gen_ai.tool.name', value: { stringValue: 'lookup' } }`,
            2,
            false,
          )}],
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
  return root;
};

type Bundle = {
  readonly componentMetrics: readonly {
    readonly componentId: string;
    readonly executionCount: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly costUsd?: number;
  }[];
  readonly overlays: readonly {
    readonly kind: string;
    readonly values: readonly { readonly componentId: string; readonly value: number }[];
  }[];
  readonly capabilities: readonly {
    readonly name: string;
    readonly available: boolean;
    readonly reason: string;
  }[];
};

const exportBundle = async (root: string): Promise<Bundle> => {
  const file = join(root, 'report.json');
  const exported = await run(['--cwd', root, 'export', '--format', 'json', '--out', file]);
  assert.equal(exported.code, 0, exported.stderr);
  // The written file is the report bundle itself. The command's own JSON document goes to standard output.
  return JSON.parse(readFileSync(file, 'utf8')) as Bundle;
};

let root = '';

describe('the numbers a run produced reach the report', () => {
  before(async () => {
    root = tracedProject();
    const traced = await run(['--cwd', root, 'trace', '--', 'node', 'main.js']);
    assert.equal(traced.code, 0, traced.stderr);
    assert.match(traced.stderr, /2 span\(s\)/);
    const audited = await run(['--cwd', root, 'audit']);
    assert.equal(audited.code, 0, audited.stderr);
  });

  it('attributes what each component did to that component', async () => {
    const bundle = await exportBundle(root);
    assert.ok(
      bundle.componentMetrics.length > 0,
      'a run with spans in it produced no per component metric, so nothing measured reaches the map',
    );
    const model = bundle.componentMetrics.find((metric) => metric.componentId.startsWith('model:'));
    assert.ok(model !== undefined, `no model metric among ${bundle.componentMetrics.length}`);
    assert.equal(model.executionCount, 1);
    assert.equal(model.inputTokens, 1200);
    assert.equal(model.outputTokens, 300);
  });

  it('carries every overlay a measured run supports', async () => {
    const bundle = await exportBundle(root);
    const kinds = new Set(bundle.overlays.map((overlay) => overlay.kind));
    for (const kind of ['runtime_frequency', 'latency', 'tokens', 'errors', 'retries']) {
      assert.ok(kinds.has(kind), `the ${kind} overlay is missing from a report with measured runs`);
    }
  });

  it('says why cost is absent, and reports it once a price is configured', async () => {
    const before = await exportBundle(root);
    assert.equal(
      before.overlays.some((overlay) => overlay.kind === 'cost'),
      false,
      'cost was reported with no price configured',
    );
    const capability = before.capabilities.find((entry) => entry.name === 'cost_estimate');
    assert.ok(capability !== undefined, 'the report does not answer whether it can estimate cost');
    assert.equal(capability.available, false);
    assert.match(capability.reason, /no price is configured/);

    // A price is configured the way a reader would configure one: in the file `init` writes with every default in it.
    const initialised = await run(['--cwd', root, 'init']);
    assert.equal(initialised.code, 0, initialised.stderr);
    const configPath = join(root, '.orchescope/config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    assert.deepEqual(
      config['pricing'],
      {},
      'init should write the pricing block so it is discoverable',
    );
    config['pricing'] = { 'openai/gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 } };
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

    const audited = await run(['--cwd', root, 'audit']);
    assert.equal(audited.code, 0, audited.stderr);
    const after = await exportBundle(root);
    const cost = after.overlays.find((overlay) => overlay.kind === 'cost');
    assert.ok(cost !== undefined, 'a configured price produced no cost overlay');
    // 1200 input tokens at 0.15 and 300 output tokens at 0.60 per million.
    assert.equal(cost.values.length, 1);
    assert.equal(cost.values[0]?.value.toFixed(6), (0.00018 + 0.00018).toFixed(6));
    assert.equal(
      after.capabilities.find((entry) => entry.name === 'cost_estimate')?.available,
      true,
    );
  });
});
