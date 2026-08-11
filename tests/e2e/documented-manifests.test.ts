import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

/**
 * The manifest is the documented escape hatch for a system no adapter can read, so an example a reader could
 * copy has to be one the real reader accepts. Every case here writes a manifest into a repository and runs the
 * actual audit rather than validating a schema in isolation, because the failure this guards against is a
 * manifest that parses in principle and is rejected in practice.
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

/** A repository in a language this build does not parse, so only the manifest can populate the graph. */
const unparsedProject = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'orchescope-manifest-'));
  roots.push(root);
  writeFileSync(join(root, 'go.mod'), 'module example.com/agent\n\ngo 1.23\n');
  mkdirSync(join(root, 'cmd'), { recursive: true });
  writeFileSync(join(root, 'cmd/main.go'), 'package main\n\nfunc main() {}\n');
  return root;
};

const writeManifest = (root: string, body: string): void => {
  mkdirSync(join(root, '.orchescope'), { recursive: true });
  writeFileSync(join(root, '.orchescope/manifest.yaml'), body);
};

type AuditData = {
  readonly agentSystemDetected: boolean;
  readonly summary: { readonly componentCount: number; readonly edgeCount: number };
  readonly coverage: {
    readonly adapters: readonly {
      readonly adapterId: string;
      readonly status: string;
      readonly componentsFound: number;
      readonly detail?: string;
    }[];
  };
};

const auditJson = async (root: string): Promise<AuditData> => {
  const result = await run(['--cwd', root, 'audit', '--json']);
  const document = JSON.parse(result.stdout) as { data: AuditData };
  return document.data;
};

const manifestAdapter = (data: AuditData) => {
  const entry = data.coverage.adapters.find((adapter) => adapter.adapterId === 'adapter:manifest');
  assert.ok(entry !== undefined, 'the manifest adapter did not appear in coverage');
  return entry;
};

const markdownFiles = (directory: string): readonly string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : markdownFiles(path);
    return entry.name.endsWith('.md') ? [path] : [];
  });

/**
 * A fenced yaml block counts as a manifest example when it carries both `schemaVersion` and `components` at the
 * start of a line, which is the pair no other documented document shape uses.
 */
const manifestExamples = (file: string): readonly { source: string; body: string }[] => {
  const text = readFileSync(file, 'utf8');
  const examples: { source: string; body: string }[] = [];
  let index = 0;
  for (const match of text.matchAll(/```ya?ml\n([\s\S]*?)```/g)) {
    const body = match[1] ?? '';
    index += 1;
    if (!/^schemaVersion:/m.test(body) || !/^components:/m.test(body)) continue;
    examples.push({ source: `${relative(repositoryRoot, file)} block ${index}`, body });
  }
  return examples;
};

describe('every documented manifest example is one the reader accepts', () => {
  const examples = [
    join(repositoryRoot, 'README.md'),
    ...markdownFiles(join(repositoryRoot, 'docs')),
  ].flatMap((file) => manifestExamples(file));

  it('found the examples it is meant to check', () => {
    assert.ok(examples.length > 0, 'no documented manifest example was found');
  });

  for (const example of examples) {
    it(`${example.source} is read without a problem`, async () => {
      const root = unparsedProject();
      writeManifest(root, example.body);
      const data = await auditJson(root);
      const adapter = manifestAdapter(data);
      assert.equal(
        adapter.status,
        'completed',
        `${example.source} was rejected: ${adapter.detail ?? 'no detail'}`,
      );
      assert.ok(
        adapter.componentsFound > 0,
        `${example.source} declared no component that reached the graph`,
      );
    });
  }
});

describe('the manifest template', () => {
  it('is accepted, declares nothing, and does not make a repository look detected', async () => {
    const root = unparsedProject();
    const init = await run(['--cwd', root, 'init', '--manifest']);
    assert.equal(init.code, 0);
    assert.match(init.stdout, /manifest\.yaml/);

    const data = await auditJson(root);
    const adapter = manifestAdapter(data);
    assert.equal(adapter.status, 'completed', adapter.detail ?? 'the template was rejected');
    assert.equal(adapter.componentsFound, 0);
    assert.equal(data.agentSystemDetected, false);
  });

  it('is left alone when a manifest already exists', async () => {
    const root = unparsedProject();
    writeManifest(root, 'schemaVersion: 1\ncomponents: []\nedges: []\n');
    const init = await run(['--cwd', root, 'init', '--manifest']);
    assert.equal(init.code, 0);
    assert.match(init.stdout, /already exists, left unchanged/);
    assert.equal(
      readFileSync(join(root, '.orchescope/manifest.yaml'), 'utf8'),
      'schemaVersion: 1\ncomponents: []\nedges: []\n',
    );
  });
});

describe('a manifest the validator rejects', () => {
  const invalid = [
    'schemaVersion: 1',
    'components:',
    '  - kind: tool',
    '    name: issue_refund',
    '    sideEffect:',
    '      class: financial',
    'edges: []',
    '',
  ].join('\n');

  it('is reported as a failed adapter naming the field, not ignored', async () => {
    const root = unparsedProject();
    writeManifest(root, invalid);
    const data = await auditJson(root);
    const adapter = manifestAdapter(data);
    assert.equal(adapter.status, 'failed');
    assert.match(adapter.detail ?? '', /manifest\.yaml is not a valid manifest/);
    assert.match(adapter.detail ?? '', /sideEffect/);
  });

  /*
   * The row is bounded like every other row, so a validator message longer than the sentence column
   * continues on one further line. What may not be lost either way is the pointer into the document:
   * it is the only thing in the whole report that says which line of their manifest to change.
   */
  it('is named on the terminal, with the field, and the next step is to correct it', async () => {
    const root = unparsedProject();
    writeManifest(root, invalid);
    const result = await run(['--cwd', root, 'audit']);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /gap {13}x failed {5}manifest: \.orchescope\/manifest\.yaml/);
    assert.match(result.stdout, /is not a valid/);
    assert.match(result.stdout, /\/components\/0\/sideEffect/);
    assert.match(result.stdout, /next {12}correct \.orchescope\/manifest\.yaml/);
  });
});

describe('a repository no adapter can read', () => {
  it('is told what was not inspected and pointed at the manifest', async () => {
    const root = unparsedProject();
    const result = await run(['--cwd', root, 'audit']);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /No agent system was detected/);
    assert.match(result.stdout, /^gap {13}\. unparsed {3}go source files \(1\)$/m);
    assert.match(result.stdout, /^run {13}orchescope init --manifest$/m);
    assert.equal(
      (result.stdout.match(/^run /gm) ?? []).length,
      1,
      'exactly one run row answers what to do',
    );
  });
});
