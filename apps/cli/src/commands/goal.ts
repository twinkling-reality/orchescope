import { writeFileSync } from 'node:fs';
import { stableJson } from '@orchescope/domain';
import { renderAgentPrompt, renderGoalMarkdown, renderGoalSummary } from '@orchescope/goals';
import { createGoalFromFinding, validateGoalOutcome } from '@orchescope/usecases';
import type { CommandContext } from '../context.ts';
import { EXIT_CODES } from '../exit.ts';
import { goalSummary } from '../terminal/summary.ts';

/**
 * Goal commands.
 *
 * `goal create` turns a finding into a bounded task. `goal show` prints it, or the agent prompt, or the markdown
 * document. `goal validate` judges the acceptance criteria against a comparison. The prompt is deliberately plain
 * text with no formatting, because it is meant to be pasted into another tool.
 */

export const goalCreateCommand = (
  context: CommandContext,
  findingId: string,
  options: { readonly repetitions?: string },
): number => {
  const goal = createGoalFromFinding({
    workspace: context.workspace,
    findingId,
    ...(options.repetitions === undefined
      ? {}
      : { repetitions: Number.parseInt(options.repetitions, 10) }),
  });
  if (context.json) {
    context.stdout(
      `${stableJson({
        ok: true,
        command: 'goal create',
        version: context.version,
        data: { goal, agentPrompt: renderAgentPrompt(goal) },
      })}\n`,
    );
  } else {
    context.stdout(`${goalSummary(context.style, goal)}\n`);
    context.stdout(
      `\n${context.style.dim('next:')} orchescope goal show ${goal.id} --prompt   ${context.style.dim('# the text to hand to a coding agent')}\n`,
    );
  }
  return EXIT_CODES.success;
};

export const goalShowCommand = (
  context: CommandContext,
  goalId: string,
  options: { readonly prompt?: boolean; readonly markdown?: boolean; readonly out?: string },
): number => {
  const goal = context.workspace.store.goalById(goalId);
  if (goal === undefined) {
    context.stderr(`${context.style.bad('error')} no goal ${goalId}\n`);
    return EXIT_CODES.user;
  }
  const rendered =
    options.prompt === true
      ? renderAgentPrompt(goal)
      : options.markdown === true
        ? renderGoalMarkdown(goal)
        : undefined;

  if (options.out !== undefined) {
    const contents = rendered ?? `${stableJson(goal)}\n`;
    writeFileSync(options.out, contents, { mode: 0o600 });
    if (!context.json) context.stdout(`${context.style.good('+')} wrote ${options.out}\n`);
    return EXIT_CODES.success;
  }

  if (context.json) {
    context.stdout(
      `${stableJson({
        ok: true,
        command: 'goal show',
        version: context.version,
        data: { goal, agentPrompt: renderAgentPrompt(goal) },
      })}\n`,
    );
    return EXIT_CODES.success;
  }
  context.stdout(
    rendered === undefined ? `${goalSummary(context.style, goal)}\n` : `${rendered}\n`,
  );
  return EXIT_CODES.success;
};

export const goalListCommand = (
  context: CommandContext,
  options: { readonly status?: string },
): number => {
  const goals = context.workspace.store.listGoals(context.workspace.projectId, options.status);
  if (context.json) {
    context.stdout(
      `${stableJson({ ok: true, command: 'goals list', version: context.version, data: goals })}\n`,
    );
    return EXIT_CODES.success;
  }
  if (goals.length === 0) {
    context.stdout(
      `${context.style.dim('no goals yet. Create one from a finding: orchescope goal create <finding id>')}\n`,
    );
    return EXIT_CODES.success;
  }
  for (const goal of goals) context.stdout(`${renderGoalSummary(goal)}\n`);
  return EXIT_CODES.success;
};

/**
 * A criterion is satisfied, refused, or undecided. The third state is not a failure: it means the evidence needed to
 * judge it was not there, and a marker that made it look decided either way would be a false report.
 */
const criterionMarker = (
  context: CommandContext,
  result: { readonly satisfied: boolean; readonly decided: boolean },
): string => {
  if (result.satisfied) return context.style.good('+');
  return result.decided ? context.style.bad('x') : context.style.dim('.');
};

const writeValidationText = (
  context: CommandContext,
  outcome: ReturnType<typeof validateGoalOutcome>,
): void => {
  context.stdout(`\n${context.style.bold(outcome.goal.id)} ${outcome.validation.summary}\n`);
  for (const result of outcome.validation.outcomes) {
    context.stdout(
      `  ${criterionMarker(context, result)} ${result.criterion.id} ${result.criterion.statement}\n`,
    );
    context.stdout(context.style.dim(`      ${result.detail}\n`));
  }
};

export const goalValidateCommand = (
  context: CommandContext,
  goalId: string,
  options: { readonly comparison?: string },
): number => {
  const comparison =
    options.comparison === undefined
      ? undefined
      : context.workspace.store.comparisonById(options.comparison);
  if (options.comparison !== undefined && comparison === undefined) {
    context.stderr(`${context.style.bad('error')} no comparison ${options.comparison}\n`);
    return EXIT_CODES.user;
  }
  const outcome = validateGoalOutcome({
    workspace: context.workspace,
    goalId,
    ...(comparison === undefined ? {} : { comparison }),
  });

  if (context.json) {
    context.stdout(
      `${stableJson({
        ok: true,
        command: 'goal validate',
        version: context.version,
        data: { goal: outcome.goal, validation: outcome.validation },
      })}\n`,
    );
  } else {
    writeValidationText(context, outcome);
  }
  return outcome.validation.validated ? EXIT_CODES.success : EXIT_CODES.findings;
};
