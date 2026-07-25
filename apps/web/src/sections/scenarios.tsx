/**
 * Scenarios and their runs. A skipped evaluator is shown as skipped with its reason rather than as a
 * pass, because an evaluator that did not run has not agreed with anything.
 */

import type { Scenario, ScenarioRunSummary } from '@orchescope/schema';
import { scenarioRunCommand } from '../commands.ts';
import { formatArgv, formatDuration, formatInteger, humanise } from '../format.ts';
import { useApp } from '../store.tsx';
import {
  Chip,
  DefinitionList,
  type DefinitionRow,
  EmptyState,
  SectionHeading,
} from '../ui/atoms.tsx';
import { EvaluatorResults } from '../ui/evaluators.tsx';

function evaluatorSummary(scenario: Scenario): string {
  if (scenario.evaluators.length === 0) {
    return 'no evaluator declared, so nothing decides whether a run of it passed';
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

function scenarioRows(scenario: Scenario): readonly DefinitionRow[] {
  return [
    { label: 'Identifier', value: scenario.id, code: true },
    { label: 'Command', value: formatArgv(scenario.target.command), code: true },
    { label: 'Result source', value: humanise(scenario.target.resultSource) },
    { label: 'Timeout', value: formatDuration(scenario.target.timeoutMs) },
    {
      label: 'Repetitions',
      value: scenario.repetitions === undefined ? 'one' : formatInteger(scenario.repetitions),
    },
    { label: 'Seed', value: scenario.seed === undefined ? 'not fixed' : String(scenario.seed) },
    { label: 'Evaluators', value: evaluatorSummary(scenario) },
    { label: 'Declared faults', value: faultSummary(scenario) },
    {
      label: 'Permissions it requires',
      value:
        scenario.requiredPermissions.length === 0
          ? 'none'
          : scenario.requiredPermissions.join(', '),
      code: scenario.requiredPermissions.length > 0,
    },
    { label: 'Budgets', value: budgetSummary(scenario) },
    ...(scenario.tags.length === 0 ? [] : [{ label: 'Tags', value: scenario.tags.join(', ') }]),
  ];
}

function statusTone(status: string): 'good' | 'warn' | 'bad' | 'neutral' {
  if (status === 'completed') {
    return 'good';
  }
  if (status === 'running') {
    return 'neutral';
  }
  return 'bad';
}

function TaskOutcomeChip(props: { readonly taskSuccess: boolean | undefined }) {
  if (props.taskSuccess === undefined) {
    return <Chip label="task outcome not reported" tone="warn" />;
  }
  return (
    <Chip
      label={props.taskSuccess ? 'task succeeded' : 'task failed'}
      tone={props.taskSuccess ? 'good' : 'bad'}
    />
  );
}

function ScenarioRunCard(props: { readonly run: ScenarioRunSummary }) {
  const { run } = props;
  return (
    <div class="run-card">
      <div class="chip-row">
        <span class="mono">{run.runId}</span>
        <Chip label={humanise(run.status)} tone={statusTone(run.status)} />
        <TaskOutcomeChip taskSuccess={run.taskSuccess} />
        <span class="muted">{formatDuration(run.durationMs)}</span>
        {run.variantId === undefined ? null : <Chip label={`variant ${run.variantId}`} />}
      </div>
      {run.faultsApplied.length === 0 ? null : (
        <p class="muted">{`Faults applied: ${run.faultsApplied.join(', ')}`}</p>
      )}
      <EvaluatorResults
        results={run.evaluators}
        emptyMessage="No evaluator result was recorded for this run."
      />
    </div>
  );
}

function ScenarioCard(props: { readonly scenario: Scenario }) {
  const app = useApp();
  const { scenario } = props;
  const runs = app.bundle.scenarioRuns.filter((run) => run.scenarioId === scenario.id);
  return (
    <section class="panel">
      <SectionHeading
        title={scenario.name}
        {...(scenario.description === undefined ? {} : { note: scenario.description })}
      />
      <DefinitionList rows={scenarioRows(scenario)} />
      <div class="subpanel">
        <SectionHeading title="Runs of this scenario" count={runs.length} />
        {runs.length === 0 ? (
          <p class="muted">This scenario has never been run in this report.</p>
        ) : (
          runs.map((run) => <ScenarioRunCard key={run.runId} run={run} />)
        )}
      </div>
    </section>
  );
}

export function ScenariosSection() {
  const app = useApp();
  const { scenarios, scenarioRuns } = app.bundle;

  if (scenarios.length === 0 && scenarioRuns.length === 0) {
    return (
      <div class="section">
        <section class="panel">
          <EmptyState
            title="No scenarios are defined"
            body="A scenario says how to run the target system once, what to vary, and what must be true afterwards. Without one there is nothing to rerun, benchmark or inject faults into."
            commands={[scenarioRunCommand(null)]}
          />
        </section>
      </div>
    );
  }

  const orphanRuns = scenarioRuns.filter(
    (run) => !scenarios.some((scenario) => scenario.id === run.scenarioId),
  );

  return (
    <div class="section">
      {scenarios.map((scenario) => (
        <ScenarioCard key={scenario.id} scenario={scenario} />
      ))}
      {orphanRuns.length === 0 ? null : (
        <section class="panel">
          <SectionHeading
            title="Runs whose scenario is not in this bundle"
            count={orphanRuns.length}
            note="Kept rather than dropped, so a run is never silently lost."
          />
          <ul class="plain">
            {orphanRuns.map((run) => (
              <li key={run.runId}>
                <span class="mono">{`${run.runId} ${run.scenarioId}`}</span>
                <span class="muted">{` ${run.scenarioName}, ${humanise(run.status)}`}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
