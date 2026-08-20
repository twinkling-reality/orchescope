import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

/**
 * The loop the README teaches is the loop the product prints.
 *
 * The README leads with five steps because that is the whole interface a reader has to learn, and the same
 * five arrive in every `--json` document and in every MCP payload as `loop.steps`. Two copies of one idea
 * drift, and this one drifts silently: renaming a step moves nothing a test would catch, and what a reader
 * is told to expect stops matching what the terminal shows them.
 *
 * The comparison is against a real audit rather than against the constants, because the constants are the
 * half a reader never sees.
 */

const execFileAsync = promisify(execFile);
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliEntry = join(repositoryRoot, 'apps/cli/src/main.ts');

type LoopStep = { readonly ordinal: number; readonly title: string };

const loopOfTheDemonstration = async (): Promise<readonly LoopStep[]> => {
  const { stdout } = await execFileAsync(
    process.execPath,
    [cliEntry, '--cwd', join(repositoryRoot, 'apps/demo'), 'audit', '--json'],
    {
      cwd: repositoryRoot,
      maxBuffer: 64 * 1024 * 1024,
      timeout: 240_000,
      env: { ...process.env, NO_COLOR: '1' },
    },
  );
  const document = JSON.parse(stdout) as {
    ok: boolean;
    data: { loop: { steps: readonly LoopStep[] } };
  };
  assert.equal(document.ok, true, 'the audit that the README describes did not succeed');
  return document.data.loop.steps;
};

/** The rows of the one table under the loop heading, which is what a reader is told to expect. */
const documentedSteps = (): readonly string[] => {
  const readme = readFileSync(join(repositoryRoot, 'README.md'), 'utf8');
  const section = readme.slice(readme.indexOf('\n## The loop\n'));
  const end = section.indexOf('\n## ', 1);
  const body = end === -1 ? section : section.slice(0, end);
  return [...body.matchAll(/^\| (\d) ([^|]+?) \|/gm)].map((row) => `${row[1]} ${row[2]}`);
};

describe('the loop the README teaches', () => {
  it('names the steps the product prints, in the order it prints them', async () => {
    const printed = await loopOfTheDemonstration();
    const documented = documentedSteps();
    assert.ok(documented.length > 0, 'no loop table was found under the README heading');
    assert.deepEqual(
      documented,
      printed.map((step) => `${step.ordinal} ${step.title}`),
      'the README teaches a loop that is not the one an audit prints',
    );
  });
});
