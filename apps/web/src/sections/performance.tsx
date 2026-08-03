/**
 * Performance. Measurements only: where a quantile was withheld because the sample was too small, the
 * page says which quantile and what sample size it would have needed, rather than printing a number
 * computed from four data points.
 *
 * The screen is a bento. A band carries what the runs add up to, or the refusal when there are none.
 * Under it, where the time goes is the anchor, the runs are the stage, and benchmarks and what was
 * never measured are the stack. Below the row the tables are tiles of their own with nothing folded
 * away, because a per component table is the evidence this screen exists to carry.
 *
 * With no run in the report the band names the commands and the three tiles say what each of them
 * would hold. The commands are named once on the screen rather than once per tile: four copies of
 * `orchescope trace` is a screen that reads as four faults instead of one absence.
 */

import type { Distribution, RunRecord } from '@orchescope/schema';
import { useMemo, useState } from 'preact/hooks';
import { benchmarkCommand, importTraceCommand, traceCommand } from '../commands.ts';
import { buildBarRows, buildMetricRows, type MetricSortKey, sortMetricRows } from '../filters.ts';
import {
  formatDuration,
  formatInteger,
  formatNumber,
  formatTimestamp,
  formatUsd,
  humanise,
} from '../format.ts';
import { describeComponent } from '../graph-index.ts';
import { buildOverlayScale } from '../overlay.ts';
import { useApp } from '../store.tsx';
import {
  Data,
  DefinitionList,
  Eyebrow,
  Figure,
  MeasureBar,
  Meta,
  OptionalNumber,
  RefusalPanel,
  RuledStat,
  State,
  StatRow,
} from '../ui/primitives.tsx';
import { VirtualList } from '../ui/virtual-list.tsx';

const SORT_COLUMNS: readonly { readonly key: MetricSortKey; readonly label: string }[] = [
  { key: 'displayName', label: 'Component' },
  { key: 'executionCount', label: 'Executions' },
  { key: 'selfDurationMs', label: 'Self time' },
  { key: 'totalDurationMs', label: 'Total time' },
  { key: 'tokens', label: 'Tokens' },
  { key: 'costUsd', label: 'Cost' },
  { key: 'errorCount', label: 'Errors' },
];

/** How many components the anchor ranks. The whole ranking is the overlay tile and the table below. */
const RANKED_COMPONENT_COUNT = 6;

interface RunTotals {
  readonly durationMs: number;
  readonly modelCalls: number;
  readonly toolCalls: number;
  readonly tokens: number;
  readonly errors: number;
  readonly retries: number;
  /** Null when no run reported a cost at all, which is an absence of measurement and not a zero. */
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
    if (metrics.costUsd !== undefined) {
      costUsd = (costUsd ?? 0) + metrics.costUsd;
    }
    if (metrics.taskSuccess === undefined) {
      totals.unreported += 1;
    } else if (metrics.taskSuccess) {
      totals.succeeded += 1;
    } else {
      totals.failed += 1;
    }
  }
  return { ...totals, costUsd };
}

/**
 * What the runs in this report add up to, or the refusal when there are none.
 *
 * Every number here is a sum over runs that were actually recorded, so the basis is observed. Cost is
 * the one that can be absent: a run whose provider reported no price contributes nothing rather than
 * a zero, and if no run reported one the figure says so in a word.
 */
