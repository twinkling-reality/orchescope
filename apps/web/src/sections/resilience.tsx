/**
 * Resilience. One block per injected fault, with the faults that were requested and not applied kept
 * visible: a chaos suite that quietly skipped half its plan and reported success is worse than no suite.
 */

import type { ChaosOutcome, ChaosReport } from '@orchescope/schema';
import { chaosCommand } from '../commands.ts';
import {
  formatDuration,
  formatInteger,
  formatNumber,
  formatTimestamp,
  humanise,
} from '../format.ts';
import { useApp } from '../store.tsx';
import {
  BooleanValue,
  Callout,
  Chip,
  DefinitionList,
  type DefinitionRow,
  EmptyState,
  OptionalNumber,
  SectionHeading,
} from '../ui/atoms.tsx';
import { EvaluatorResults } from '../ui/evaluators.tsx';

function outcomeRows(outcome: ChaosOutcome): readonly DefinitionRow[] {
  return [
    {
      label: 'Recovery time',
      value: <OptionalNumber value={outcome.recoveryTimeMs ?? null} render={formatDuration} />,
    },
    {
      label: 'Cost amplification',
      value: (
        <OptionalNumber
          value={outcome.costAmplification ?? null}
          render={(value) => `${formatNumber(value)}× the baseline token spend`}
        />
      ),
    },
    {
      label: 'Retry amplification',
      value: (
        <OptionalNumber
          value={outcome.retryAmplification ?? null}
          render={(value) => `${formatNumber(value)}× the baseline retries`}
        />
      ),
    },
    { label: 'Duplicate side effects', value: formatInteger(outcome.duplicateSideEffects) },
    { label: 'Prohibited side effects', value: formatInteger(outcome.prohibitedSideEffects) },
    { label: 'User interventions', value: formatInteger(outcome.userInterventions) },
    { label: 'Loop iterations', value: formatInteger(outcome.loopIterations) },
    { label: 'Policy violations', value: formatInteger(outcome.policyViolations) },
  ];
}

function FaultOutcome(props: { readonly outcome: ChaosOutcome }) {
  const { outcome } = props;
  const unsafeEffects = outcome.duplicateSideEffects > 0 || outcome.prohibitedSideEffects > 0;
  return (
    <div class="subpanel">
      <SectionHeading
        title={`${humanise(outcome.faultKind)} into ${outcome.target}`}
        note={`Applied ${formatInteger(outcome.appliedCount)} times in run ${outcome.runId}.`}
      />
      <div class="chip-row">
        <Chip
          label={outcome.taskCompleted ? 'task completed' : 'task did not complete'}
          tone={outcome.taskCompleted ? 'good' : 'bad'}
        />
        <Chip
          label={outcome.recovered ? 'recovered' : 'did not recover'}
          tone={outcome.recovered ? 'good' : 'bad'}
        />
        <Chip
          label={outcome.degradedGracefully ? 'degraded gracefully' : 'did not degrade gracefully'}
          tone={outcome.degradedGracefully ? 'good' : 'warn'}
        />
      </div>
      <DefinitionList rows={outcomeRows(outcome)} />
      {unsafeEffects ? (
        <Callout
          tone="bad"
          title={`Under this fault the system produced ${formatInteger(outcome.duplicateSideEffects)} duplicate and ${formatInteger(outcome.prohibitedSideEffects)} prohibited side effects.`}
        />
      ) : null}
      <EvaluatorResults
        results={outcome.evaluators}
        emptyMessage="No evaluator ran for this outcome."
      />
    </div>
  );
}

function NotApplied(props: { readonly report: ChaosReport }) {
  const { notApplied } = props.report;
  return (
    <div class="subpanel">
      <SectionHeading
        title="Faults requested and not applied"
        count={notApplied.length}
        note="Recorded so the suite cannot appear more thorough than it was."
      />
      {notApplied.length === 0 ? (
        <p class="muted">Every requested fault was applied.</p>
      ) : (
        <table class="table">
          <thead>
            <tr>
              <th scope="col">Fault</th>
              <th scope="col">Target</th>
              <th scope="col">Reason it was not applied</th>
            </tr>
          </thead>
          <tbody>
            {notApplied.map((entry) => (
              <tr key={`${entry.faultKind}:${entry.target}`}>
                <th scope="row">{humanise(entry.faultKind)}</th>
                <td class="mono">{entry.target}</td>
                <td>{entry.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ChaosRun(props: { readonly report: ChaosReport }) {
  const { report } = props;
  return (
    <section class="panel">
      <SectionHeading
        title={`Chaos run ${report.id}`}
        note={`Scenario ${report.scenarioId} in the ${humanise(report.environment)} environment, against baseline run ${report.baselineRunId}.`}
      />
      <DefinitionList
        rows={[
          { label: 'Started', value: formatTimestamp(report.startedAt) },
          { label: 'Finished', value: formatTimestamp(report.finishedAt) },
          { label: 'Baseline run', value: report.baselineRunId, code: true },
          { label: 'Faults applied', value: formatInteger(report.outcomes.length) },
          { label: 'Faults not applied', value: formatInteger(report.notApplied.length) },
        ]}
      />
      {report.outcomes.length === 0 ? (
        <p class="muted">No fault was applied in this run.</p>
      ) : (
        report.outcomes.map((outcome) => (
          <FaultOutcome
            key={`${outcome.faultKind}:${outcome.target}:${outcome.runId}`}
            outcome={outcome}
          />
        ))
      )}
      <NotApplied report={report} />
      <p class="muted">
        <BooleanValue
          value={report.environment === 'local_deterministic'}
          trueLabel="This run was deterministic and offline."
          falseLabel="This run touched an environment beyond the deterministic local one."
        />
      </p>
    </section>
  );
}

export function ResilienceSection() {
  const app = useApp();
  const { chaosReports } = app.bundle;
  const firstScenario = app.bundle.scenarios[0]?.id ?? null;

  if (chaosReports.length === 0) {
    return (
      <div class="section">
        <section class="panel">
          <EmptyState
            title="No fault injection has been run"
            body="Resilience is measured by injecting a fault into the running system and recording what the agents did next: whether the task still completed, what recovery cost, and whether a retry produced a second side effect. This report contains no chaos run."
            commands={[chaosCommand(firstScenario)]}
          />
        </section>
      </div>
    );
  }

  return (
    <div class="section">
      {chaosReports.map((report) => (
        <ChaosRun key={report.id} report={report} />
      ))}
    </div>
  );
}
