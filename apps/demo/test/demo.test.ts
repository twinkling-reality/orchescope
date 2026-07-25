import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * The demonstration target is verified end to end, as a process: the run writes a TargetResult file and
 * exports spans to a local receiver, and both are asserted. Anything less would not exercise the protocols
 * this application exists to honour.
 */

const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url));
const workspace = mkdtempSync(join(tmpdir(), 'orchescope-demo-test-'));
after(() => rmSync(workspace, { recursive: true, force: true }));

type Effect = {
  readonly kind: string;
  readonly target: string;
  readonly idempotencyKey?: string;
  readonly outcome: string;
};

type TargetResult = {
  readonly success: boolean;
  readonly output: string;
  readonly effects: readonly Effect[];
  readonly userInterventions: number;
  readonly policyViolations: number;
  readonly loopIterations: number;
};

type AnyValue = Record<string, string | number | boolean>;
type Span = {
  readonly name: string;
  readonly attributes: readonly { readonly key: string; readonly value: AnyValue }[];
};

const plan = (fault: Record<string, unknown>): string =>
  JSON.stringify({ id: 'fp_00000000000000ab', seed: 11, faults: [fault] });

const attributeOf = (span: Span, key: string): string | number | boolean | undefined => {
  const found = span.attributes.find((entry) => entry.key === key);
  return found === undefined ? undefined : Object.values(found.value)[0];
};

const baseEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key, value]) => value !== undefined && !key.startsWith('ORCHESCOPE_'),
  ),
) as Record<string, string>;

let runCount = 0;

const runDemo = async (
  env: Record<string, string>,
): Promise<{ result: TargetResult; spans: readonly Span[] }> => {
  runCount += 1;
  const resultFile = join(workspace, `result-${runCount}.json`);
  const spans: Span[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        resourceSpans?: { scopeSpans?: { spans?: Span[] }[] }[];
      };
      for (const resource of payload.resourceSpans ?? []) {
        for (const scope of resource.scopeSpans ?? []) spans.push(...(scope.spans ?? []));
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"partialSuccess":{}}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [MAIN], {
      stdio: 'ignore',
      env: {
        ...baseEnv,
        ORCHESCOPE_RESULT_FILE: resultFile,
        ORCHESCOPE_OTLP_ENDPOINT: `http://127.0.0.1:${port}`,
        ...env,
      },
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`the demo exited with code ${String(code)}`)),
    );
  });
  await new Promise<void>((resolve) => server.close(() => resolve()));

  return {
    result: JSON.parse(readFileSync(resultFile, 'utf8')) as TargetResult,
    spans,
  };
};

test('a run with the default environment succeeds', async () => {
  const { result, spans } = await runDemo({});
  assert.equal(result.success, true);
  assert.ok(result.output.length > 0);
  assert.equal(result.policyViolations, 0);
  assert.ok(result.loopIterations >= 1);

  const kinds = result.effects.map((effect) => effect.kind);
  assert.deepEqual(kinds, ['refund', 'notification', 'audit_log']);

  const root = spans.find((span) => span.name === 'invoke_agent orchestrator');
  assert.ok(root !== undefined);
  assert.equal(attributeOf(root, 'orchescope.task.success'), true);
  assert.equal(attributeOf(root, 'vcs.repository.name'), 'orchescope');

  // Every span Orchescope joins to source carries its own location.
  for (const span of spans) {
    assert.ok(typeof attributeOf(span, 'code.file.path') === 'string', span.name);
    assert.ok(typeof attributeOf(span, 'code.line.number') === 'string', span.name);
  }
});

test('two runs with the same seed produce identical effects and spans', async () => {
  const first = await runDemo({ ORCHESCOPE_SEED: '5' });
  const second = await runDemo({ ORCHESCOPE_SEED: '5' });
  assert.deepEqual(first.result.effects, second.result.effects);
  assert.deepEqual(
    first.spans.map((span) => span.name),
    second.spans.map((span) => span.name),
  );
  assert.deepEqual(first.result.output, second.result.output);
});

test('a tool_timeout on check_inventory fails the task and records the fault', async () => {
  const { result, spans } = await runDemo({
    ORCHESCOPE_FAULT_PLAN: plan({
      kind: 'tool_timeout',
      target: 'check_inventory',
      delivery: 'cooperative',
      probability: 1,
    }),
  });
  assert.equal(result.success, false);
  const faulted = spans.find(
    (span) => attributeOf(span, 'orchescope.fault.injected') === 'tool_timeout',
  );
  assert.ok(faulted !== undefined);
  assert.equal(attributeOf(faulted, 'gen_ai.tool.name'), 'check_inventory');

  const root = spans.find((span) => span.name === 'invoke_agent orchestrator');
  assert.equal(attributeOf(root as Span, 'orchescope.task.success'), false);
});

test('a tool_exception on issue_refund duplicates the refund with no idempotency key', async () => {
  const { result } = await runDemo({
    ORCHESCOPE_FAULT_PLAN: plan({
      kind: 'tool_exception',
      target: 'issue_refund',
      delivery: 'cooperative',
      probability: 1,
      attempts: [1],
    }),
  });
  const refunds = result.effects.filter((effect) => effect.kind === 'refund');
  assert.equal(refunds.length, 2);
  assert.equal(refunds[0]?.target, refunds[1]?.target);
  for (const refund of refunds) {
    assert.equal(refund.idempotencyKey, undefined);
  }
});

test('the notification effect always carries an idempotency key', async () => {
  const plain = await runDemo({});
  const retried = await runDemo({
    ORCHESCOPE_FAULT_PLAN: plan({
      kind: 'tool_timeout',
      target: 'send_notification',
      delivery: 'cooperative',
      probability: 1,
      attempts: [1],
    }),
  });
  const notifications = [...plain.result.effects, ...retried.result.effects].filter(
    (effect) => effect.kind === 'notification',
  );
  assert.ok(notifications.length >= 3);
  for (const notification of notifications) {
    assert.ok(
      typeof notification.idempotencyKey === 'string' && notification.idempotencyKey.length > 0,
    );
  }
});
