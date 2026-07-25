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
    case 'finding_resolved':
      return `${criterion.statement} (check: ${check.findingId} absent after a rescan)`;
    case 'command_succeeds':
      return `${criterion.statement} (check: ${check.command.join(' ')} exits zero)`;
    case 'manual_review':
      return `${criterion.statement} (manual: ${check.instruction})`;
    default:
      return criterion.statement;
  }
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
    bullet(goal.validation.commands.map((entry) => `${entry.command.join(' ')}  (${entry.purpose})`)),
    goal.validation.baselineRunIds.length === 0
      ? '  compare against: no baseline run was recorded'
      : `  compare against: ${goal.validation.baselineRunIds.join(', ')}`,
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
    goal.expectedImprovement === undefined ? '' : `- Expected improvement: ${goal.expectedImprovement}`,
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
    ...goal.acceptanceCriteria.map((criterion) => `- **${criterion.id}** ${criterionText(criterion)}`),
    '',
    '## Validation',
    '',
    ...goal.validation.commands.map((entry) => `- \`${entry.command.join(' ')}\` ${entry.purpose}`),
    '',
    `Repetitions: ${goal.validation.repetitions}. Baseline runs: ${
      goal.validation.baselineRunIds.length === 0 ? 'none recorded' : goal.validation.baselineRunIds.join(', ')
    }.`,
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
          ...goal.validationResults.map((entry) => `- ${entry.at}: ${entry.verdict} (${entry.comparisonId})`),
        ]),
  ]
    .filter((line) => line !== '')
    .join('\n')
    .concat('\n');

export const renderGoalSummary = (goal: Goal): string =>
  `${goal.id}  ${goal.status.padEnd(11)} ${goal.title}`;
