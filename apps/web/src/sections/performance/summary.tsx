import type { RunRecord } from '@orchescope/schema';
import { useMemo } from 'preact/hooks';
import { benchmarkCommand } from '../../presentation/commands.ts';
import { buildBarRows } from '../../presentation/filters.ts';
import { formatDuration, formatInteger, formatUsd, humanise } from '../../presentation/format.ts';
import { describeComponent } from '../../presentation/graph-index.ts';
import type { PresentationRefusal } from '../../presentation/presentation-refusal.ts';
import { useApp } from '../../store.tsx';
import {
  Data,
  DefinitionList,
  Eyebrow,
  MeasureBar,
  Meta,
  RefusalPanel,
  RuledStat,
  StatRow,
} from '../../ui/primitives.tsx';

const RANKED_COMPONENT_COUNT = 6;

interface RunTotals {
  readonly durationMs: number;
  readonly modelCalls: number;
  readonly toolCalls: number;
  readonly tokens: number;
  readonly errors: number;
  readonly retries: number;
  readonly costUsd: number | null;
  readonly succeeded: number;
  readonly failed: number;
  readonly unreported: number;
}

function runTotals(runs: readonly RunRecord[]): RunTotals {
  let costUsd: number | null = null;
  const totals = {
    durationMs: 0,
    modelCalls: 0,
    toolCalls: 0,
    tokens: 0,
    errors: 0,
    retries: 0,
    succeeded: 0,
    failed: 0,
    unreported: 0,
  };
  for (const run of runs) {
    const { metrics } = run;
    totals.durationMs += metrics.durationMs;
    totals.modelCalls += metrics.modelCalls;
    totals.toolCalls += metrics.toolCalls;
    totals.tokens += metrics.inputTokens + metrics.outputTokens;
    totals.errors += metrics.errors;
    totals.retries += metrics.retries;
    if (metrics.costUsd !== undefined) costUsd = (costUsd ?? 0) + metrics.costUsd;
    if (metrics.taskSuccess === undefined) totals.unreported += 1;
    else if (metrics.taskSuccess) totals.succeeded += 1;
    else totals.failed += 1;
  }
  return { ...totals, costUsd };
}

export function PerformanceBand(props: {
  readonly measured: number;
  readonly refusal: PresentationRefusal | null;
}) {
  const { runs } = useApp().bundle;
  if (runs.length === 0 && props.measured === 0 && props.refusal !== null) {
    return (
      <section class="tile is-band section-lead">
        <h3 class="section-lead-question">Where time, calls and tokens went</h3>
        <RefusalPanel title={props.refusal.title} commands={props.refusal.commands}>
          <p>{props.refusal.reason}</p>
        </RefusalPanel>
      </section>
    );
  }

  const totals = runTotals(runs);
  return (
    <section class="tile is-band section-lead">
      <h3 class="section-lead-question">Where time, calls and tokens went</h3>
      <div class="section-lead-body">
        {/* The answer is the wall clock and the sample it rests on. A measurement without its sample
            size is a claim, so the run count travels in the same sentence rather than in a stat. */}
        <p class="section-lead-answer">
          <span class="section-lead-figure">{formatDuration(totals.durationMs)}</span>
          <span>
            {` of clock time across ${formatInteger(runs.length)} ${runs.length === 1 ? 'run' : 'runs'}, over ${formatInteger(props.measured)} ${props.measured === 1 ? 'part that was' : 'parts that were'} actually measured.`}
          </span>
        </p>
        <div class="section-lead-aside">
          <StatRow>
            <RuledStat
              value={formatInteger(totals.modelCalls)}
              label="Model calls"
              basis="observed"
              nil={totals.modelCalls === 0}
            />
            <RuledStat
              value={formatInteger(totals.toolCalls)}
              label="Tool calls"
              basis="observed"
              nil={totals.toolCalls === 0}
            />
            <RuledStat
              value={formatInteger(totals.tokens)}
              label="Tokens"
              basis="observed"
              nil={totals.tokens === 0}
            />
            <RuledStat
              value={totals.costUsd === null ? 'not measured' : formatUsd(totals.costUsd)}
              label="Cost"
              basis="observed"
              nil={totals.costUsd === null}
            />
          </StatRow>
        </div>
      </div>
    </section>
  );
}

