import type { Scenario, ScenarioVariant } from '@orchescope/schema';
import { TARGET_ENV } from '@orchescope/schema';

/**
 * Environment mapping.
 *
 * Every dimension a scenario can vary reaches the target as one documented `ORCHESCOPE_*` variable, so a
 * target honours the variables it recognises and ignores the rest without ever linking to Orchescope.
 *
 * Seeds are derived as `scenario.seed + repetition`. The run as a whole stays reproducible from the
 * scenario seed while two repetitions still take different random paths, which is what makes a reliability
 * estimate across repetitions mean anything.
 *
 * Precedence, weakest first: the derived variables, then `target.env`, then `variant.env`. An author who
 * sets a variable explicitly wins over the derived value, and the variant wins over the target.
 */

const numeric = (key: string, value: number | undefined): Record<string, string> =>
  value === undefined ? {} : { [key]: String(value) };

const text = (key: string, value: string | undefined): Record<string, string> =>
  value === undefined ? {} : { [key]: value };

/**
 * `ORCHESCOPE_INPUT` carries the prompt when the scenario has one, and the JSON encoding of `input.data`
 * otherwise. A scenario that needs both a prompt and structured input puts the structured part in
 * `initialState`, which has its own variable.
 */
const inputValue = (scenario: Scenario): string | undefined => {
  const input = scenario.input;
  if (input?.prompt !== undefined) return input.prompt;
  return input?.data === undefined ? undefined : JSON.stringify(input.data);
};

export const scenarioEnv = (
  scenario: Scenario,
  variant: ScenarioVariant | undefined,
  repetition: number,
): Readonly<Record<string, string>> => ({
  [TARGET_ENV.scenarioId]: scenario.id,
  [TARGET_ENV.seed]: String((scenario.seed ?? 1) + repetition),
  ...numeric(TARGET_ENV.agents, variant?.agents),
  ...numeric(TARGET_ENV.workers, variant?.workers),
  ...numeric(TARGET_ENV.concurrency, variant?.concurrency),
  ...text(TARGET_ENV.topology, variant?.topology),
  ...text(TARGET_ENV.promptVersion, variant?.promptVersion),
  ...text(TARGET_ENV.toolConfig, variant?.toolConfig),
  ...text(TARGET_ENV.modelProvider, variant?.model?.provider),
  ...text(TARGET_ENV.model, variant?.model?.model),
  ...text(TARGET_ENV.input, inputValue(scenario)),
  ...text(
    TARGET_ENV.initialState,
    scenario.initialState === undefined ? undefined : JSON.stringify(scenario.initialState),
  ),
  ...(scenario.target.env ?? {}),
  ...(variant?.env ?? {}),
});
