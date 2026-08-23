import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliEntry = join(repositoryRoot, 'apps/cli/src/main.ts');
const roots: string[] = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const project = (source: string): string => {
  const root = mkdtempSync(join(tmpdir(), 'orchescope-object-method-'));
  roots.push(root);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'package.json'), '{"name":"command-app","private":true}\n');
  writeFileSync(join(root, 'src/command.ts'), source);
  return root;
};

const run = async (root: string, args: readonly string[]): Promise<Record<string, unknown>> => {
  const { stdout } = await execFileAsync(process.execPath, [cliEntry, '--cwd', root, ...args], {
    cwd: repositoryRoot,
    maxBuffer: 32 * 1024 * 1024,
    timeout: 120_000,
  });
  return JSON.parse(stdout) as Record<string, unknown>;
};

const exportContent = async (root: string, format: 'json' | 'mermaid'): Promise<string> => {
  const document = await run(root, ['export', '--format', format, '--json']);
  return ((document['data'] as { content?: string } | undefined)?.content ?? '').trim();
};

describe('object-method effect ownership through the public report surfaces', () => {
  it('keeps public component identity stable across formatting and a non-callable sibling', async () => {
    const componentIds = async (source: string): Promise<readonly string[]> => {
      const root = project(source);
      await run(root, ['audit', '--json']);
      const bundle = JSON.parse(await exportContent(root, 'json')) as {
        graph: { components: readonly { id: string }[] };
      };
      return bundle.graph.components.map((component) => component.id).sort();
    };
    const compact = await componentIds(
      "export const command={run(){return fetch('https://api.example.com/items')}};\n",
    );
    const reformatted = await componentIds(`
export const command = {
  description: 'inserted sibling',

  run() {
    return fetch('https://api.example.com/items');
  },
};
`);
    assert.deepEqual(reformatted, compact);
    assert.ok(compact.includes('entrypoint:command.run'));
    assert.ok(compact.every((id) => !/(?:object|array|function|class)-\d/.test(id)));
  });

  it('keeps the caller, service, finding, citation and Mermaid label on the method', async () => {
    const root = project(`const defineCommand = <T>(value: T): T => value;

export const updatePricingCommand = defineCommand({
  async run({ url }: { url: string }): Promise<Response> {
    return await fetch(url);
  },
});
`);
    await run(root, ['audit', '--json']);
    const bundle = JSON.parse(await exportContent(root, 'json')) as {
      graph: {
        components: readonly { id: string; evidence: readonly string[] }[];
        edges: readonly {
          kind: string;
          from: string;
          to: string;
          evidence: readonly string[];
        }[];
      };
      findings: readonly { components: readonly string[] }[];
      evidence: readonly { id: string; kind: string; symbol?: string }[];
    };
    const caller = 'entrypoint:run';
    const service = 'external_service:unresolved-host-run';
    assert.ok(bundle.graph.components.some((component) => component.id === caller));
    assert.ok(bundle.graph.components.some((component) => component.id === service));
    assert.equal(
      bundle.graph.components.some((component) => component.id.includes('module-scope')),
      false,
    );
    const relation = bundle.graph.edges.find(
      (edge) => edge.kind === 'calls_service' && edge.from === caller && edge.to === service,
    );
    assert.ok(relation !== undefined);
    const evidence = bundle.evidence.filter((record) => relation.evidence.includes(record.id));
    assert.ok(
      evidence.some((record) => record.kind === 'source_span' && record.symbol === 'fetch'),
    );
    assert.ok(
      bundle.findings.some(
        (finding) => finding.components.includes(caller) && finding.components.includes(service),
      ),
    );

    const mermaid = await exportContent(root, 'mermaid');
    assert.match(mermaid, /entrypoint_run/);
    assert.match(mermaid, /external_service_unresolved_host_run/);
    assert.doesNotMatch(mermaid, /module_scope/);
  });

  it('exports a refusal rather than an owner for a dynamic callable property', async () => {
    const root = project(`declare const key: string;
const command = { [key]: async () => fetch('/pricing') };
void command;
`);
    const audit = await run(root, ['audit', '--json']);
    const adapters =
      (audit['data'] as { coverage?: { adapters?: readonly Record<string, unknown>[] } })?.coverage
        ?.adapters ?? [];
    const effects = adapters.find((entry) => entry['adapterId'] === 'adapter:effects');
    assert.match(String(effects?.['detail'] ?? ''), /callable whose owner this build cannot name/);
    assert.match(String(effects?.['detail'] ?? ''), /no service component was inferred/);

    const bundle = JSON.parse(await exportContent(root, 'json')) as {
      graph: { components: readonly { id: string }[]; edges: readonly { from: string }[] };
    };
    assert.equal(
      bundle.graph.components.some(
        (component) =>
          component.id === 'entrypoint:command' || component.id.includes('module-scope'),
      ),
      false,
    );
    assert.equal(
      bundle.graph.edges.some((edge) => edge.from.includes('module-scope')),
      false,
    );
    assert.doesNotMatch(
      await exportContent(root, 'mermaid'),
      /entrypoint_(?:command|module_scope)/,
    );
  });

  it('keeps a dynamic key effect in its evaluation scope while refusing the callable body', async () => {
    const root = project(`const command = {
  [fetch('https://keys.example.com/name')]: async () =>
    fetch('https://body.example.com/pricing'),
};
void command;
`);
    const audit = await run(root, ['audit', '--json']);
    const adapters =
      (audit['data'] as { coverage?: { adapters?: readonly Record<string, unknown>[] } })?.coverage
        ?.adapters ?? [];
    assert.match(
      String(adapters.find((entry) => entry['adapterId'] === 'adapter:effects')?.['detail'] ?? ''),
      /callable whose owner this build cannot name/,
    );
    const bundle = JSON.parse(await exportContent(root, 'json')) as {
      graph: {
        components: readonly { id: string }[];
        edges: readonly { from: string; to: string }[];
      };
    };
    assert.ok(
      bundle.graph.components.some((component) => component.id === 'entrypoint:module-scope'),
    );
    assert.ok(
      bundle.graph.edges.some(
        (edge) =>
          edge.from === 'entrypoint:module-scope' &&
          edge.to === 'external_service:keys.example.com',
      ),
    );
    assert.ok(
      bundle.graph.components.some(
        (component) => component.id === 'external_service:body.example.com',
      ),
    );
    assert.equal(
      bundle.graph.edges.some((edge) => edge.to === 'external_service:body.example.com'),
      false,
    );
  });
});