function SelfTimeTile(props: { readonly refusal: PresentationRefusal | null }) {
  const app = useApp();
  const rows = useMemo(() => {
    const metrics = [...app.index.metricsByComponent.values()];
    return buildBarRows(
      metrics.map((entry) => ({ componentId: entry.componentId, value: entry.selfDurationMs })),
      (componentId) => describeComponent(app.index, componentId).displayName,
    ).slice(0, RANKED_COMPONENT_COUNT);
  }, [app.index]);

  if (rows.length === 0 && props.refusal !== null) {
    return (
      <section class="tile is-anchor">
        <div class="tile-head">
          <h3 class="section-title">What took the longest</h3>
        </div>
        <div class="tile-body">
          {/* The reason and the command come from the binder rather than from here, so this slot
              cannot drift into saying what the band already said. The wording it replaced also
              spoke Orchescope where the rest of the screen speaks the reader's words: `per
              component` and `runtime spans` against `part` and `run`. */}
          <RefusalPanel title={props.refusal.title} commands={props.refusal.commands}>
            <p>{props.refusal.reason}</p>
          </RefusalPanel>
        </div>
      </section>
    );
  }

  const total = [...app.index.metricsByComponent.values()].reduce(
    (sum, entry) => sum + entry.selfDurationMs,
    0,
  );
  return (
    <section class="tile is-anchor">
      <div class="tile-head">
        <Eyebrow level={3}>Where the time goes</Eyebrow>
        <Data title="Parts with a measured time of their own.">
          {formatInteger(app.index.metricsByComponent.size)}
        </Data>
      </div>
      <div class="tile-body">
        <p class="lede">
          {`The ${formatInteger(rows.length)} slowest of ${formatInteger(app.index.metricsByComponent.size)}, counting only time spent in the part itself.`}
        </p>
        {rows.map((row) => (
          <div class="bar-row" key={row.componentId}>
            <button
              type="button"
              class="link-button bar-label"
              onClick={() => {
                app.selectComponent(row.componentId, { goToMap: true });
              }}
            >
              {row.label}
            </button>
            <MeasureBar share={row.share} />
            <span class="bar-value">{formatDuration(row.value)}</span>
          </div>
        ))}
        <Meta>
          <span>observed</span>
          <span>bars are relative to the slowest in this set</span>
        </Meta>
      </div>
      <details class="tile-more">
        <summary>
          <span class="visually-hidden">What this time leaves out, and what it adds up to</span>
          <span aria-hidden="true">···</span>
        </summary>
        <div class="tile-more-body">
          <p class="note">
            This leaves out time spent inside anything a part called, so these values do not add up
            to the clock time of a run.
          </p>
          <DefinitionList
            rows={[
              { label: 'Self time, summed', value: <Data>{formatDuration(total)}</Data> },
              {
                label: 'Components measured',
                value: <Data>{formatInteger(app.index.metricsByComponent.size)}</Data>,
              },
            ]}
          />
        </div>
      </details>
    </section>
  );
}

