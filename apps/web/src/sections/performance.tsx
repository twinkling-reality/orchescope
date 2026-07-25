/**
 * Performance. Measurements only: where a quantile was withheld because the sample was too small, the
 * page says which quantile and what sample size it would have needed, rather than printing a number
 * computed from four data points.
 */

import type { Distribution } from '@orchescope/schema';
import { useMemo, useState } from 'preact/hooks';
import { benchmarkCommand, traceCommand } from '../commands.ts';
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
  Bar,
  BooleanValue,
  Callout,
  CommandBlock,
  DefinitionList,
  EmptyState,
  OptionalNumber,
  SectionHeading,
} from '../ui/atoms.tsx';
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
      <td>{formatInteger(distribution.sampleSize)}</td>
      <td>
        <OptionalNumber value={distribution.min ?? null} render={formatDuration} />
      </td>
      <td>
        <QuantileCell value={distribution.p50} withheld={withheldFor('p50')} />
      </td>
      <td>
        <QuantileCell value={distribution.p90} withheld={withheldFor('p90')} />
      </td>
      <td>
        <QuantileCell value={distribution.p95} withheld={withheldFor('p95')} />
      </td>
      <td>
        <QuantileCell value={distribution.p99} withheld={withheldFor('p99')} />
      </td>
      <td>
        <OptionalNumber value={distribution.max ?? null} render={formatDuration} />
      </td>
    </tr>
  );
}

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
    return (
      <EmptyState
        title="No per component measurements"
        body="No run has contributed per component metrics to this report. Wrap the system once so it can measure where the time goes."
        commands={[traceCommand()]}
      />
    );
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
    <div class="scroll-x">
      <table class="table sortable">
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
              <td>{formatInteger(row.executionCount)}</td>
              <td>{formatDuration(row.selfDurationMs)}</td>
              <td>{formatDuration(row.totalDurationMs)}</td>
              <td>{formatInteger(row.tokens)}</td>
              <td>
                <OptionalNumber value={row.costUsd} render={formatUsd} />
              </td>
              <td>{formatInteger(row.errorCount)}</td>
              <td>{formatInteger(row.retryCount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
      <section class="panel">
        <SectionHeading title={overlay.label} />
        <p class="muted">This overlay carries no values.</p>
      </section>
    );
  }
  return (
    <section class="panel">
      <SectionHeading
        title={overlay.label}
        count={rows.length}
        note={`Basis: ${humanise(scale.basis)}${scale.unit === null ? '' : `. Unit: ${scale.unit}`}.`}
      />
      {scale.caveat === null ? null : <Callout tone="warn" title={scale.caveat} />}
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
            <Bar share={row.share} />
            <span class="bar-value">{`${formatNumber(row.value)}${scale.unit === null ? '' : ` ${scale.unit}`}`}</span>
          </div>
        )}
      />
    </section>
  );
}

function RunSummaries() {
  const app = useApp();
  const { runs } = app.bundle;
  if (runs.length === 0) {
    return (
      <section class="panel">
        <EmptyState
          title="No runs"
          body="This report has no runs, so nothing here was measured. Wrap the system once and regenerate the report."
          commands={[traceCommand()]}
        />
      </section>
    );
  }
  return (
    <section class="panel">
      <SectionHeading title="Runs" count={runs.length} />
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
                <td>{formatTimestamp(run.startedAt)}</td>
                <td>{formatDuration(run.metrics.durationMs)}</td>
                <td>
                  {run.metrics.taskSuccess === undefined ? (
                    <span class="muted">not reported</span>
                  ) : (
                    <BooleanValue value={run.metrics.taskSuccess} />
                  )}
                </td>
                <td>{formatInteger(run.metrics.modelCalls)}</td>
                <td>{formatInteger(run.metrics.toolCalls)}</td>
                <td>{formatInteger(run.metrics.inputTokens + run.metrics.outputTokens)}</td>
                <td>
                  <OptionalNumber value={run.metrics.costUsd ?? null} render={formatUsd} />
                </td>
                <td>{formatInteger(run.metrics.errors)}</td>
                <td>{formatInteger(run.metrics.retries)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Benchmarks() {
  const app = useApp();
  const { benchmarks } = app.bundle;
  const firstScenario = app.bundle.scenarios[0]?.id ?? null;
  if (benchmarks.length === 0) {
    return (
      <section class="panel">
        <EmptyState
          title="No benchmark reports"
          body="A benchmark repeats one scenario across one named dimension and reports the distribution rather than a single number. None has been run for this report."
          commands={[benchmarkCommand(firstScenario)]}
        />
      </section>
    );
  }
  return (
    <>
      {benchmarks.map((benchmark) => (
        <section class="panel" key={benchmark.id}>
          <SectionHeading
            title={`Benchmark ${benchmark.id}`}
            note={`Scenario ${benchmark.scenarioId} version ${benchmark.scenarioVersion}, varying ${humanise(benchmark.dimension)}.`}
          />
          <DefinitionList
            rows={[
              { label: 'Started', value: formatTimestamp(benchmark.startedAt) },
              { label: 'Finished', value: formatTimestamp(benchmark.finishedAt) },
              { label: 'Warmup runs', value: formatInteger(benchmark.warmupRuns) },
              {
                label: 'Environment',
                value: `${benchmark.environment.runtimeName} ${benchmark.environment.runtimeVersion} on ${benchmark.environment.platform} ${benchmark.environment.arch}, ${formatInteger(benchmark.environment.cpuCount)} CPUs${benchmark.environment.loadAverage1m === undefined ? '' : `, load ${formatNumber(benchmark.environment.loadAverage1m)}`}`,
              },
            ]}
          />
          {benchmark.limitations.length === 0 ? null : (
            <Callout tone="warn" title="What this benchmark does not support">
              <ul class="plain">
                {benchmark.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            </Callout>
          )}
          {benchmark.variants.map((variant) => (
            <div class="subpanel" key={variant.variantId}>
              <SectionHeading
                title={`Variant ${variant.variantId}`}
                note={`${formatInteger(variant.repetitions)} repetitions, ${formatInteger(variant.completedRuns)} completed, ${formatInteger(variant.failedRuns)} failed${variant.successRate === undefined ? '' : `, success rate ${formatNumber(variant.successRate * 100, 1)}%`}.`}
              />
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
                  <p class="muted">Quantiles withheld for too small a sample:</p>
                  <ul class="plain">
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
  return (
    <div class="section">
      <section class="panel">
        <SectionHeading
          title="Per component measurements"
          note="Aggregated from the runs folded into this report. A blank cell means not measured, which is not zero."
        />
        <ComponentMetricsTable />
      </section>
      <OverlayBars kind="latency" />
      <OverlayBars kind="cost" />
      <RunSummaries />
      <Benchmarks />
      {app.bundle.runs.length === 0 && app.bundle.benchmarks.length === 0 ? (
        <section class="panel">
          <CommandBlock label="Produce the measurements this section needs" argv={traceCommand()} />
        </section>
      ) : null}
    </div>
  );
}
