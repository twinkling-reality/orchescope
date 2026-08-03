/**
 * Resilience. One bento per chaos run, and one row per injected fault, with the faults that were
 * requested and not applied kept visible: a chaos suite that quietly skipped half its plan and
 * reported success is worse than no suite.
 *
 * A fault's row is anchored by what the system did, because that is the answer to the question the
 * injection asked, and the numbers that cost it sit beside rather than under: recovery time and cost
 * amplification are what a reader compares between faults, and a definition list stacked under a
 * paragraph put them in a 500px ribbon with the rest of the row empty.
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
import { EvaluatorResults } from '../ui/evaluators.tsx';
import {
  Data,
  DefinitionList,
  type DefinitionRow,
  Eyebrow,
  Meta,
  OptionalNumber,
  RefusalPanel,
  RuledStat,
  StatRow,
} from '../ui/primitives.tsx';

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
          render={(value) => `${formatNumber(value)} times the baseline token spend`}
        />
      ),
    },
    {
      label: 'Retry amplification',
      value: (
        <OptionalNumber
          value={outcome.retryAmplification ?? null}
          render={(value) => `${formatNumber(value)} times the baseline retries`}
        />
      ),
    },
    { label: 'User interventions', value: <Data>{formatInteger(outcome.userInterventions)}</Data> },
    { label: 'Loop iterations', value: <Data>{formatInteger(outcome.loopIterations)}</Data> },
    { label: 'Policy violations', value: <Data>{formatInteger(outcome.policyViolations)}</Data> },
  ];
}

/**
 * One fault, as a row of three.
 *
 * The anchor says what the system did under it, which is the whole point of injecting it. The stage
 * carries the two side effect counts first, because a duplicate or a prohibited effect is the fault
 * finding something rather than the system surviving it, and then the rest of the measurements. The
 * stack holds the evaluators, which are what decided any of it.
 */
function FaultOutcome(props: { readonly outcome: ChaosOutcome }) {
  const { outcome } = props;
  const unsafeEffects = outcome.duplicateSideEffects > 0 || outcome.prohibitedSideEffects > 0;
  return (
    <>
      <section class="tile is-anchor">
        <div class="tile-head">
          <Eyebrow level={3}>{`${humanise(outcome.faultKind)} into ${outcome.target}`}</Eyebrow>
        </div>
        <div class="tile-body">
          <p class="lede">
            {`Applied ${formatInteger(outcome.appliedCount)} times in run ${outcome.runId}.`}
          </p>
          <Meta>
            <span>{outcome.taskCompleted ? 'task completed' : 'task did not complete'}</span>
            <span>{outcome.recovered ? 'recovered' : 'did not recover'}</span>
            <span>
              {outcome.degradedGracefully ? 'degraded gracefully' : 'did not degrade gracefully'}
            </span>
          </Meta>
          {unsafeEffects ? (
            <RefusalPanel title="Under this fault the system produced side effects it should not have.">
              <p>
                {`${formatInteger(outcome.duplicateSideEffects)} duplicate and ${formatInteger(outcome.prohibitedSideEffects)} prohibited. A duplicate is the same logical operation happening twice; a prohibited one is an effect the scenario declared out of bounds.`}
              </p>
            </RefusalPanel>
          ) : (
            <p class="note">
              No duplicate and no prohibited side effect was recorded under this fault. That is what
              the run observed, and not a guarantee about every path through the system.
            </p>
          )}
        </div>
      </section>

      <section class="tile is-stage">
        <div class="tile-head">
          <Eyebrow level={3}>What it cost</Eyebrow>
        </div>
        <div class="tile-body">
          <StatRow>
            <RuledStat
              value={formatInteger(outcome.duplicateSideEffects)}
              label="Duplicate side effects"
              basis="observed"
              nil={outcome.duplicateSideEffects === 0}
            />
            <RuledStat
              value={formatInteger(outcome.prohibitedSideEffects)}
              label="Prohibited side effects"
              basis="observed"
              nil={outcome.prohibitedSideEffects === 0}
            />
          </StatRow>
          <DefinitionList rows={outcomeRows(outcome)} />
        </div>
      </section>

      <div class="tile-stack">
        <section class="tile">
          <div class="tile-body">
            <EvaluatorResults
              level={3}
              results={outcome.evaluators}
              emptyMessage="No evaluator ran for this outcome, so nothing decided whether it passed."
            />
          </div>
        </section>
      </div>
    </>
  );
}

