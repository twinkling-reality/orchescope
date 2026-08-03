/**
 * Scenarios and their runs. A skipped evaluator is shown as skipped with its reason rather than as a
 * pass, because an evaluator that did not run has not agreed with anything.
 *
 * One scenario is one bento. The band says what the scenario is, the anchor holds its runs or the
 * refusal that it has never had one, the stage holds the definition, and the stack holds what the
 * scenario is allowed to do and what decides whether a run of it passed. A scenario defined and never
 * run is a state no other report in the cache reaches, and it is the one this arrangement is built
 * around: the absence belongs on the anchor rather than three screens down.
 */

import type { Scenario, ScenarioRunSummary } from '@orchescope/schema';
import { scenarioRunCommand } from '../commands.ts';
import { formatArgv, formatDuration, formatInteger, humanise } from '../format.ts';
import { useApp } from '../store.tsx';
import { EvaluatorResults } from '../ui/evaluators.tsx';
import {
  Data,
  DefinitionList,
  type DefinitionRow,
  Eyebrow,
  Meta,
  RefusalPanel,
} from '../ui/primitives.tsx';

function evaluatorSummary(scenario: Scenario): string {
  if (scenario.evaluators.length === 0) {
    return 'none declared, so nothing decides whether a run of it passed';
  }
  return scenario.evaluators.map((evaluator) => evaluator.kind).join(', ');
}

