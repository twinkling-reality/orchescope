import { useMemo, useState } from 'preact/hooks';
import { importTraceCommand, traceCommand } from '../../presentation/commands.ts';
import {
  buildBarRows,
  buildMetricRows,
  type MetricSortKey,
  sortMetricRows,
} from '../../presentation/filters.ts';
import {
  formatDuration,
  formatInteger,
  formatNumber,
  formatTimestamp,
  formatUsd,
  humanise,
} from '../../presentation/format.ts';
import { describeComponent } from '../../presentation/graph-index.ts';
import { buildOverlayScale } from '../../presentation/overlay.ts';
import { useApp } from '../../store.tsx';
import {
  Eyebrow,
  MeasureBar,
  Meta,
  OptionalNumber,
  RefusalPanel,
  State,
} from '../../ui/primitives.tsx';
import { VirtualList } from '../../ui/virtual-list.tsx';

const SORT_COLUMNS: readonly { readonly key: MetricSortKey; readonly label: string }[] = [
  { key: 'displayName', label: 'Part' },
  { key: 'executionCount', label: 'Times it ran' },
  { key: 'selfDurationMs', label: 'Time in itself' },
  { key: 'totalDurationMs', label: 'Time including what it called' },
  { key: 'tokens', label: 'Tokens' },
  { key: 'costUsd', label: 'Cost' },
  { key: 'errorCount', label: 'Errors' },
];

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
      <section class="tile">
        <Eyebrow level={3} count={0}>
          What each part cost
        </Eyebrow>
        <RefusalPanel
          title="No run has pinned a measurement to any particular part."
          commands={[traceCommand(), importTraceCommand()]}
        >
          <p>
            This table fills up from what a recorded run says each part did. An empty table means
            nothing was measured, not that everything measured zero.
          </p>
        </RefusalPanel>
      </section>
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
    <section class="tile">
      <Eyebrow level={3} count={rows.length}>
        What each part cost
      </Eyebrow>
      <p class="lede">
        Added up over every run in this report. A cell reading not measured means nobody measured
        it, which is not the same as a zero.
      </p>
      <div class="scroll-x">
        <table class="table">
          <caption class="visually-hidden">
            What each part cost, sortable by any numeric column
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
    return (
      <section class="tile">
        <Eyebrow level={3}>{`Shading the map by ${humanise(props.kind).toLowerCase()}`}</Eyebrow>
        <RefusalPanel
          title={`This report carries no ${humanise(props.kind)} overlay.`}
          commands={[traceCommand(), importTraceCommand()]}
        >
          <p>
            The overlay is emitted only when the report can attribute that measurement to named
            components. A missing overlay is not a measurement of zero.
          </p>
        </RefusalPanel>
      </section>
    );
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
        <RefusalPanel
          title="Nothing was measured, so there is nothing to shade the map with."
          commands={[traceCommand(), importTraceCommand()]}
        >
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
    return (
      <section class="tile">
        <Eyebrow level={3} count={0}>
          Every run
        </Eyebrow>
        <RefusalPanel
          title="There is no run record to list."
          commands={[traceCommand(), importTraceCommand()]}
        >
          <p>A traced or imported execution supplies the run and its observed measurements.</p>
        </RefusalPanel>
      </section>
    );
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

export function PerformanceEvidence() {
  return (
    <>
      <ComponentMetricsTable />
      <OverlayBars kind="latency" />
      <OverlayBars kind="cost" />
      <RunTable />
    </>
  );
}
