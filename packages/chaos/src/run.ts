import { type Clock, chaosReportId, OrchescopeError } from '@orchescope/domain';
import {
  type ChaosEnvironment,
  type ChaosOutcome,
  type ChaosReport,
  type FaultPlan,
  SCHEMA_VERSIONS,
  type Scenario,
  type ScenarioResult,
} from '@orchescope/schema';
import { chaosOutcome, NOT_APPLIED_REASON } from './outcome.ts';
import { assertEnvironmentAllowed, singleFaultPlans } from './plan.ts';

/**
 * A chaos suite.
 *
 * The baseline runs first and its run identifier is kept on the report, because every amplification number is
 * a ratio against that run and a ratio without its denominator cannot be checked. Each declared fault then
 * runs in a plan of its own, so an outcome belongs to exactly one fault.
 */

export type RunChaosInput = {
  readonly scenario: Scenario;
  readonly environment: ChaosEnvironment;
  readonly allowedEnvironments: readonly ChaosEnvironment[];
  readonly seed: number;
  readonly repetitions: number;
  readonly runBaseline: () => Promise<ScenarioResult>;
  readonly runWithPlan: (plan: FaultPlan, repetitions: number) => Promise<ScenarioResult>;
  readonly clock: Clock;
};

const assertRepetitions = (repetitions: number): void => {
  if (!Number.isInteger(repetitions) || repetitions < 1) {
    throw new OrchescopeError(
      'INVALID_ARGUMENT',
      'A chaos run needs at least one repetition per fault.',
      {
        detail: { repetitions },
        remediation: 'Pass a positive integer repetition count.',
      },
    );
  }
};

export const runChaosSuite = async (input: RunChaosInput): Promise<ChaosReport> => {
  assertEnvironmentAllowed(input.environment, input.allowedEnvironments);
  assertRepetitions(input.repetitions);

  const startedAt = input.clock.now();
  const baseline = await input.runBaseline();
  const baselineRunId = baseline.repetitions[0]?.runId;
  if (baselineRunId === undefined) {
    throw new OrchescopeError(
      'INVALID_STATE',
      'The baseline run reported no repetitions, so there is nothing to compare a fault run against.',
    );
  }

  const outcomes: ChaosOutcome[] = [];
  const notApplied: ChaosReport['notApplied'] = [];
  for (const entry of singleFaultPlans(input.scenario, input.seed)) {
    const result = await input.runWithPlan(entry.plan, input.repetitions);
    const outcome = chaosOutcome({ fault: entry.fault, baseline, result });
    if (outcome === undefined) {
      notApplied.push({
        faultKind: entry.fault.kind,
        target: entry.fault.target,
        reason: NOT_APPLIED_REASON,
      });
      continue;
    }
    outcomes.push(outcome);
  }

  return {
    schemaVersion: SCHEMA_VERSIONS.chaos,
    id: chaosReportId({ scenarioId: input.scenario.id, startedAt }),
    scenarioId: input.scenario.id,
    environment: input.environment,
    startedAt,
    finishedAt: input.clock.now(),
    baselineRunId,
    outcomes,
    notApplied,
    metadata: { seed: input.seed, repetitionsPerFault: input.repetitions },
  };
};
