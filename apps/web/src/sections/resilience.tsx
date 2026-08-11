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
import {
  formatDuration,
  formatInteger,
  formatNumber,
  formatTimestamp,
  humanise,
} from '../presentation/format.ts';
import { summariseOutcomes } from '../presentation/resilience-outcomes.ts';
import { buildSectionPresentations } from '../presentation/section-presentation.ts';
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
import { SectionSkeleton } from '../ui/section-skeleton.tsx';

function outcomeRows(outcome: ChaosOutcome): readonly DefinitionRow[] {
  return [
    {
      label: 'Recovery time',
      value: <OptionalNumber value={outcome.recoveryTimeMs ?? null} render={formatDuration} />,
    },
    {
      label: 'Tokens it burned',
      value: (
        <OptionalNumber
          value={outcome.costAmplification ?? null}
          render={(value) => `${formatNumber(value)} times what a normal run spends`}
        />
      ),
    },
    {
      label: 'Retries it caused',
      value: (
        <OptionalNumber
          value={outcome.retryAmplification ?? null}
          render={(value) => `${formatNumber(value)} times a normal run`}
        />
      ),
    },
    {
      label: 'Times a person stepped in',
      value: <Data>{formatInteger(outcome.userInterventions)}</Data>,
    },
    { label: 'Times round the loop', value: <Data>{formatInteger(outcome.loopIterations)}</Data> },
    { label: 'Rules it broke', value: <Data>{formatInteger(outcome.policyViolations)}</Data> },
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
            {`Broken ${formatInteger(outcome.appliedCount)} ${outcome.appliedCount === 1 ? 'time' : 'times'} during run ${outcome.runId}.`}
          </p>
          <Meta>
            <span>
              {outcome.taskCompleted ? 'the task still finished' : 'the task never finished'}
            </span>
            <span>{outcome.recovered ? 'it recovered' : 'it never recovered'}</span>
            <span>
              {outcome.degradedGracefully
                ? 'it gave a worse answer rather than none'
                : 'it did not fail cleanly'}
            </span>
          </Meta>
          {unsafeEffects ? (
            <RefusalPanel title="With this broken, the system did things to the outside world it should not have.">
              <p>
                {`${formatInteger(outcome.duplicateSideEffects)} happened twice, and ${formatInteger(outcome.prohibitedSideEffects)} were things the scenario had put out of bounds. Happening twice means the same real operation, repeated inside one run.`}
              </p>
            </RefusalPanel>
          ) : (
            <p class="note">
              Nothing happened twice and nothing out of bounds happened. That is what this run saw,
              and not a promise about every path through the system.
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
              label="Happened twice"
              basis="observed"
              nil={outcome.duplicateSideEffects === 0}
            />
            <RuledStat
              value={formatInteger(outcome.prohibitedSideEffects)}
              label="Out of bounds"
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
              emptyMessage="Nothing checked this outcome, so nothing decided whether it passed."
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
        Asked for and never broken
      </Eyebrow>
      <p class="lede">Recorded so this cannot look more thorough than it was.</p>
      {notApplied.length === 0 ? (
        <p class="note">Everything asked for was actually broken.</p>
      ) : (
        <div class="scroll-x">
          <table class="table">
            <thead>
              <tr>
                <th scope="col">What was meant to break</th>
                <th scope="col">Where</th>
                <th scope="col">Why it did not</th>
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
      <section class="tile">
        <Eyebrow>Breaking things on purpose</Eyebrow>
        <h3 class="mono">{report.id}</h3>
        <div class="lead-head is-prose">
          <div>
            <p class="lede">
              {`Scenario ${report.scenarioId}, run in the ${humanise(report.environment).toLowerCase()} environment and compared against the normal run ${report.baselineRunId}.`}
            </p>
            <DefinitionList
              rows={[
                { label: 'Started', value: formatTimestamp(report.startedAt) },
                { label: 'Finished', value: formatTimestamp(report.finishedAt) },
                {
                  label: 'The normal run it is compared with',
                  value: report.baselineRunId,
                  code: true,
                },
                {
                  label: 'Where it ran',
                  value:
                    report.environment === 'local_deterministic'
                      ? 'on this machine, offline, and it repeats exactly'
                      : 'somewhere that reaches outside this machine, so the result carries whatever variation that brought with it',
                },
              ]}
            />
          </div>
          <div class="lead-measure">
            <StatRow>
              <RuledStat
                value={formatInteger(report.outcomes.length)}
                label="Things broken on purpose"
                basis="observed"
                nil={report.outcomes.length === 0}
              />
              <RuledStat
                value={formatInteger(report.notApplied.length)}
                label="Asked for, never broken"
                basis="observed"
                nil={report.notApplied.length === 0}
              />
            </StatRow>
          </div>
        </div>
      </section>

      {report.outcomes.length === 0 ? (
        <section class="tile">
          <RefusalPanel title="Nothing was actually broken in this run.">
            <p>
              The run finished and broke nothing, so it measures the system with everything working.
              What it meant to break is listed below, with the reason each one did not happen.
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
    </div>
  );
}

export function ResilienceSection() {
  const app = useApp();
  const { chaosReports } = app.bundle;
  const presentation = buildSectionPresentations(app.bundle).resilience;
  const notAppliedCount = chaosReports.reduce(
    (count, report) => count + report.notApplied.length,
    0,
  );
  const summary = summariseOutcomes(chaosReports.flatMap((report) => report.outcomes));

  return (
    <SectionSkeleton
      section="resilience"
      summary={
        <section class="tile is-band section-lead">
          <h3 class="section-lead-question">What broke when something was made to fail</h3>
          {presentation.summaryRefusal === null ? (
            <div class="section-lead-body">
              {/* The lead is what did not survive, not how many faults were injected. An injected
                  fault count is a fact about the experiment; an incomplete task is a fact about the
                  system, and it is the one a reader is here for. */}
              <p class="section-lead-answer">
                <span class="section-lead-figure">{formatInteger(summary.incomplete)}</span>
                <span>
                  {summary.incomplete === 0
                    ? ` of the ${formatInteger(summary.total)} ${summary.total === 1 ? 'thing' : 'things'} deliberately broken stopped the task finishing. That is what these runs reached, not a promise about anything nobody broke.`
                    : ` of the ${formatInteger(summary.total)} ${summary.total === 1 ? 'thing' : 'things'} deliberately broken stopped the task finishing: ${summary.failingFaultKinds.map((kind) => humanise(kind).toLowerCase()).join(', ')}.`}
                </span>
              </p>
              <div class="section-lead-aside">
                <StatRow>
                  <RuledStat
                    value={formatInteger(summary.degraded)}
                    label="Finished, but worse"
                    basis="simulated"
                    nil={summary.degraded === 0}
                  />
                  <RuledStat
                    value={formatInteger(summary.withDuplicateSideEffects)}
                    label="Did something twice"
                    basis="observed"
                    nil={summary.withDuplicateSideEffects === 0}
                  />
                  <RuledStat
                    value={formatInteger(notAppliedCount)}
                    label="Asked for, never broken"
                    basis="observed"
                    nil={notAppliedCount === 0}
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
          chaosReports.map((report) => <ChaosRun key={report.id} report={report} />)
        ) : (
          <section class="tile">
            <Eyebrow level={3}>What happened when things broke</Eyebrow>
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
        presentation.detailRefusal === null ? (
          <div class="bento">
            {chaosReports.map((report) => (
              <NotApplied key={report.id} report={report} />
            ))}
          </div>
        ) : (
          <section class="tile">
            <Eyebrow level={3}>What was never broken</Eyebrow>
            <RefusalPanel
              title={presentation.detailRefusal.title}
              commands={presentation.detailRefusal.commands}
            >
              <p>{presentation.detailRefusal.reason}</p>
            </RefusalPanel>
          </section>
        )
      }
    />
  );
}
