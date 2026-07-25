/**
 * Policy: the decisions about what Orchescope is allowed to do, kept as pure functions so they can be tested
 * exhaustively and so no subsystem can quietly decide for itself.
 */

export {
  allow,
  assertAllowed,
  type BudgetUsage,
  budgetDecision,
  chaosEnvironmentDecision,
  commandDecision,
  type Decision,
  deny,
  permissionDecision,
  permissionsDecision,
  writeActionDecision,
} from './decisions.ts';
