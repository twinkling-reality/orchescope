/**
 * The improvement goal: creation from a finding, rendering for humans and agents, and evaluation of its
 * acceptance criteria against what was measured.
 */

export { type CreateGoalInput, createGoal } from './create.ts';
export { goalMatchesFinding, openGoalForFinding } from './existing-goal.ts';
export { renderAgentPrompt, renderGoalMarkdown, renderGoalSummary } from './render.ts';
export { type CriterionOutcome, type GoalValidation, validateGoal } from './validate-plan.ts';
