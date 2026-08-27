import { MINIMUM_SAMPLES_PER_SIDE } from '@orchescope/domain';
import type { Goal } from '@orchescope/schema';

/**
 * Goal rendering for humans and for coding agents.
 *
 * The agent prompt is deliberately self contained and deliberately narrow. It states the problem, the evidence,
 * the exact files that may change, what must not change, how success is measured and the exact commands that
 * measure it. It does not ask the reader to be careful or to use their judgement, because a bounded task with a
 * verifiable outcome is the only kind of task worth handing to an agent.
 */

const bullet = (lines: readonly string[]): string =>
  lines.length === 0 ? '  none' : lines.map((line) => `  - ${line}`).join('\n');

const criterionText = (criterion: Goal['acceptanceCriteria'][number]): string => {
  const check = criterion.check;
  switch (check.kind) {
    case 'metric_improvement':
      return `${criterion.statement} (check: ${check.metric} ${check.comparator} baseline${
        check.relativeThreshold === undefined
          ? ''
          : ` by at least ${Math.round(check.relativeThreshold * 100)} percent`
      })`;
    case 'metric_not_worse':
      return `${criterion.statement} (check: ${check.metric} within ${check.tolerance} of baseline)`;
    case 'scenario_passes':
      return `${criterion.statement} (check: scenario ${check.scenarioId} passes)`;
    // The rule explains the claim to a reader; the check retains the exact semantic finding handle.
    case 'finding_resolved':
      return `${criterion.statement} (check: absent after a rescan)`;
    case 'command_succeeds':
      return `${criterion.statement} (check: ${check.command.join(' ')} exits zero)`;
    case 'manual_review':
      return `${criterion.statement} (manual: ${check.instruction})`;
    default:
      return criterion.statement;
  }
};

/**
 * What the document says about the comparison, including when it prescribes none.
 *
 * A goal that named a baseline and then listed no `compare` command read as an omission. It is a
 * refusal: a comparison needs a run made after the change as well as one made before it, and nothing in
 * the plan produces the first unless a scenario is named. Saying which half is missing is what turns a
 * gap a reader has to notice into one the document states.
 */
/**
 * What the candidate is compared against, and under what conditions, or why nothing is.
 *
 * A comparison means something only when both sides reproduce the same work, so the conditions are stated
 * rather than left for a reader to recover from run identifiers. Where there is no comparable pair the
 * plan carries the question that failed, and it is printed as written: "no baseline run was recorded" sent
 * every reader after a run when what some of them needed was more repetitions of the one they had.
 */
const comparisonNote = (goal: Goal): string => {
  const baseline = goal.validation.baseline;
  if (baseline === undefined) {
    return goal.validation.comparisonUnavailable ?? 'no comparable baseline was recorded';
  }
  const conditions = [
    `scenario ${baseline.scenarioId}`,
    ...(baseline.variantId === undefined ? [] : [`variant ${baseline.variantId}`]),
    ...(baseline.faultPlanId === undefined
      ? ['no injected faults']
      : [`fault plan ${baseline.faultPlanId}`]),
  ].join(', ');
  const shortfall =
    baseline.samples >= MINIMUM_SAMPLES_PER_SIDE
      ? ''
      : `, which is below the ${MINIMUM_SAMPLES_PER_SIDE} a metric direction needs on each side, so only the criteria decided by presence are stated`;
  return `${goal.validation.baselineRunIds.join(', ')} (${conditions}, ${baseline.samples} ${baseline.samples === 1 ? 'sample' : 'samples'}${shortfall})`;
};

export const renderAgentPrompt = (goal: Goal): string =>
  [
    `Task ${goal.id}: ${goal.title}`,
    '',
    'Problem',
    goal.problemStatement,
    '',
    'Evidence',
    bullet(goal.evidenceSummary.map((entry) => `${entry.label}: ${entry.value} [${entry.basis}]`)),
    '',
    'Affected components',
    bullet(goal.affectedComponents),
    '',
    'Source locations',
    bullet(goal.sourceLocations.map((location) => `${location.file}:${location.startLine}`)),
    '',
    'You may change only these paths',
    bullet(goal.scope.allowedWritePaths),
    '',
    'You must not',
    bullet(goal.scope.prohibitedChanges),
    '',
    'These must stay true',
    bullet(goal.scope.invariants),
    '',
    'Acceptance criteria',
    bullet(goal.acceptanceCriteria.map((criterion) => criterionText(criterion))),
    '',
    'How the change is validated',
    bullet(
      goal.validation.commands.map((entry) => `${entry.command.join(' ')}  (${entry.purpose})`),
    ),
    `  compare against: ${comparisonNote(goal)}`,
    '',
    'If validation fails',
    `  ${goal.rollback}`,
    '',
    goal.scope.requiredApprovals.length === 0
      ? 'No approval is required before starting.'
      : `Approvals required before starting: ${goal.scope.requiredApprovals.join(', ')}.`,
    '',
    'Report what you changed, the command output for each validation command, and the measured values against the acceptance criteria. Do not claim an improvement that the comparison does not show.',
  ].join('\n');

export const renderGoalMarkdown = (goal: Goal): string =>
  [
    `# ${goal.id}: ${goal.title}`,
    '',
    `- Status: ${goal.status}`,
    `- Finding: ${goal.findingId}`,
    `- Risk: ${goal.risk}`,
    `- Created: ${goal.createdAt}`,
    goal.expectedImprovement === undefined
      ? ''
      : `- Expected improvement: ${goal.expectedImprovement}`,
    '',
    '## Problem',
    '',
    goal.problemStatement,
    '',
    '## Evidence',
    '',
    ...goal.evidenceSummary.map((entry) => `- ${entry.label}: ${entry.value} (${entry.basis})`),
    '',
    '## Affected components',
    '',
    ...goal.affectedComponents.map((component) => `- \`${component}\``),
    '',
    '## Source locations',
    '',
    ...goal.sourceLocations.map((location) => `- \`${location.file}:${location.startLine}\``),
    '',
    '## Scope',
    '',
    '### Allowed write paths',
    '',
    ...goal.scope.allowedWritePaths.map((path) => `- \`${path}\``),
    '',
    '### Prohibited changes',
    '',
    ...goal.scope.prohibitedChanges.map((entry) => `- ${entry}`),
    '',
    '### Invariants',
    '',
    ...goal.scope.invariants.map((entry) => `- ${entry}`),
    '',
    '## Acceptance criteria',
    '',
    ...goal.acceptanceCriteria.map(
      (criterion) => `- **${criterion.id}** ${criterionText(criterion)}`,
    ),
    '',
    '## Validation',
    '',
    ...goal.validation.commands.map((entry) => `- \`${entry.command.join(' ')}\` ${entry.purpose}`),
    '',
    `Repetitions: ${goal.validation.repetitions}. Baseline runs: ${comparisonNote(goal)}.`,
    '',
    '## Rollback',
    '',
    goal.rollback,
    '',
    ...(goal.validationResults.length === 0
      ? []
      : [
          '## Validation history',
          '',
          ...goal.validationResults.map(
            (entry) => `- ${entry.at}: ${entry.verdict} (${entry.comparisonId})`,
          ),
        ]),
  ]
    .filter((line) => line !== '')
    .join('\n')
    .concat('\n');

export const renderGoalSummary = (goal: Goal): string =>
  `${goal.id}  ${goal.status.padEnd(11)} ${goal.title}`;
