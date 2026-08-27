import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

/**
 * What a comparison has to compare, for its numbers to mean anything.
 *
 * A metric difference is called only where the samples support it, and the floor is three per side. Both
 * sides used to resolve to exactly one run, so the floor could not be reached by any command the product
 * printed: a real regression in task success came back `indeterminate` for want of samples that the
 * scenario had already recorded and stored. Repetitions exist to give a metric its sample size, and a
 * run that was one of them stands for the set.
 */

const execFileAsync = promisify(execFile);
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliEntry = join(repositoryRoot, 'apps/cli/src/main.ts');

type CliResult = { readonly stdout: string; readonly stderr: string; readonly code: number };

const runCli = async (cwd: string, args: readonly string[]): Promise<CliResult> => {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [cliEntry, '--cwd', cwd, ...args],
      { cwd: repositoryRoot, maxBuffer: 64 * 1024 * 1024, timeout: 240_000 },
    );
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: failure.stdout ?? '', stderr: failure.stderr ?? '', code: failure.code ?? 1 };
  }
};

type Comparison = {
  readonly baseline: { readonly runIds: string[] };
  readonly candidate: { readonly runIds: string[] };
  readonly metricDeltas: {
    readonly metric: string;
    readonly baselineSamples: number;
    readonly candidateSamples: number;
    readonly direction: string;
    readonly caveat?: string;
  }[];
};

describe('the samples a comparison is made from', () => {
  let root = '';
  let firstRunId = '';

  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'orchescope-comparison-samples-'));
    cpSync(join(repositoryRoot, 'apps/demo'), root, { recursive: true });
    rmSync(join(root, '.orchescope/state'), { recursive: true, force: true });

    await runCli(root, ['audit', '--json']);
    const first = await runCli(root, [
      'test',
      '--scenario',
      'support-desk',
      '--repetitions',
      '3',
      '--json',
    ]);
    const runIds = (JSON.parse(first.stdout) as { data: { runIds: string[] } }).data.runIds;
    assert.equal(runIds.length, 3, 'the scenario did not record three repetitions');
    firstRunId = runIds[0] as string;

    await runCli(root, ['test', '--scenario', 'support-desk', '--repetitions', '3', '--json']);
  });

  after(() => {
    if (root.length > 0) rmSync(root, { recursive: true, force: true });
  });

  it('takes the repetitions a named run belongs to, on both sides', async () => {
    const compared = await runCli(root, ['compare', firstRunId, 'latest', '--json']);
    assert.equal(compared.code === 0 || compared.code === 1, true, compared.stderr);
    const comparison = (JSON.parse(compared.stdout) as { data: Comparison }).data;

    assert.equal(
      comparison.baseline.runIds.length,
      3,
      'one repetition of the baseline stood for itself rather than for its set',
    );
    assert.equal(comparison.candidate.runIds.length, 3);

    const duration = comparison.metricDeltas.find((delta) => delta.metric === 'durationMs');
    assert.ok(duration !== undefined);
    assert.equal(duration.baselineSamples, 3);
    assert.equal(duration.candidateSamples, 3);
    /*
     * Whether the durations differ is a question about this machine, so the direction is not asserted.
     * What is asserted is that the sample floor is no longer the reason nothing can be said, which is
     * the defect: every non-incident metric was refused before either side had been looked at.
     */
    assert.doesNotMatch(
      duration.caveat ?? '',
      /samples per side/,
      `the floor is still unreachable: ${duration.caveat}`,
    );
  });

  it('leaves a run that no scenario repeated standing for itself', async () => {
    const traced = await runCli(root, ['trace', '--', 'node', 'src/main.ts']);
    assert.equal(traced.code, 0, traced.stderr);
    const compared = await runCli(root, ['compare', firstRunId, 'latest', '--json']);
    const comparison = (JSON.parse(compared.stdout) as { data: Comparison }).data;
    assert.equal(
      comparison.candidate.runIds.length,
      1,
      'a traced run belongs to no repetition set and must not be given one',
    );
  });
});
