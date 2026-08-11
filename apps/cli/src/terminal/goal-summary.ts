import type { Goal } from '@orchescope/schema';
import type { Style } from './style.ts';

/**
 * What `orchescope goal create` and `goal show` report.
 *
 * A goal is the bounded job this product hands to a person or a coding agent, so the summary states the
 * criteria, the command that decides them and the paths a change may touch. A goal with no baseline run
 * says so rather than leaving a metric criterion looking judgeable.
 */
export const goalSummary = (style: Style, goal: Goal): string =>
  [
    '',
    `${style.bold(goal.id)}  ${goal.title}`,
    style.dim(`  from finding ${goal.findingId}, risk ${goal.risk}, status ${goal.status}`),
    '',
    style.bold('  Acceptance criteria'),
    ...goal.acceptanceCriteria.map((criterion) => `    ${criterion.id} ${criterion.statement}`),
    '',
    style.bold('  Validation'),
    ...goal.validation.commands.map((entry) => `    ${entry.command.join(' ')}`),
    goal.validation.baselineRunIds.length === 0
      ? style.dim('    no baseline run recorded, so metric criteria cannot be judged yet')
      : style.dim(`    baseline: ${goal.validation.baselineRunIds.join(', ')}`),
    '',
    style.bold('  Allowed write paths'),
    ...goal.scope.allowedWritePaths.map((path) => `    ${path}`),
  ].join('\n');
