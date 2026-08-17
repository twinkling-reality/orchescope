/**
 * Finding generation: deterministic rules, severity policy bound to the strength of the evidence, and review
 * of anything a language model proposed.
 */

export { resolveByRuntimeName, taskLevelComponents } from './attribution.ts';
export { DEFAULT_RULES, type EngineResult, type EvaluateInput, evaluateRules } from './engine.ts';
export {
  linkConflicts,
  type ReviewInput,
  type ReviewOutcome,
  type ReviewVerdict,
  reviewModelFinding,
} from './review.ts';
export {
  clear,
  examined,
  type FindingDraft,
  fired,
  insufficient,
  notApplicable,
  type Rule,
  type RuleContext,
  type RuleOutcome,
  type RuleStatus,
  type RunEvidence,
} from './rule.ts';
export { EXPERIMENT_RULES } from './rules/experiments.ts';
export { RECONCILIATION_RULES } from './rules/reconciliation.ts';
export { RUNTIME_RULES } from './rules/runtime.ts';
export { STATIC_RULES } from './rules/static-policy.ts';
