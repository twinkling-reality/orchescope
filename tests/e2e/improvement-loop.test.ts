import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

/**
 * The closed loop, end to end, through the real command line.
 *
 * This is the test that proves the product claim: a defect is discovered from evidence, becomes a bounded goal, the
 * change is made, the same scenario is rerun, and the comparison decides whether the change actually helped. Nothing
 * here is mocked. The demonstration system is copied so its deliberate defect stays in the repository, the copy is
 * patched the way the goal describes, and the verdict has to come from measured runs.
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

/**
 * In JSON mode standard output carries exactly one document and nothing else. Parsing the whole stream rather than
 * hunting for a line is the contract this asserts.
 */
const parseJson = (
  result: CliResult,
): { ok: boolean; command: string; data: Record<string, unknown> } => {
  const text = result.stdout.trim();
  assert.ok(
    text.startsWith('{') && text.endsWith('}'),
    `standard output was not a single JSON document: ${text.slice(0, 300)} | stderr: ${result.stderr.slice(0, 300)}`,
  );
  return JSON.parse(text) as { ok: boolean; command: string; data: Record<string, unknown> };
};

const workspaces: string[] = [];

const copyDemo = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'orchescope-loop-'));
  workspaces.push(root);
  cpSync(join(repositoryRoot, 'apps/demo'), root, {
    recursive: true,
    filter: (source) => !source.includes('/.orchescope/state') && !source.includes('/node_modules'),
  });
  return root;
};

/**
 * The change the goal asks for: a stable idempotency key on the refund, and a gateway that honours it. Without the
 * second half a retry still produces a second effect, which is the point of the finding.
 */
const applyIdempotencyFix = (root: string): void => {
  const file = join(root, 'src/tools/refund.ts');
  const original = readFileSync(file, 'utf8');

  const anchor = `  const target = \`payments/order-\${request.orderId}\`;
  const reference = referenceFor(request, attempt);`;
  assert.ok(
    original.includes(anchor),
    'the refund tool no longer matches the anchor this test patches',
  );

  const patched = original
    .replace(
      anchor,
      `  const target = \`payments/order-\${request.orderId}\`;
  const idempotencyKey = \`rfd-\${request.orderId}\`;
  const settledReference = settledRefunds.get(idempotencyKey);
  if (settledReference !== undefined) {
    span.set('orchescope.idempotency.replayed', true);
    return settledReference;
  }
  const reference = referenceFor(request, attempt);`,
    )
    .replaceAll(
      "recordEffect(context, span, { kind: 'refund', target, outcome: 'unknown' });",
      "recordEffect(context, span, { kind: 'refund', target, idempotencyKey, outcome: 'unknown' });\n    settledRefunds.set(idempotencyKey, reference);",
    )
    .replaceAll(
      "recordEffect(context, span, { kind: 'refund', target, outcome: 'failed' });",
      "recordEffect(context, span, { kind: 'refund', target, idempotencyKey, outcome: 'failed' });",
    )
    .replaceAll(
      "recordEffect(context, span, { kind: 'refund', target, outcome: 'succeeded' });",
      "recordEffect(context, span, { kind: 'refund', target, idempotencyKey, outcome: 'succeeded' });\n  settledRefunds.set(idempotencyKey, reference);",
    );

  const withLedger = patched.replace(
    'const referenceFor =',
    `/** Keys the gateway has already settled in this process, which is what makes a retry safe to repeat. */
const settledRefunds = new Map<string, string>();

const referenceFor =`,
  );
  assert.notEqual(withLedger, original, 'the patch produced no change');
  writeFileSync(file, withLedger);

  const manifestPath = join(root, '.orchescope/manifest.yaml');
  const manifest = readFileSync(manifestPath, 'utf8');
  const updated = manifest.replace('        idempotency: absent', '        idempotency: declared');
  assert.notEqual(
    updated,
    manifest,
    'the manifest no longer declares the refund idempotency as absent',
  );
  writeFileSync(manifestPath, updated);
};

after(() => {
  for (const root of workspaces) rmSync(root, { recursive: true, force: true });
});

