/**
 * Policy: the decisions about what Orchescope is allowed to do, kept as pure functions so they can be tested
 * exhaustively and so no subsystem can quietly decide for itself.
 */

export {
  type BudgetUsage,
  type Decision,
  allow,
  assertAllowed,
  budgetDecision,
  chaosEnvironmentDecision,
  commandDecision,
  deny,
  permissionDecision,
  permissionsDecision,
  semanticAnalysisDecision,
  writeActionDecision,
} from './decisions.ts';