function NotApplied(props: { readonly report: ChaosReport }) {
  const { notApplied } = props.report;
  return (
    <section class="tile">
      <Eyebrow level={3} count={notApplied.length}>
        Faults requested and not applied
      </Eyebrow>
      <p class="lede">Recorded so the suite cannot appear more thorough than it was.</p>
      {notApplied.length === 0 ? (
        <p class="note">Every requested fault was applied.</p>
      ) : (
        <div class="scroll-x">
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
        </div>
      )}
    </section>
  );
}

function ChaosRun(props: { readonly report: ChaosReport }) {
  const { report } = props;
  return (
    <div class="bento">
      <section class="tile is-band">
        <Eyebrow>Chaos run</Eyebrow>
        <h3 class="mono">{report.id}</h3>
        <div class="lead-head is-prose">
          <div>
            <p class="lede">
              {`Scenario ${report.scenarioId} in the ${humanise(report.environment)} environment, against baseline run ${report.baselineRunId}.`}
            </p>
            <DefinitionList
              rows={[
                { label: 'Started', value: formatTimestamp(report.startedAt) },
                { label: 'Finished', value: formatTimestamp(report.finishedAt) },
                { label: 'Baseline run', value: report.baselineRunId, code: true },
                {
                  label: 'Environment',
                  value:
                    report.environment === 'local_deterministic'
                      ? 'deterministic and offline'
                      : 'beyond the deterministic local one, so the result carries the variance of whatever it touched',
                },
              ]}
            />
          </div>
          <div class="lead-measure">
            <StatRow>
              <RuledStat
                value={formatInteger(report.outcomes.length)}
                label="Faults applied"
                basis="observed"
                nil={report.outcomes.length === 0}
              />
              <RuledStat
                value={formatInteger(report.notApplied.length)}
                label="Faults requested and not applied"
                basis="observed"
                nil={report.notApplied.length === 0}
              />
            </StatRow>
          </div>
        </div>
      </section>

      {report.outcomes.length === 0 ? (
        <section class="tile">
          <RefusalPanel title="No fault was applied in this run.">
            <p>
              The run completed and injected nothing, so it measures the system under no fault at
              all. The faults it intended are listed below with the reason each was not applied.
            </p>
          </RefusalPanel>
        </section>
      ) : (
        report.outcomes.map((outcome) => (
          <FaultOutcome
            key={`${outcome.faultKind}:${outcome.target}:${outcome.runId}`}
            outcome={outcome}
          />
        ))
      )}
      <NotApplied report={report} />
    </div>
  );
}

export function ResilienceSection() {
  const app = useApp();
  const { chaosReports } = app.bundle;
  const firstScenario = app.bundle.scenarios[0]?.id ?? null;

  if (chaosReports.length === 0) {
    return (
      <div class="bento">
        <section class="tile is-band">
          <Eyebrow level={3}>Resilience</Eyebrow>
          <RefusalPanel
            title="No fault injection has been run, so nothing here has been tested under failure."
            commands={[chaosCommand(firstScenario)]}
          >
            <p>
              Resilience is measured by injecting a fault into the running system and recording what
              the agents did next: whether the task still completed, what recovery cost, and whether
              a retry produced a second side effect. None of that can be inferred from source.
            </p>
          </RefusalPanel>
        </section>
      </div>
    );
  }

  return (
    <>
      {chaosReports.map((report) => (
        <ChaosRun key={report.id} report={report} />
      ))}
    </>
  );
}
