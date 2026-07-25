import { faultPlanId, OrchescopeError } from '@orchescope/domain';
import type { ChaosEnvironment, FaultPlan, FaultSpec, Scenario } from '@orchescope/schema';

/**
 * Fault plans and the gate in front of them.
 *
 * A plan carries one seed and the faults it applies. The identifier is derived from both, so the same plan
 * always has the same identifier and a report can be traced back to exactly what was injected.
 *
 * A suite runs one plan per fault. Combining faults would produce an outcome nobody can attribute: when a
 * task fails under three simultaneous faults, the report cannot say which one the system could not absorb.
 */

const LIVE_REMEDIATION =
  'A live chaos run injects faults into real dependencies. Add "live" to policy.allowedChaosEnvironments only with the owner of the system that will receive them.';

export const assertEnvironmentAllowed = (
  environment: ChaosEnvironment,
  allowed: readonly ChaosEnvironment[],
): void => {
  if (allowed.includes(environment)) return;
  throw new OrchescopeError(
    'POLICY_DENIED',
    `A chaos run in the ${environment} environment is not allowed by the current policy.`,
    {
      detail: { environment, allowed: allowed.join(', ') || 'none' },
      remediation:
        environment === 'live'
          ? LIVE_REMEDIATION
          : `Add "${environment}" to policy.allowedChaosEnvironments if you intend to allow it.`,
    },
  );
};

export const buildFaultPlan = (input: {
  readonly faults: readonly FaultSpec[];
  readonly seed: number;
}): FaultPlan => {
  if (input.faults.length === 0) {
    throw new OrchescopeError('INVALID_ARGUMENT', 'A fault plan needs at least one fault.', {
      remediation: 'Declare the faults to inject under `faults` in the scenario.',
    });
  }
  if (!Number.isInteger(input.seed) || input.seed < 0) {
    throw new OrchescopeError('INVALID_ARGUMENT', 'A fault plan seed is a non negative integer.', {
      detail: { seed: input.seed },
      remediation: 'Pass a whole number seed so the plan is reproducible.',
    });
  }
  const faults = [...input.faults];
  return { id: faultPlanId({ seed: input.seed, faults }), seed: input.seed, faults };
};

/**
 * One plan per declared fault, all sharing the seed. Sharing the seed keeps every plan deterministic and
 * makes the plans comparable: each one places its fault where that seed says, run after run.
 */
export const singleFaultPlans = (
  scenario: Scenario,
  seed: number,
): readonly { readonly fault: FaultSpec; readonly plan: FaultPlan }[] =>
  scenario.faults.map((fault) => ({ fault, plan: buildFaultPlan({ faults: [fault], seed }) }));