function budgetSummary(scenario: Scenario): string {
  const parts = Object.entries(scenario.budgets)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${humanise(key)} ${String(value)}`);
  return parts.length === 0 ? 'none set' : parts.join(', ');
}

function faultSummary(scenario: Scenario): string {
  if (scenario.faults.length === 0) {
    return 'none';
  }
  return scenario.faults.map((fault) => `${humanise(fault.kind)} into ${fault.target}`).join('; ');
}

/** The identifier and the command are on the band above, so they are not repeated here. */
function definitionRows(scenario: Scenario): readonly DefinitionRow[] {
  return [
    { label: 'Result source', value: humanise(scenario.target.resultSource) },
    { label: 'Timeout', value: formatDuration(scenario.target.timeoutMs) },
    {
      label: 'Repetitions',
      value: scenario.repetitions === undefined ? 'one' : formatInteger(scenario.repetitions),
    },
    { label: 'Seed', value: scenario.seed === undefined ? 'not fixed' : String(scenario.seed) },
    ...(scenario.tags.length === 0 ? [] : [{ label: 'Tags', value: scenario.tags.join(', ') }]),
  ];
}

function boundaryRows(scenario: Scenario): readonly DefinitionRow[] {
  return [
    {
      label: 'Permissions it requires',
      value:
        scenario.requiredPermissions.length === 0
          ? 'none'
          : scenario.requiredPermissions.join(', '),
      code: scenario.requiredPermissions.length > 0,
    },
    { label: 'Budgets', value: budgetSummary(scenario) },
    { label: 'Declared faults', value: faultSummary(scenario) },
  ];
}

function ScenarioRunCard(props: { readonly run: ScenarioRunSummary }) {
  const { run } = props;
  return (
    <div class="run-card">
      <Meta>
        <span>{run.runId}</span>
        <span>{humanise(run.status)}</span>
        <span>
          {run.taskSuccess === undefined
            ? 'task outcome not reported'
            : run.taskSuccess
              ? 'task succeeded'
              : 'task failed'}
        </span>
        <span>{formatDuration(run.durationMs)}</span>
        {run.variantId === undefined ? null : <span>{`variant ${run.variantId}`}</span>}
      </Meta>
      {run.faultsApplied.length === 0 ? null : (
        <p class="note">{`Faults applied: ${run.faultsApplied.join(', ')}`}</p>
      )}
      <EvaluatorResults
        results={run.evaluators}
        emptyMessage="No evaluator result was recorded for this run, so nothing judged it."
      />
    </div>
  );
}

function ScenarioCard(props: { readonly scenario: Scenario }) {
  const app = useApp();
  const { scenario } = props;
  const runs = app.bundle.scenarioRuns.filter((run) => run.scenarioId === scenario.id);
  return (
    <div class="bento">
      <section class="tile is-band">
        <Eyebrow>Scenario</Eyebrow>
        <h3>{scenario.name}</h3>
        <div class="lead-head is-prose">
          <div>
            {scenario.description === undefined ? (
              <p class="note">This scenario carries no description.</p>
            ) : (
              <p class="lede">{scenario.description}</p>
            )}
          </div>
          <div class="lead-measure">
            <DefinitionList
              rows={[
                { label: 'Identifier', value: scenario.id, code: true },
                { label: 'Command', value: formatArgv(scenario.target.command), code: true },
                {
                  label: 'Runs recorded',
                  value: <Data nil={runs.length === 0}>{formatInteger(runs.length)}</Data>,
                },
                {
                  label: 'Evaluators',
                  value: (
                    <Data nil={scenario.evaluators.length === 0}>
                      {formatInteger(scenario.evaluators.length)}
                    </Data>
                  ),
                },
              ]}
            />
          </div>
        </div>
      </section>

      <section class="tile is-anchor">
        <div class="tile-head">
          <Eyebrow level={3} count={runs.length}>
            Runs of this scenario
          </Eyebrow>
        </div>
        <div class="tile-body">
          {runs.length === 0 ? (
            <RefusalPanel
              title="This scenario has never been run in this report."
              commands={[scenarioRunCommand(scenario.id)]}
            >
              <p>
                It is defined and nothing has executed it, so its evaluators have decided nothing
                about this system.
              </p>
            </RefusalPanel>
          ) : (
            runs.map((run) => <ScenarioRunCard key={run.runId} run={run} />)
          )}
        </div>
      </section>

      <section class="tile is-stage">
        <div class="tile-head">
          <Eyebrow level={3}>How it runs</Eyebrow>
        </div>
        <div class="tile-body">
          <DefinitionList rows={definitionRows(scenario)} />
        </div>
      </section>

      <div class="tile-stack">
        <section class="tile">
          <div class="tile-head">
            <Eyebrow level={3} count={scenario.evaluators.length}>
              What decides a pass
            </Eyebrow>
          </div>
          <div class="tile-body">
            <p class="lede">{evaluatorSummary(scenario)}</p>
          </div>
        </section>
        <section class="tile">
          <div class="tile-head">
            <Eyebrow level={3}>What it is allowed to do</Eyebrow>
          </div>
          <div class="tile-body">
            <DefinitionList rows={boundaryRows(scenario)} />
          </div>
        </section>
      </div>
    </div>
  );
}

export function ScenariosSection() {
  const app = useApp();
  const { scenarios, scenarioRuns } = app.bundle;

  if (scenarios.length === 0 && scenarioRuns.length === 0) {
    return (
      <div class="bento">
        <section class="tile is-band">
          <Eyebrow level={3}>Scenarios</Eyebrow>
          <RefusalPanel
            title="No scenario is defined, so there is nothing to rerun, benchmark or inject faults into."
            commands={[scenarioRunCommand(null)]}
          >
            <p>
              A scenario says how to run the target system once, what to vary, and what must be true
              afterwards. Without one, a change cannot be verified by rerunning the same thing,
              which is the whole of the loop this product is built around.
            </p>
          </RefusalPanel>
        </section>
      </div>
    );
  }

  const orphanRuns = scenarioRuns.filter(
    (run) => !scenarios.some((scenario) => scenario.id === run.scenarioId),
  );

  return (
    <>
      {scenarios.map((scenario) => (
        <ScenarioCard key={scenario.id} scenario={scenario} />
      ))}
      {orphanRuns.length === 0 ? null : (
        <div class="bento">
          <section class="tile">
            <Eyebrow level={3} count={orphanRuns.length}>
              Runs whose scenario is not in this bundle
            </Eyebrow>
            <p class="lede">Kept rather than dropped, so a run is never silently lost.</p>
            <ul class="plain small">
              {orphanRuns.map((run) => (
                <li key={run.runId}>
                  <span class="mono">{`${run.runId} ${run.scenarioId}`}</span>
                  <span class="muted">{` ${run.scenarioName}, ${humanise(run.status)}`}</span>
                  <Data>{` ${formatDuration(run.durationMs)}`}</Data>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </>
  );
}