describe('the improvement loop', () => {
  it('discovers a duplicated side effect, creates a goal, and confirms the fix by comparison', async () => {
    const root = copyDemo();

    // 1. Baseline evidence. The fault scenario makes the refund retry, which is what duplicates the effect.
    const baseline = parseJson(
      await runCli(root, ['test', '--scenario', 'support-desk-duplicate', '--json']),
    );
    assert.equal(baseline.command, 'test');
    const baselineRunIds = (baseline.data['runIds'] as string[] | undefined) ?? [];
    assert.ok(baselineRunIds.length > 0, 'the baseline run produced no run identifier');
    const baselineRunId = baselineRunIds[0] as string;

    const baselineResult = baseline.data['result'] as {
      repetitions: { metrics: { duplicateSideEffects: number }; sideEffects: unknown[] }[];
    };
    const baselineDuplicates = baselineResult.repetitions.reduce(
      (total, repetition) => total + repetition.metrics.duplicateSideEffects,
      0,
    );
    assert.ok(
      baselineDuplicates > 0,
      `the baseline should duplicate a side effect under the injected fault, saw ${baselineDuplicates}`,
    );

    // 2. The audit has to find it, name the tool, and mark it eligible to become a goal.
    const audit = parseJson(await runCli(root, ['audit', '--json']));
    const findings = audit.data['findings'] as {
      id: string;
      ruleId: string;
      components: string[];
      goalReadiness: { eligible: boolean };
      basis: string;
    }[];
    const duplicateFinding = findings.find((finding) => finding.ruleId === 'duplicate-side-effect');
    assert.ok(
      duplicateFinding !== undefined,
      'the audit did not report the duplicated side effect',
    );
    assert.equal(duplicateFinding.basis, 'observed');
    assert.ok(
      duplicateFinding.components.includes('tool:issue_refund'),
      `the finding did not attribute the duplicate to the refund tool: ${duplicateFinding.components.join(', ')}`,
    );
    assert.equal(duplicateFinding.goalReadiness.eligible, true);

    const reconciliation = audit.data['reconciliation'] as {
      duplicateSideEffects: { key: string; idempotencyKeyPresent: boolean; occurrences: number }[];
    };
    assert.equal(reconciliation.duplicateSideEffects[0]?.idempotencyKeyPresent, false);

    // 3. The goal has to be bounded: a write scope, criteria and a validation command that names the scenario.
    const created = parseJson(
      await runCli(root, ['goal', 'create', duplicateFinding.id, '--json']),
    );
    const goal = created.data['goal'] as {
      id: string;
      scope: { allowedWritePaths: string[] };
      acceptanceCriteria: { id: string }[];
      validation: { scenarioIds: string[]; commands: { command: string[] }[] };
    };
    assert.match(goal.id, /^OSC-GOAL-\d{4}$/);
    assert.ok(goal.scope.allowedWritePaths.some((path) => path.includes('refund')));
    assert.ok(goal.acceptanceCriteria.length >= 3);
    assert.ok(typeof created.data['agentPrompt'] === 'string');
    assert.match(created.data['agentPrompt'] as string, /You may change only these paths/);

    // 4. Make the change the goal describes.
    applyIdempotencyFix(root);

    // 5. Rerun the same scenario with the same seed and fault plan.
    const candidate = parseJson(
      await runCli(root, ['test', '--scenario', 'support-desk-duplicate', '--json']),
    );
    const candidateRunIds = (candidate.data['runIds'] as string[] | undefined) ?? [];
    assert.ok(candidateRunIds.length > 0);
    const candidateResult = candidate.data['result'] as {
      repetitions: { metrics: { duplicateSideEffects: number } }[];
    };
    const candidateDuplicates = candidateResult.repetitions.reduce(
      (total, repetition) => total + repetition.metrics.duplicateSideEffects,
      0,
    );
    assert.equal(
      candidateDuplicates,
      0,
      'the fix should remove the duplicated effect from the same scenario and seed',
    );

    // 6. The comparison has to say the duplication improved, from measured runs on both sides.
    const compared = parseJson(
      await runCli(root, [
        'compare',
        baselineRunId,
        candidateRunIds[0] as string,
        '--goal',
        goal.id,
        '--json',
      ]),
    );
    const comparison = compared.data as unknown as {
      id: string;
      verdict: string;
      metricDeltas: { metric: string; direction: string; baseline?: number; candidate?: number }[];
    };
    const duplicateDelta = comparison.metricDeltas.find(
      (delta) => delta.metric === 'duplicateSideEffects',
    );
    assert.ok(duplicateDelta !== undefined, 'the comparison did not include the duplicate metric');
    assert.equal(duplicateDelta.baseline, 1);
    assert.equal(duplicateDelta.candidate, 0);
    assert.equal(duplicateDelta.direction, 'improved');
    assert.ok(
      comparison.verdict === 'improved' || comparison.verdict === 'mixed',
      `unexpected verdict ${comparison.verdict}`,
    );

    // 7. Rescan, then judge the goal. The static half of the finding has to be gone too.
    const rescan = parseJson(await runCli(root, ['audit', '--json']));
    const rescanFindings = rescan.data['findings'] as { ruleId: string }[];
    assert.equal(
      rescanFindings.some((finding) => finding.ruleId === 'retry-around-non-idempotent-operation'),
      false,
      'the static retry finding should be gone once the manifest declares the idempotency key',
    );

    // Judged with no --comparison, which is how anyone following the goal's own validation plan will
    // run it. The comparison was attached to the goal by `compare --goal`, so asking for its identifier
    // again would be asking the reader to carry something the store already holds, and answering "no
    // comparison was recorded" while it sits there would be false.
    const judgedByDefault = parseJson(await runCli(root, ['goal', 'validate', goal.id, '--json']));
    const defaultOutcomes = (
      judgedByDefault.data['validation'] as {
        outcomes: { satisfied: boolean; decided: boolean; detail: string }[];
      }
    ).outcomes;
    const defaultDuplicate = defaultOutcomes.find((outcome) =>
      outcome.detail.includes('duplicateSideEffects'),
    );
    assert.ok(
      defaultDuplicate !== undefined,
      'validating without --comparison judged no metric criterion',
    );
    assert.equal(
      defaultDuplicate.decided,
      true,
      `the comparison attached to the goal did not reach the judgement: ${defaultDuplicate.detail}`,
    );
    assert.equal(defaultDuplicate.satisfied, true);

    const validated = parseJson(
      await runCli(root, ['goal', 'validate', goal.id, '--comparison', comparison.id, '--json']),
    );
    const validation = validated.data['validation'] as {
      outcomes: { criterion: string; satisfied: boolean; decided: boolean; detail: string }[];
      summary: string;
    };
    const duplicateCriterion = validation.outcomes.find((outcome) =>
      outcome.detail.includes('duplicateSideEffects'),
    );
    assert.ok(
      duplicateCriterion !== undefined,
      `no criterion judged the duplicate metric: ${validation.summary}`,
    );
    assert.equal(duplicateCriterion.satisfied, true);
    assert.equal(duplicateCriterion.decided, true);

    // The scenario criterion is the one the product's own thesis rests on: the goal is verified by rerunning the
    // scenario it names. It is judged from the stored result of that rerun, and the result has to postdate the goal.
    const scenarioCriterion = validation.outcomes.find((outcome) =>
      outcome.detail.includes('support-desk-duplicate'),
    );
    assert.ok(
      scenarioCriterion !== undefined,
      `no criterion judged the scenario that was rerun: ${validation.summary}`,
    );
    assert.equal(
      scenarioCriterion.decided,
      true,
      `the rerun scenario left its criterion undecided: ${scenarioCriterion.detail}`,
    );
    assert.equal(scenarioCriterion.satisfied, true);

    // What each scenario run was judged by reaches the report, rather than being computed and dropped.
    const reportFile = join(root, 'loop-report.json');
    await runCli(root, ['export', '--format', 'json', '--out', reportFile]);
    const bundle = JSON.parse(readFileSync(reportFile, 'utf8')) as {
      evidence: { id: string; kind: string; inputs?: string[] }[];
      goals: { id: string; evidence: string[] }[];
      scenarioRuns: { scenarioId: string; evaluators: { kind: string; passed: boolean }[] }[];
      goalValidations?: {
        goalId: string;
        summary: string;
        outcomes: { criterionId: string; satisfied: boolean; decided: boolean; detail: string }[];
      }[];
    };

    const exportedGoal = bundle.goals.find((entry) => entry.id === goal.id);
    assert.ok(exportedGoal !== undefined, 'the rescan report dropped the goal');
    const exportedEvidence = new Set(bundle.evidence.map((record) => record.id));
    for (const evidenceId of exportedGoal.evidence) {
      assert.ok(
        exportedEvidence.has(evidenceId),
        `the rescan report dropped historical goal evidence ${evidenceId}`,
      );
    }
    const retainedDerivation = bundle.evidence.find(
      (record) => exportedGoal.evidence.includes(record.id) && record.kind === 'derived',
    );
    assert.ok(retainedDerivation !== undefined, 'the fixture goal carried no retained derivation');
    for (const input of retainedDerivation.inputs ?? []) {
      assert.ok(
        exportedEvidence.has(input),
        `the rescan report dropped historical derivation input ${input}`,
      );
    }

    // The judgement reaches the report. Without it the goals screen has only the comparison log to read,
    // and a goal that was judged but has no comparison attached looks like one nobody ever tried to
    // verify, which is a stronger claim than the report can support.
    const judgement = (bundle.goalValidations ?? []).find((entry) => entry.goalId === goal.id);
    assert.ok(judgement !== undefined, 'the report carried no judgement for the goal it carries');
    assert.equal(judgement.outcomes.length, goal.acceptanceCriteria.length);
    assert.ok(
      judgement.outcomes.some((outcome) => outcome.decided && outcome.satisfied),
      `the report judged nothing as satisfied: ${judgement.summary}`,
    );
    // A finding identifier is renumbered by any rescan that changes the finding set, so no sentence a
    // reader is asked to act on may name one.
    for (const outcome of judgement.outcomes) {
      assert.doesNotMatch(outcome.detail, /OSC-[A-Z]{3,5}-\d{4}/, outcome.detail);
    }
    const judged = bundle.scenarioRuns.filter((entry) => entry.evaluators.length > 0);
    assert.ok(
      judged.length > 0,
      `the report carried ${bundle.scenarioRuns.length} scenario run(s) and not one evaluator outcome`,
    );
    // Both sides of the loop are in this report: the baseline run that duplicated the refund failed the criterion
    // forbidding it, and the run after the fix satisfied it. A reader sees which one, rather than only that runs happened.
    const outcomes = judged.flatMap((entry) => entry.evaluators);
    assert.ok(
      outcomes.some((result) => result.passed),
      'no scenario criterion is recorded as satisfied anywhere in the report',
    );
    assert.ok(
      outcomes.some((result) => !result.passed),
      'the baseline run duplicated an effect and no criterion in the report records a failure',
    );
  });
});
