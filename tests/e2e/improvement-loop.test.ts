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

    /*
     * 5. Run the goal's own validation plan, verbatim, in the order it prints.
     *
     * This step used to build its own argv, which is why the plan could print a compare command missing
     * the one flag that attaches the comparison to the goal and no test noticed. A goal is a contract
     * handed to an agent that will do exactly what it says and nothing else, so the only honest way to
     * test it is to be that agent: every token here comes from the document, and if the document is
     * wrong the loop below cannot close.
     */
    assert.ok(
      goal.validation.commands.length >= 2,
      `the plan printed nothing to run: ${JSON.stringify(goal.validation.commands)}`,
    );
    const compareStep = goal.validation.commands.find((step) => step.command[1] === 'compare');
    assert.ok(compareStep !== undefined, 'the plan named no comparison');
    assert.ok(
      compareStep.command.includes(baselineRunId),
      `the plan's compare does not name the baseline run: ${compareStep.command.join(' ')}`,
    );
    /*
     * The plan has to end at the step that answers it. Every command before this one produces evidence
     * and none of them says what the evidence decided, so a plan that stopped at the comparison left an
     * operator having done all the work and been told nothing.
     */
    const last = goal.validation.commands.at(-1);
    assert.deepEqual(
      last?.command,
      ['orchescope', 'goal', 'validate', goal.id],
      'the plan does not end at the command that renders its own decision',
    );

    for (const step of goal.validation.commands) {
      assert.equal(step.command[0], 'orchescope', `${step.command.join(' ')} is not this binary`);
      const outcome = await runCli(root, step.command.slice(1));
      /*
       * Exit 1 is a verdict rather than a refusal, and only from the step whose job is to reach one:
       * `goal validate` exits 1 when the goal is not yet validated, which is an answer about the change
       * and not a command the binary would not run. Everything above it either worked or did not, and
       * codes 2, 3 and 70 mean the plan asked for something this binary refuses, which is the defect
       * running the plan verbatim exists to catch.
       */
      const verdictStep = step.command[1] === 'goal' && step.command[2] === 'validate';
      assert.ok(
        verdictStep ? outcome.code === 0 || outcome.code === 1 : outcome.code === 0,
        `the plan's own command failed with ${outcome.code}: ${step.command.join(' ')}\n${outcome.stderr}`,
      );
    }

    // 6. The static half of the finding has to be gone too, which the plan's own rescan established.
    const rescan = parseJson(await runCli(root, ['audit', '--json']));
    const rescanFindings = rescan.data['findings'] as { ruleId: string }[];
    assert.equal(
      rescanFindings.some((finding) => finding.ruleId === 'retry-around-non-idempotent-operation'),
      false,
      'the static retry finding should be gone once the manifest declares the idempotency key',
    );

    /*
     * 7. Judge the goal the way the plan leaves it: no `--comparison`, because the plan never asked the
     * operator to carry an identifier. The comparison reaches the judgement only through the goal the
     * plan's own compare command named, so this assertion is the whole loop in one line, and it is the
     * line that fails when the plan prints a command missing that name.
     */
    const judgedByDefault = parseJson(await runCli(root, ['goal', 'validate', goal.id, '--json']));
    const judgedGoal = judgedByDefault.data['goal'] as {
      validationResults: { comparisonId: string; verdict: string }[];
    };
    const validation = judgedByDefault.data['validation'] as {
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
    assert.equal(
      duplicateCriterion.decided,
      true,
      `the comparison the plan produced did not reach the judgement: ${duplicateCriterion.detail}`,
    );
    assert.equal(duplicateCriterion.satisfied, true);
    assert.match(duplicateCriterion.detail, /moved from 1 to 0/);
    assert.match(duplicateCriterion.detail, /improved/);

    /*
     * The goal records which comparison judged it, and it can only record one it was able to find. An
     * empty list here means the plan produced a comparison the goal cannot see, which is the shape of
     * the defect this whole step exists to catch.
     */
    assert.equal(
      judgedGoal.validationResults.length,
      1,
      `the goal recorded no comparison after running its own plan: ${JSON.stringify(judgedGoal.validationResults)}`,
    );

    /*
     * The flag has to name a goal that exists. A mistyped identifier stores a comparison attached to
     * nothing and leaves the real goal reporting that no comparison was recorded, which is exactly what
     * forgetting the flag looked like, so it is refused rather than accepted quietly.
     */
    const misattached = await runCli(root, [
      'compare',
      baselineRunId,
      'latest',
      '--goal',
      'OSC-GOAL-9999',
    ]);
    assert.notEqual(misattached.code, 0, 'a comparison named a goal that does not exist');
    assert.match(`${misattached.stdout}${misattached.stderr}`, /OSC-GOAL-9999/);

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