function RunsTile() {
  const { runs } = useApp().bundle;
  if (runs.length === 0) {
    return (
      <section class="tile is-stage">
        <div class="tile-head">
          <Eyebrow level={3}>Runs</Eyebrow>
        </div>
        <div class="tile-body">
          <RefusalPanel title="Nothing has been run, so nothing here was measured.">
            <p>A run is one execution of the target system with the tracer attached.</p>
          </RefusalPanel>
        </div>
      </section>
    );
  }

  const totals = runTotals(runs);
  return (
    <section class="tile is-stage">
      <div class="tile-head">
        <Eyebrow level={3}>Runs</Eyebrow>
        <Data>{formatInteger(runs.length)}</Data>
      </div>
      <div class="tile-body">
        <StatRow>
          <RuledStat
            value={formatInteger(totals.succeeded)}
            label="Tasks that finished"
            basis="observed"
            nil={totals.succeeded === 0}
          />
          <RuledStat
            value={formatInteger(totals.failed)}
            label="Tasks that failed"
            basis="observed"
            nil={totals.failed === 0}
          />
          <RuledStat
            value={formatInteger(totals.errors)}
            label="Errors"
            basis="observed"
            nil={totals.errors === 0}
          />
          <RuledStat
            value={formatInteger(totals.retries)}
            label="Retries"
            basis="observed"
            nil={totals.retries === 0}
          />
        </StatRow>
        {totals.unreported === 0 ? null : (
          <p class="note">
            {`${formatInteger(totals.unreported)} of these runs reported no task outcome, so they count as neither succeeded nor failed.`}
          </p>
        )}
      </div>
      <details class="tile-more">
        <summary>
          <span class="visually-hidden">Every run, with what it cost and how it ended</span>
          <span aria-hidden="true">···</span>
        </summary>
        <div class="tile-more-body">
          <ul class="plain small">
            {runs.map((run) => (
              <li key={run.id}>
                <Meta>
                  <span>{run.id}</span>
                  <span>{humanise(run.kind)}</span>
                  <span>{humanise(run.status)}</span>
                  <span>{formatDuration(run.metrics.durationMs)}</span>
                </Meta>
                <span class="muted">{run.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </section>
  );
}

function NotMeasuredTile() {
  const app = useApp();
  const declared = app.bundle.summary.componentCount;
  const measured = app.index.metricsByComponent.size;
  const missing = Math.max(0, declared - measured);
  return (
    <section class="tile">
      <div class="tile-head">
        <Eyebrow level={3}>Never measured</Eyebrow>
        <Data nil={missing === 0}>{formatInteger(missing)}</Data>
      </div>
      <div class="tile-body">
        <p class="lede">
          {missing === 0
            ? `Every one of the ${formatInteger(declared)} parts found here has a measurement against it.`
            : `${formatInteger(missing)} of the ${formatInteger(declared)} parts found here have no measurement at all in this report.`}
        </p>
      </div>
      <details class="tile-more">
        <summary>
          <span class="visually-hidden">What no measurement means</span>
          <span aria-hidden="true">···</span>
        </summary>
        <div class="tile-more-body">
          <p class="note">
            A part gets measured when a run reaches it. Overview tells apart something that was
            never reached from something that ran and could not be matched to anything written down.
          </p>
        </div>
      </details>
    </section>
  );
}

function BenchmarkTile() {
  const app = useApp();
  const { benchmarks } = app.bundle;
  const firstScenario = app.bundle.scenarios[0]?.id ?? null;
  if (benchmarks.length === 0) {
    return (
      <section class="tile">
        <div class="tile-head">
          <Eyebrow level={3}>Benchmarks</Eyebrow>
        </div>
        <div class="tile-body">
          <RefusalPanel
            title="Nothing has been measured against a variation yet."
            commands={[benchmarkCommand(firstScenario)]}
          >
            <p>
              This runs one scenario over and over, changing exactly one thing, and reports the
              whole spread rather than a single number.
            </p>
          </RefusalPanel>
        </div>
      </section>
    );
  }
  return (
    <section class="tile">
      <div class="tile-head">
        <Eyebrow level={3}>Benchmarks</Eyebrow>
        <Data>{formatInteger(benchmarks.length)}</Data>
      </div>
      <div class="tile-body">
        <ul class="plain small">
          {benchmarks.map((benchmark) => (
            <li key={benchmark.id}>
              <span class="mono">{benchmark.id}</span>
              <p class="muted">
                {`Scenario ${benchmark.scenarioId}, changing only ${humanise(benchmark.dimension).toLowerCase()}, ${formatInteger(benchmark.variants.length)} ${benchmark.variants.length === 1 ? 'version' : 'versions'} tried.`}
              </p>
            </li>
          ))}
        </ul>
        <p class="note">The full spread of every measurement is in the table below.</p>
      </div>
    </section>
  );
}

export function PerformancePrimary(props: { readonly refusal: PresentationRefusal | null }) {
  return (
    <div class="bento">
      <SelfTimeTile refusal={props.refusal} />
      <RunsTile />
      <div class="tile-stack">
        <BenchmarkTile />
        <NotMeasuredTile />
      </div>
    </div>
  );
}
