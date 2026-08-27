import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

/**
 * The one acceptance criterion nothing in a run can decide, decided.
 *
 * A `manual_review` criterion used to be hard wired undecided, so a goal cut from any finding that needs
 * a review could never reach `validated` whatever anyone did: the term read as a requirement and behaved
 * as a permanent block. What decides it is an act, and this walks that act through the real command line
 * on the demonstration system's own approval finding.
 *
 * The placeholder case is the point of the whole thing. The plan prints the command with the reviewer's
 * words left as `<what you checked>`, and an agent that ran the plan without reading it would otherwise
 * store that string and satisfy the criterion with text this product wrote itself.
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

const parseJson = (result: CliResult): { data: Record<string, unknown> } =>
  JSON.parse(result.stdout) as { data: Record<string, unknown> };

type Goal = {
  readonly id: string;
  readonly acceptanceCriteria: { readonly id: string; readonly check: { readonly kind: string } }[];
  readonly validation: { readonly commands: { readonly command: string[] }[] };
};

describe('the review a goal cannot be validated without', () => {
  let root = '';
  let goal: Goal | undefined;

  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'orchescope-goal-review-'));
    cpSync(join(repositoryRoot, 'apps/demo'), root, { recursive: true });
    rmSync(join(root, '.orchescope/state'), { recursive: true, force: true });

    const audited = parseJson(await runCli(root, ['audit', '--json']));
    const findings = audited.data['findings'] as {
      id: string;
      goalReadiness: { eligible: boolean; requiresHumanReview: boolean };
    }[];
    const needsReview = findings.find(
      (finding) => finding.goalReadiness.eligible && finding.goalReadiness.requiresHumanReview,
    );
    assert.ok(
      needsReview !== undefined,
      'the demonstration system declares no goal-eligible finding that needs a review',
    );
    const created = parseJson(await runCli(root, ['goal', 'create', needsReview.id, '--json']));
    goal = created.data['goal'] as Goal;
  });

  after(() => {
    if (root.length > 0) rmSync(root, { recursive: true, force: true });
  });

  it('names the act that decides it, immediately before the step that reads it', () => {
    assert.ok(goal !== undefined);
    assert.ok(
      goal.acceptanceCriteria.some((criterion) => criterion.check.kind === 'manual_review'),
      'this goal states no criterion a review decides',
    );
    const argv = goal.validation.commands.map((step) => step.command.join(' '));
    assert.deepEqual(argv.slice(-2), [
      `orchescope goal review ${goal.id} --note <what you checked>`,
      `orchescope goal validate ${goal.id}`,
    ]);
  });

  it('refuses the placeholder the plan itself printed', async () => {
    assert.ok(goal !== undefined);
    const refused = await runCli(root, ['goal', 'review', goal.id, '--note', '<what you checked>']);
    assert.notEqual(refused.code, 0);
    assert.match(`${refused.stdout}${refused.stderr}`, /still the placeholder/);

    const judged = parseJson(await runCli(root, ['goal', 'validate', goal.id, '--json']));
    const review = (
      judged.data['validation'] as {
        outcomes: { criterion: { check: { kind: string } }; decided: boolean }[];
      }
    ).outcomes.find((outcome) => outcome.criterion.check.kind === 'manual_review');
    assert.equal(review?.decided, false, 'a refused review still decided the criterion');
  });

  it('decides the criterion from what a reviewer actually wrote', async () => {
    assert.ok(goal !== undefined);
    const note = 'confirmed the approval gate wraps the refund itself, not only the log line';
    const recorded = await runCli(root, ['goal', 'review', goal.id, '--note', note]);
    assert.equal(recorded.code, 0, `${recorded.stdout}${recorded.stderr}`);

    const judged = parseJson(await runCli(root, ['goal', 'validate', goal.id, '--json']));
    const review = (
      judged.data['validation'] as {
        outcomes: {
          criterion: { check: { kind: string } };
          decided: boolean;
          satisfied: boolean;
          detail: string;
        }[];
      }
    ).outcomes.find((outcome) => outcome.criterion.check.kind === 'manual_review');
    assert.equal(review?.decided, true);
    assert.equal(review?.satisfied, true);
    /*
     * What the store holds is an attestation, so the detail says a review was recorded and quotes it. A
     * detail that said a human had verified the change would be a claim nothing here can support:
     * Orchescope authenticates nobody.
     */
    assert.match(review?.detail ?? '', /a review was recorded at/);
    assert.match(review?.detail ?? '', /approval gate wraps the refund/);
  });

  it('refuses a review against a goal that asks for none', async () => {
    const audited = parseJson(await runCli(root, ['audit', '--json']));
    const findings = audited.data['findings'] as {
      id: string;
      goalReadiness: { eligible: boolean; requiresHumanReview: boolean };
    }[];
    /*
     * Any eligible finding that asks for no review will do, and some of them cannot be cut without a
     * recorded run, so the first one that a goal can actually be made from is the subject.
     */
    let other: Goal | undefined;
    for (const finding of findings) {
      if (!finding.goalReadiness.eligible || finding.goalReadiness.requiresHumanReview) continue;
      const attempt = await runCli(root, ['goal', 'create', finding.id, '--json']);
      if (attempt.code !== 0) continue;
      other = parseJson(attempt).data['goal'] as Goal;
      break;
    }
    assert.ok(other !== undefined, 'no goal could be cut from a finding that asks for no review');
    assert.equal(
      other.acceptanceCriteria.some((criterion) => criterion.check.kind === 'manual_review'),
      false,
    );

    const refused = await runCli(root, ['goal', 'review', other.id, '--note', 'looked at it']);
    assert.notEqual(refused.code, 0);
    assert.match(`${refused.stdout}${refused.stderr}`, /states no criterion that a review decides/);
  });
});
