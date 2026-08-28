import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

/**
 * A repository can only run a scenario it declares.
 *
 * A project identifier is minted from the scan root and the store lives inside the repository, so copying a
 * repository together with its `.orchescope` directory produces one database holding two projects. The
 * scenario table was keyed on the author-chosen name alone, and three of its four readers never mentioned a
 * project, so the copy inherited the original's scenarios: **a repository holding no scenario file at all
 * loaded another repository's scenario and spawned its argv**, under that scenario's permissions, budgets
 * and evaluators rather than any it had declared.
 *
 * Through the real command line, because the store is not the surface anybody uses and a signature is not
 * what went wrong. `example` is the identifier this product's own `init --scenario` writes into every
 * template it hands out, so the collision is the expected case rather than a contrived one.
 */

const execFileAsync = promisify(execFile);
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliEntry = join(repositoryRoot, 'apps/cli/src/main.ts');

const roots: string[] = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

type Result = { readonly stdout: string; readonly stderr: string; readonly code: number };

const run = async (cwd: string, args: readonly string[]): Promise<Result> => {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [cliEntry, '--cwd', cwd, ...args],
      {
        cwd: repositoryRoot,
        maxBuffer: 64 * 1024 * 1024,
        timeout: 240_000,
        env: { ...process.env, NO_COLOR: '1' },
      },
    );
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: failure.stdout ?? '', stderr: failure.stderr ?? '', code: failure.code ?? 1 };
  }
};

/** The identifier `init --scenario` writes, declared by one repository and by nothing in the copy. */
const SCENARIO = [
  'schemaVersion: 1',
  'id: example',
  'name: The scenario only this repository declares',
  'target:',
  "  command: ['node', 'src/declared-here-only.js']",
  '  resultSource: exit_code',
  '  timeoutMs: 10000',
  'evaluators:',
  '  - kind: exit_code',
  '    equals: 0',
  'budgets: {}',
  'faults: []',
  'repetitions: 1',
  'requiredPermissions:',
  '  - process:spawn',
  'tags: []',
  'metadata: {}',
  '',
].join('\n');

describe('a scenario belongs to the repository that declares it', () => {
  it('is not loadable from a copy that declares none', async () => {
    const declaring = mkdtempSync(join(tmpdir(), 'orchescope-declaring-'));
    roots.push(declaring);
    mkdirSync(join(declaring, 'src'), { recursive: true });
    mkdirSync(join(declaring, 'scenarios'), { recursive: true });
    writeFileSync(
      join(declaring, 'package.json'),
      '{\n  "name": "declaring",\n  "private": true,\n  "type": "module"\n}\n',
    );
    writeFileSync(
      join(declaring, 'src/declared-here-only.js'),
      'process.stdout.write("declared here only\\n");\n',
    );
    writeFileSync(join(declaring, 'scenarios/example.yaml'), SCENARIO);
    await run(declaring, ['audit']);

    /*
     * The copy is the whole mechanism: the state directory travels with it, the scan root does not, so one
     * database now holds two projects. Its own scenario file and the script the other one runs are removed,
     * so anything it manages to execute came from the other repository.
     */
    const copy = mkdtempSync(join(tmpdir(), 'orchescope-copy-'));
    roots.push(copy);
    cpSync(declaring, copy, { recursive: true });
    rmSync(join(copy, 'scenarios'), { recursive: true, force: true });
    rmSync(join(copy, 'src/declared-here-only.js'), { force: true });

    const audited = await run(copy, ['audit', '--json']);
    const document = JSON.parse(audited.stdout) as {
      readonly data: { readonly summary: { readonly scenarioCount: number } };
    };
    assert.equal(
      document.data.summary.scenarioCount,
      0,
      'the copy reported a scenario it does not declare',
    );

    const attempted = await run(copy, ['test', '--scenario', 'example']);
    assert.match(
      `${attempted.stdout}${attempted.stderr}`,
      /No scenario named example/,
      'a repository with no scenario file loaded one from another repository',
    );
    assert.doesNotMatch(
      `${attempted.stdout}${attempted.stderr}`,
      /declared-here-only/,
      'the copy spawned an argv only the other repository declares',
    );

    /* The repository that does declare it still runs it, which is what says the scoping is not a refusal. */
    const declared = await run(declaring, ['test', '--scenario', 'example', '--json']);
    const ran = JSON.parse(declared.stdout) as {
      readonly ok: boolean;
      readonly data: { readonly result: { readonly passed: boolean } };
    };
    assert.equal(
      ran.ok,
      true,
      `the declaring repository could not run its own scenario: ${declared.stdout}`,
    );
    assert.equal(ran.data.result.passed, true);
  });
});
