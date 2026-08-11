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
import { scenarioRunCommand } from '../presentation/commands.ts';
import { formatArgv, formatDuration, formatInteger, humanise } from '../presentation/format.ts';
import { orderScenariosForVerification } from '../presentation/scenario-order.ts';
import { buildSectionPresentations } from '../presentation/section-presentation.ts';
import { useApp } from '../store.tsx';
import { EvaluatorResults } from '../ui/evaluators.tsx';
import {
  Data,
  DefinitionList,
  type DefinitionRow,
  Eyebrow,
  Meta,
  RefusalPanel,
  RuledStat,
  StatRow,
} from '../ui/primitives.tsx';
import { SectionSkeleton } from '../ui/section-skeleton.tsx';

function evaluatorSummary(scenario: Scenario): string {
  if (scenario.evaluators.length === 0) {
    return 'nothing, so no run of it can pass or fail';
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
    { label: 'Where the answer comes from', value: humanise(scenario.target.resultSource) },
    { label: 'Gives up after', value: formatDuration(scenario.target.timeoutMs) },
    {
      label: 'How many times it repeats',
      value: scenario.repetitions === undefined ? 'once' : formatInteger(scenario.repetitions),
    },
    {
      label: 'Random seed',
      value: scenario.seed === undefined ? 'not fixed, so it may vary' : String(scenario.seed),
    },
    ...(scenario.tags.length === 0 ? [] : [{ label: 'Tags', value: scenario.tags.join(', ') }]),
  ];
}

function boundaryRows(scenario: Scenario): readonly DefinitionRow[] {
  return [
    {
      label: 'What it is allowed to reach',
      value:
        scenario.requiredPermissions.length === 0
          ? 'none'
          : scenario.requiredPermissions.join(', '),
      code: scenario.requiredPermissions.length > 0,
    },
    { label: 'Limits it must stay inside', value: budgetSummary(scenario) },
    { label: 'What it breaks on purpose', value: faultSummary(scenario) },
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
            ? 'nobody reported whether the task worked'
            : run.taskSuccess
              ? 'the task worked'
              : 'the task failed'}
        </span>
        <span>{formatDuration(run.durationMs)}</span>
        {run.variantId === undefined ? null : <span>{`variant ${run.variantId}`}</span>}
      </Meta>
      {run.faultsApplied.length === 0 ? null : (
        <p class="note">{`Broken on purpose: ${run.faultsApplied.join(', ')}`}</p>
      )}
      <EvaluatorResults
        results={run.evaluators}
        emptyMessage="Nothing checked this run, so nothing decided whether it worked."
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
      <section class="tile">
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
                { label: 'Its name in the tool', value: scenario.id, code: true },
                { label: 'What it runs', value: formatArgv(scenario.target.command), code: true },
                {
                  label: 'Times it has been run',
                  value: <Data nil={runs.length === 0}>{formatInteger(runs.length)}</Data>,
                },
                {
                  label: 'Checks that decide it',
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
            Every time it has been run
          </Eyebrow>
        </div>
        <div class="tile-body">
          {runs.length === 0 ? (
            <RefusalPanel
              title="Nothing has ever run this."
              commands={[scenarioRunCommand(scenario.id)]}
            >
              <p>
                It is written down and nothing has ever executed it, so its checks have decided
                nothing about this system.
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
              What decides whether it passed
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

  const presentation = buildSectionPresentations(app.bundle).scenarios;
  const orphanRuns = scenarioRuns.filter(
    (run) => !scenarios.some((scenario) => scenario.id === run.scenarioId),
  );
  const runnableCount = scenarios.filter((scenario) =>
    scenarioRuns.some((run) => run.scenarioId === scenario.id),
  ).length;

  return (
    <SectionSkeleton
      section="scenarios"
      summary={
        <section class="tile is-band section-lead">
          <h3 class="section-lead-question">What can be rerun to verify a change</h3>
          {presentation.summaryRefusal === null ? (
            <div class="section-lead-body">
              {/* A scenario that has never run cannot verify anything yet, so that is the number the
                  screen leads with rather than how many are defined. */}
              <p class="section-lead-answer">
                <span class="section-lead-figure">{formatInteger(runnableCount)}</span>
                <span>
                  {` of ${formatInteger(scenarios.length)} ${scenarios.length === 1 ? 'scenario' : 'scenarios'} ${runnableCount === 1 ? 'has' : 'have'} actually been run, so ${runnableCount === 0 ? 'none of them can decide anything yet' : 'they can be run again and compared against what happens next time'}.`}
                </span>
              </p>
              <div class="section-lead-aside">
                <StatRow>
                  <RuledStat
                    value={formatInteger(scenarioRuns.length)}
                    label="Runs recorded"
                    basis="observed"
                    nil={scenarioRuns.length === 0}
                  />
                  <RuledStat
                    value={formatInteger(scenarios.length - runnableCount)}
                    label="Never run"
                    basis="discovered"
                    nil={scenarios.length - runnableCount === 0}
                  />
                </StatRow>
              </div>
            </div>
          ) : (
            <RefusalPanel
              title={presentation.summaryRefusal.title}
              commands={presentation.summaryRefusal.commands}
            >
              <p>{presentation.summaryRefusal.reason}</p>
            </RefusalPanel>
          )}
        </section>
      }
      primary={
        presentation.primaryRefusal === null ? (
          orderScenariosForVerification(scenarios, scenarioRuns).map((scenario) => (
            <ScenarioCard key={scenario.id} scenario={scenario} />
          ))
        ) : (
          <section class="tile">
            <Eyebrow level={3}>What can be rerun</Eyebrow>
            <RefusalPanel
              title={presentation.primaryRefusal.title}
              commands={presentation.primaryRefusal.commands}
            >
              <p>{presentation.primaryRefusal.reason}</p>
            </RefusalPanel>
          </section>
        )
      }
      detail={
        <section class="tile">
          <Eyebrow level={3} count={orphanRuns.length}>
            Runs with no scenario to belong to
          </Eyebrow>
          {presentation.detailRefusal !== null ? (
            <RefusalPanel
              title={presentation.detailRefusal.title}
              commands={presentation.detailRefusal.commands}
            >
              <p>{presentation.detailRefusal.reason}</p>
            </RefusalPanel>
          ) : orphanRuns.length === 0 ? (
            <p class="lede">Every run here belongs to a scenario in this report.</p>
          ) : (
            <>
              <p class="lede">Kept rather than dropped, so no run is ever quietly lost.</p>
              <ul class="plain small">
                {orphanRuns.map((run) => (
                  <li key={run.runId}>
                    <span class="mono">{`${run.runId} ${run.scenarioId}`}</span>
                    <span class="muted">{` ${run.scenarioName}, ${humanise(run.status)}`}</span>
                    <Data>{` ${formatDuration(run.durationMs)}`}</Data>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      }
    />
  );
}
