import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

/**
 * The scenario template, through the commands a reader actually runs.
 *
 * `orchescope trace` is the one command in the loop whose argv carries a placeholder, because the command
 * that starts somebody else's system is not a fact this build reads. A scenario is where that command is
 * declared once, and `init --scenario` writes the file to declare it in. A template that the scenario parser
 * then rejects would turn a one time answer into a debugging session, and a template written into the
 * directory scenarios are loaded from would count as a scenario nobody wrote.
 *
 * So the run here is the whole path: write the template, check it is inert where it lands, move it, and run
 * it. The target is a real script that exits zero, so what this proves is that the file as written is one
 * the runner accepts rather than only one the validator does.
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

/** A project whose start command is exactly the one the template writes by default. */
const project = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'orchescope-scenario-'));
  roots.push(root);
  writeFileSync(join(root, 'package.json'), '{ "name": "example", "private": true }\n');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/main.js'), "process.stdout.write('done\\n');\n");
  return root;
};

type AuditData = {
  readonly summary: { readonly scenarioCount: number };
  readonly loop: {
    readonly steps: readonly { readonly id: string; readonly detail: readonly string[] }[];
  };
};

const auditJson = async (root: string): Promise<AuditData> => {
  const result = await run(['--cwd', root, 'audit', '--json']);
  const document = JSON.parse(result.stdout) as { ok: boolean; data: AuditData };
  assert.equal(document.ok, true, `the audit failed: ${result.stdout}${result.stderr}`);
  return document.data;
};

const measureDetail = (data: AuditData): readonly string[] =>
  data.loop.steps.find((step) => step.id === 'measure')?.detail ?? [];

describe('the scenario template', () => {
  it('is written, is inert where it is written, and runs once it is moved', async () => {
    const root = project();

    const before = await auditJson(root);
    assert.equal(before.summary.scenarioCount, 0, 'the project began with a scenario');
    assert.ok(
      measureDetail(before).some((line) => line.includes('init --scenario')),
      `nothing named the way to declare the command: ${measureDetail(before).join(' | ')}`,
    );

    const init = await run(['--cwd', root, 'init', '--scenario']);
    assert.equal(init.code, 0, `init failed: ${init.stdout}${init.stderr}`);
    assert.match(init.stdout, /wrote .*\.orchescope\/scenario\.yaml/);

    /*
     * Written under .orchescope and loaded from scenarios/, so the template on disk cannot report a
     * scenario the repository does not have. The count is the assertion that says so.
     */
    const written = await auditJson(root);
    assert.equal(
      written.summary.scenarioCount,
      0,
      'the template counted as a scenario while it was still a template',
    );

    mkdirSync(join(root, 'scenarios'), { recursive: true });
    renameSync(join(root, '.orchescope/scenario.yaml'), join(root, 'scenarios/example.yaml'));

    const moved = await auditJson(root);
    assert.equal(moved.summary.scenarioCount, 1, 'the moved template was not read as a scenario');
    assert.equal(
      measureDetail(moved).some((line) => line.includes('init --scenario')),
      false,
      'the way to declare the command was still offered after it had been declared',
    );

    const test = await run(['--cwd', root, 'test', '--scenario', 'example', '--json']);
    const document = JSON.parse(test.stdout) as {
      ok: boolean;
      data: { result: { passed: boolean }; runIds: readonly string[] };
    };
    assert.equal(document.ok, true, `the scenario did not run: ${test.stdout}${test.stderr}`);
    assert.equal(
      document.data.result.passed,
      true,
      `the template as written did not pass its own evaluator: ${test.stdout}`,
    );
    assert.equal(
      document.data.runIds.length,
      3,
      'the repetitions the template declares did not each produce a run',
    );
  });

  it('never overwrites an answer somebody has already given', async () => {
    const root = project();
    await run(['--cwd', root, 'init', '--scenario']);
    writeFileSync(join(root, '.orchescope/scenario.yaml'), 'mine\n');
    const again = await run(['--cwd', root, 'init', '--scenario']);
    assert.match(again.stdout, /scenario\.yaml already exists, left unchanged/);
  });
});