function MeasurementBand(props: { readonly measured: number }) {
  const app = useApp();
  const { runs } = app.bundle;

  if (runs.length === 0 && props.measured === 0) {
    return (
      <section class="tile is-band">
        <Eyebrow level={3}>Measured performance</Eyebrow>
        <RefusalPanel
          title="No run has been ingested, so nothing on this screen was measured."
          commands={[traceCommand(), importTraceCommand()]}
        >
          <p>
            Performance is the one part of this report that cannot be read from source at all. Wrap
            the system once, or import spans you already have, and every tile below fills from the
            same evidence.
          </p>
        </RefusalPanel>
      </section>
    );
  }

  const totals = runTotals(runs);
  return (
    <section class="tile is-band">
      <Eyebrow level={3}>Measured performance</Eyebrow>
      <div class="lead-head">
        <p class="display">
          <span class="data">{formatInteger(props.measured)}</span>
          <span>{props.measured === 1 ? ' component measured, ' : ' components measured, '}</span>
          <span class="data">{formatInteger(runs.length)}</span>
          <span>{runs.length === 1 ? ' run.' : ' runs.'}</span>
        </p>
        <div class="lead-measure">
          <Figure
            value={formatDuration(totals.durationMs)}
            of={`wall clock across ${formatInteger(runs.length)} ${runs.length === 1 ? 'run' : 'runs'}`}
            nil={runs.length === 0}
          />
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

/** The components the time went into, ranked. The whole ranking is the table and the overlay below. */
function SelfTimeTile() {
  const app = useApp();
  const rows = useMemo(() => {
    const metrics = [...app.index.metricsByComponent.values()];
    return buildBarRows(
      metrics.map((entry) => ({ componentId: entry.componentId, value: entry.selfDurationMs })),
      (componentId) => describeComponent(app.index, componentId).displayName,
    ).slice(0, RANKED_COMPONENT_COUNT);
  }, [app.index]);

  if (rows.length === 0) {
    return (
      <section class="tile is-anchor">
        <div class="tile-head">
          <Eyebrow level={3}>Where the time goes</Eyebrow>
        </div>
        <div class="tile-body">
          <RefusalPanel title="No run has attributed time to a component.">
            <p>
              Self time is measured per component from the spans a run produced, so with no run
              there is nothing to rank. That is an absence of measurement rather than a system with
              no slow parts.
            </p>
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
        <Data title="Components carrying a measured self time.">
          {formatInteger(app.index.metricsByComponent.size)}
        </Data>
      </div>
      <div class="tile-body">
        <p class="lede">
          {`The ${formatInteger(rows.length)} slowest of ${formatInteger(app.index.metricsByComponent.size)}, by self time.`}
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
          <span class="visually-hidden">What self time excludes, and what it sums to</span>
          <span aria-hidden="true">···</span>
        </summary>
        <div class="tile-more-body">
          <p class="note">
            Self time excludes time spent inside child operations, so these do not sum to the wall
            clock of a run: an orchestrator that waits on a tool is charged for the waiting and not
            for the tool.
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

/** What the runs were and how they ended. The table with every column is a tile of its own below. */
function RunsTile() {
  const app = useApp();
  const { runs } = app.bundle;

  if (runs.length === 0) {
    return (
      <section class="tile is-stage">
        <div class="tile-head">
          <Eyebrow level={3}>Runs</Eyebrow>
        </div>
        <div class="tile-body">
          <RefusalPanel title="This report has no runs, so nothing here was measured.">
            <p>
              A run is one execution of the target system with the tracer attached. Everything on
              this screen, and the delta on the overview, is computed from the spans it produced.
            </p>
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
            label="Tasks that succeeded"
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

/** What has no measurement in this report, said as a count rather than left to be inferred. */
function NotMeasuredTile() {
  const app = useApp();
  const declared = app.bundle.summary.componentCount;
  const measured = app.index.metricsByComponent.size;
  const missing = Math.max(0, declared - measured);
  return (
    <section class="tile">
      <div class="tile-head">
        <Eyebrow level={3}>Not measured</Eyebrow>
        <Data nil={missing === 0}>{formatInteger(missing)}</Data>
      </div>
      <div class="tile-body">
        <p class="lede">
          {missing === 0
            ? `Every one of the ${formatInteger(declared)} components this repository declares carries a measurement.`
            : `${formatInteger(missing)} of ${formatInteger(declared)} declared components carry no measurement in this report.`}
        </p>
      </div>
      <details class="tile-more">
        <summary>
          <span class="visually-hidden">What a component with no measurement means</span>
          <span aria-hidden="true">···</span>
        </summary>
        <div class="tile-more-body">
          <p class="note">
            A component is measured when a run reached it. A component with no measurement was
            either never exercised or was exercised under a name this build could not join to the
            declaration, and the two are told apart by the delta on the overview rather than here. A
            cell that reads not measured is an absence, not a value of zero.
          </p>
        </div>
      </details>
    </section>
  );
}

/** Benchmarks, which are the only thing in this report that repeats a scenario on purpose. */
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
            title="No benchmark has been run for this report."
            commands={[benchmarkCommand(firstScenario)]}
          >
            <p>
              A benchmark repeats one scenario across one named dimension and reports the
              distribution rather than a single number, which is what makes two runs comparable at
              all.
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
                {`Scenario ${benchmark.scenarioId}, varying ${humanise(benchmark.dimension)}, ${formatInteger(benchmark.variants.length)} ${benchmark.variants.length === 1 ? 'variant' : 'variants'}.`}
              </p>
            </li>
          ))}
        </ul>
        <p class="note">Every distribution is a tile of its own below.</p>
      </div>
    </section>
  );
}

function QuantileCell(props: {
  readonly value: number | undefined;
  readonly withheld: string | null;
}) {
  if (props.withheld !== null) {
    return (
      <span class="muted" title={props.withheld}>
        withheld
      </span>
    );
  }
  return <OptionalNumber value={props.value ?? null} render={formatDuration} />;
}

function DistributionRow(props: { readonly label: string; readonly distribution: Distribution }) {
  const { distribution } = props;
  const withheldFor = (quantile: string): string | null => {
    const entry = distribution.withheld.find((candidate) => candidate.quantile === quantile);
    return entry === undefined
      ? null
      : `${quantile} was not computed: it needs at least ${entry.requiredSamples} samples and this set has ${distribution.sampleSize}.`;
  };
  return (
    <tr>
      <th scope="row">{props.label}</th>
      <td class="num">{formatInteger(distribution.sampleSize)}</td>
      <td class="num">
        <OptionalNumber value={distribution.min ?? null} render={formatDuration} />
      </td>
      <td class="num">
        <QuantileCell value={distribution.p50} withheld={withheldFor('p50')} />
      </td>
      <td class="num">
        <QuantileCell value={distribution.p90} withheld={withheldFor('p90')} />
      </td>
      <td class="num">
        <QuantileCell value={distribution.p95} withheld={withheldFor('p95')} />
      </td>
      <td class="num">
        <QuantileCell value={distribution.p99} withheld={withheldFor('p99')} />
      </td>
      <td class="num">
        <OptionalNumber value={distribution.max ?? null} render={formatDuration} />
      </td>
    </tr>
  );
}

/**
 * The per component table. It is an evidence tile and nothing in it folds away: this is the record a
 * finding about a slow or expensive component has to be checkable against.
 */
function ComponentMetricsTable() {
  const app = useApp();
  const [sortKey, setSortKey] = useState<MetricSortKey>('selfDurationMs');
  const [ascending, setAscending] = useState(false);

  const rows = useMemo(() => {
    const built = buildMetricRows([...app.index.metricsByComponent.values()], (componentId) =>
      describeComponent(app.index, componentId),
    );
    return sortMetricRows(built, sortKey, ascending);
  }, [app.index, sortKey, ascending]);

  if (rows.length === 0) {
    return null;
  }

  const onSort = (key: MetricSortKey) => {
    if (key === sortKey) {
      setAscending(!ascending);
      app.announce(`Sorted by ${key}, ${ascending ? 'descending' : 'ascending'}.`);
      return;
    }
    setSortKey(key);
    setAscending(key === 'displayName');
    app.announce(`Sorted by ${key}.`);
  };

  return (
    <section class="tile">
      <Eyebrow level={3} count={rows.length}>
        Per component measurements
      </Eyebrow>
      <p class="lede">
        Aggregated from the runs folded into this report. A cell that reads not measured is an
        absence of measurement, which is not a value of zero.
      </p>
      <div class="scroll-x">
        <table class="table">
          <caption class="visually-hidden">
            Per component measurements, sortable by any numeric column
          </caption>
          <thead>
            <tr>
              {SORT_COLUMNS.map((column) => (
                <th
                  scope="col"
                  key={column.key}
                  aria-sort={
                    column.key === sortKey ? (ascending ? 'ascending' : 'descending') : 'none'
                  }
                >
                  <button
                    type="button"
                    class="sort-button"
                    onClick={() => {
                      onSort(column.key);
                    }}
                  >
                    {column.label}
                    <span aria-hidden="true">
                      {column.key === sortKey ? (ascending ? ' ▲' : ' ▼') : ''}
                    </span>
                  </button>
                </th>
              ))}
              <th scope="col">Retries</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.componentId}>
                <th scope="row">
                  <button
                    type="button"
                    class="link-button"
                    onClick={() => {
                      app.selectComponent(row.componentId, { goToMap: true });
                    }}
                  >
                    {row.displayName}
                  </button>
                  <span class="muted">{` ${humanise(row.kind)}`}</span>
                </th>
                <td class="num">{formatInteger(row.executionCount)}</td>
                <td class="num">{formatDuration(row.selfDurationMs)}</td>
                <td class="num">{formatDuration(row.totalDurationMs)}</td>
                <td class="num">{formatInteger(row.tokens)}</td>
                <td class="num">
                  <OptionalNumber value={row.costUsd} render={formatUsd} />
                </td>
                <td class="num">{formatInteger(row.errorCount)}</td>
                <td class="num">{formatInteger(row.retryCount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OverlayBars(props: { readonly kind: string }) {
  const app = useApp();
  const overlay = app.bundle.overlays.find((candidate) => candidate.kind === props.kind);
  if (overlay === undefined) {
    return null;
  }
  const scale = buildOverlayScale(overlay);
  const rows = buildBarRows(
    [...scale.values].map(([componentId, value]) => ({ componentId, value })),
    (componentId) => describeComponent(app.index, componentId).displayName,
  );
  if (rows.length === 0) {
    return (
      <section class="tile">
        <Eyebrow level={3}>{overlay.label}</Eyebrow>
        <RefusalPanel title="This overlay carries no values.">
          <p>
            The overlay exists in this report and nothing measured filled it, so there is nothing to
            rank. That is an absence of measurement rather than a set of zeroes.
          </p>
        </RefusalPanel>
      </section>
    );
  }
  return (
    <section class="tile">
      <Eyebrow level={3} count={rows.length}>
        {overlay.label}
      </Eyebrow>
      <Meta>
        <span>{humanise(scale.basis)}</span>
        {scale.unit === null ? null : <span>{scale.unit}</span>}
        <span>bars are relative to the largest in this set</span>
      </Meta>
      {scale.caveat === null ? null : <p class="note">{`Caveat: ${scale.caveat}`}</p>}
      <VirtualList
        items={rows}
        label={overlay.label}
        rowHeight={26}
        keyOf={(row) => row.componentId}
        renderRow={(row) => (
          <div class="bar-row">
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
            <span class="bar-value">{`${formatNumber(row.value)}${scale.unit === null ? '' : ` ${scale.unit}`}`}</span>
          </div>
        )}
      />
    </section>
  );
}

function RunTable() {
  const app = useApp();
  const { runs } = app.bundle;
  if (runs.length === 0) {
    return null;
  }
  return (
    <section class="tile">
      <Eyebrow level={3} count={runs.length}>
        Every run
      </Eyebrow>
      <div class="scroll-x">
        <table class="table">
          <thead>
            <tr>
              <th scope="col">Run</th>
              <th scope="col">Kind</th>
              <th scope="col">Status</th>
              <th scope="col">Started</th>
              <th scope="col">Duration</th>
              <th scope="col">Task success</th>
              <th scope="col">Model calls</th>
              <th scope="col">Tool calls</th>
              <th scope="col">Tokens</th>
              <th scope="col">Cost</th>
              <th scope="col">Errors</th>
              <th scope="col">Retries</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <th scope="row">
                  <span class="mono">{run.id}</span>
                  <span class="muted">{` ${run.label}`}</span>
                </th>
                <td>{humanise(run.kind)}</td>
                <td>{humanise(run.status)}</td>
                <td class="num">{formatTimestamp(run.startedAt)}</td>
                <td class="num">{formatDuration(run.metrics.durationMs)}</td>
                <td>
                  {run.metrics.taskSuccess === undefined ? (
                    <span class="muted">not reported</span>
                  ) : (
                    <State
                      value={run.metrics.taskSuccess}
                      trueLabel="succeeded"
                      falseLabel="failed"
                    />
                  )}
                </td>
                <td class="num">{formatInteger(run.metrics.modelCalls)}</td>
                <td class="num">{formatInteger(run.metrics.toolCalls)}</td>
                <td class="num">
                  {formatInteger(run.metrics.inputTokens + run.metrics.outputTokens)}
                </td>
                <td class="num">
                  <OptionalNumber value={run.metrics.costUsd ?? null} render={formatUsd} />
                </td>
                <td class="num">{formatInteger(run.metrics.errors)}</td>
                <td class="num">{formatInteger(run.metrics.retries)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BenchmarkDetail() {
  const app = useApp();
  return (
    <>
      {app.bundle.benchmarks.map((benchmark) => (
        <section class="tile" key={benchmark.id}>
          <Eyebrow level={3}>Benchmark</Eyebrow>
          <h3 class="mono">{benchmark.id}</h3>
          <p class="lede">
            {`Scenario ${benchmark.scenarioId} version ${benchmark.scenarioVersion}, varying ${humanise(benchmark.dimension)}.`}
          </p>
          <DefinitionList
            rows={[
              { label: 'Started', value: formatTimestamp(benchmark.startedAt) },
              { label: 'Finished', value: formatTimestamp(benchmark.finishedAt) },
              { label: 'Warmup runs', value: <Data>{formatInteger(benchmark.warmupRuns)}</Data> },
              {
                label: 'Environment',
                value: `${benchmark.environment.runtimeName} ${benchmark.environment.runtimeVersion} on ${benchmark.environment.platform} ${benchmark.environment.arch}, ${formatInteger(benchmark.environment.cpuCount)} CPUs${benchmark.environment.loadAverage1m === undefined ? '' : `, load ${formatNumber(benchmark.environment.loadAverage1m)}`}`,
              },
            ]}
          />
          {benchmark.limitations.length === 0 ? null : (
            <RefusalPanel title="What this benchmark does not establish">
              <ul class="plain">
                {benchmark.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            </RefusalPanel>
          )}
          {benchmark.variants.map((variant) => (
            <div class="group" key={variant.variantId}>
              <Eyebrow level={4}>{`Variant ${variant.variantId}`}</Eyebrow>
              <p class="note">
                {`${formatInteger(variant.repetitions)} repetitions, ${formatInteger(variant.completedRuns)} completed, ${formatInteger(variant.failedRuns)} failed${variant.successRate === undefined ? '' : `, success rate ${formatNumber(variant.successRate * 100, 1)}%`}.`}
              </p>
              <div class="scroll-x">
                <table class="table">
                  <thead>
                    <tr>
                      <th scope="col">Measurement</th>
                      <th scope="col">Samples</th>
                      <th scope="col">Min</th>
                      <th scope="col">p50</th>
                      <th scope="col">p90</th>
                      <th scope="col">p95</th>
                      <th scope="col">p99</th>
                      <th scope="col">Max</th>
                    </tr>
                  </thead>
                  <tbody>
                    <DistributionRow label="Duration" distribution={variant.durationMs} />
                    {variant.timeToFirstOutputMs === undefined ? null : (
                      <DistributionRow
                        label="Time to first output"
                        distribution={variant.timeToFirstOutputMs}
                      />
                    )}
                    <DistributionRow label="Total tokens" distribution={variant.totalTokens} />
                    {variant.costUsd === undefined ? null : (
                      <DistributionRow label="Cost" distribution={variant.costUsd} />
                    )}
                    <DistributionRow label="Model calls" distribution={variant.modelCalls} />
                    <DistributionRow label="Tool calls" distribution={variant.toolCalls} />
                    <DistributionRow label="Retries" distribution={variant.retries} />
                  </tbody>
                </table>
              </div>
              {[
                variant.durationMs,
                variant.totalTokens,
                variant.modelCalls,
                variant.toolCalls,
                variant.retries,
              ].some((distribution) => distribution.withheld.length > 0) ? (
                <div class="withheld">
                  <p class="note">Quantiles withheld for too small a sample:</p>
                  <ul class="plain small">
                    {variant.durationMs.withheld.map((entry) => (
                      <li key={`duration-${entry.quantile}`}>
                        {`Duration ${entry.quantile}: needs ${formatInteger(entry.requiredSamples)} samples, has ${formatInteger(variant.durationMs.sampleSize)}.`}
                      </li>
                    ))}
                    {variant.totalTokens.withheld.map((entry) => (
                      <li key={`tokens-${entry.quantile}`}>
                        {`Total tokens ${entry.quantile}: needs ${formatInteger(entry.requiredSamples)} samples, has ${formatInteger(variant.totalTokens.sampleSize)}.`}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ))}
        </section>
      ))}
    </>
  );
}

export function PerformanceSection() {
  const app = useApp();
  const measured = app.index.metricsByComponent.size;
  return (
    <div class="bento">
      <MeasurementBand measured={measured} />
      <SelfTimeTile />
      <RunsTile />
      <div class="tile-stack">
        <BenchmarkTile />
        <NotMeasuredTile />
      </div>
      <ComponentMetricsTable />
      <OverlayBars kind="latency" />
      <OverlayBars kind="cost" />
      <RunTable />
      <BenchmarkDetail />
    </div>
  );
}
