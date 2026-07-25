/**
 * Baseline against candidate. Sample sizes are shown on both sides of every delta and the caveat is
 * shown next to it, because a percentage computed from three runs against two is not a comparison.
 */

import type { Comparison, ComparisonSide } from '@orchescope/schema';
import { compareCommand } from '../commands.ts';
import {
  formatInteger,
  formatNumber,
  formatPercent,
  formatTimestamp,
  humanise,
  UNKNOWN,
} from '../format.ts';
import { useApp } from '../store.tsx';
import {
  BooleanValue,
  Callout,
  Chip,
  DefinitionList,
  EmptyState,
  SectionHeading,
} from '../ui/atoms.tsx';

function describeSide(side: ComparisonSide): string {
  const git =
    side.git === undefined
      ? ''
      : ` at ${side.git.ref ?? 'unknown ref'} ${side.git.commit ?? ''}${side.git.dirty ? ' (dirty)' : ''}`;
  const runs = side.runIds.length === 0 ? 'no runs' : `${formatInteger(side.runIds.length)} runs`;
  return `${side.label}: ${humanise(side.kind)} ${side.reference}${git}, ${runs}`;
}

function verdictTone(verdict: Comparison['verdict']): 'good' | 'bad' | 'warn' | 'neutral' {
  if (verdict === 'improved') {
    return 'good';
  }
  if (verdict === 'regressed') {
    return 'bad';
  }
  if (verdict === 'insufficient_evidence') {
    return 'warn';
  }
  return 'neutral';
}

function directionTone(direction: string): 'good' | 'bad' | 'warn' | 'neutral' {
  if (direction === 'improved') {
    return 'good';
  }
  if (direction === 'regressed') {
    return 'bad';
  }
  if (direction === 'indeterminate') {
    return 'warn';
  }
  return 'neutral';
}

function MetricDeltas(props: { readonly comparison: Comparison }) {
  const { metricDeltas } = props.comparison;
  if (metricDeltas.length === 0) {
    return <p class="muted">No metric was compared.</p>;
  }
  return (
    <div class="scroll-x">
      <table class="table">
        <thead>
          <tr>
            <th scope="col">Metric</th>
            <th scope="col">Baseline</th>
            <th scope="col">Candidate</th>
            <th scope="col">Absolute change</th>
            <th scope="col">Relative change</th>
            <th scope="col">Baseline samples</th>
            <th scope="col">Candidate samples</th>
            <th scope="col">Direction</th>
            <th scope="col">Caveat</th>
          </tr>
        </thead>
        <tbody>
          {metricDeltas.map((delta) => (
            <tr key={delta.metric}>
              <th scope="row">
                {delta.metric}
                <span class="muted">{` (${delta.unit})`}</span>
              </th>
              <td>
                {delta.baseline === undefined ? (
                  <span class="muted">not measured</span>
                ) : (
                  formatNumber(delta.baseline)
                )}
              </td>
              <td>
                {delta.candidate === undefined ? (
                  <span class="muted">not measured</span>
                ) : (
                  formatNumber(delta.candidate)
                )}
              </td>
              <td>
                {delta.absoluteChange === undefined ? (
                  <span class="muted">{UNKNOWN}</span>
                ) : (
                  formatNumber(delta.absoluteChange)
                )}
              </td>
              <td>
                {delta.relativeChange === undefined ? (
                  <span class="muted">{UNKNOWN}</span>
                ) : (
                  formatPercent(delta.relativeChange)
                )}
              </td>
              <td>{formatInteger(delta.baselineSamples)}</td>
              <td>{formatInteger(delta.candidateSamples)}</td>
              <td>
                <Chip label={humanise(delta.direction)} tone={directionTone(delta.direction)} />
              </td>
              <td>{delta.caveat ?? <span class="muted">none recorded</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GraphDeltaBlock(props: { readonly comparison: Comparison }) {
  const app = useApp();
  const delta = props.comparison.graphDelta;
  if (delta === undefined) {
    return (
      <div class="subpanel">
        <SectionHeading title="Graph delta" />
        <p class="muted">This comparison did not compare the graphs.</p>
      </div>
    );
  }
  const rows: readonly { readonly label: string; readonly ids: readonly string[] }[] = [
    { label: 'Components added', ids: delta.addedComponents },
    { label: 'Components removed', ids: delta.removedComponents },
    { label: 'Relations added', ids: delta.addedEdges },
    { label: 'Relations removed', ids: delta.removedEdges },
  ];
  return (
    <div class="subpanel">
      <SectionHeading title="Graph delta" />
      <DefinitionList
        rows={rows.map((row) => ({
          label: row.label,
          value:
            row.ids.length === 0
              ? 'none'
              : `${formatInteger(row.ids.length)}: ${row.ids.join(', ')}`,
          code: row.ids.length > 0,
        }))}
      />
      {delta.renamedComponents.length === 0 ? null : (
        <ul class="plain">
          {delta.renamedComponents.map((rename) => (
            <li key={`${rename.from}->${rename.to}`} class="mono">
              {`${rename.from} → ${rename.to}`}
            </li>
          ))}
        </ul>
      )}
      {delta.changedComponents.length === 0 ? null : (
        <ul class="plain">
          {delta.changedComponents.map((changed) => (
            <li key={changed.componentId}>
              <button
                type="button"
                class="link-button"
                onClick={() => {
                  app.selectComponent(changed.componentId, { goToMap: true });
                }}
              >
                {changed.componentId}
              </button>
              <span class="muted">{` ${changed.changes.join(', ')}`}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ComparisonsSection() {
  const app = useApp();
  const { comparisons } = app.bundle;

  if (comparisons.length === 0) {
    return (
      <div class="section">
        <section class="panel">
          <EmptyState
            title="No comparison has been made"
            body="A comparison measures a candidate against a baseline and refuses to call the result an improvement unless the success rate holds and the sample sizes support it."
            commands={[compareCommand()]}
          />
        </section>
      </div>
    );
  }

  return (
    <div class="section">
      {comparisons.map((comparison) => (
        <section class="panel" key={comparison.id}>
          <SectionHeading
            title={`Comparison ${comparison.id}`}
            note={formatTimestamp(comparison.createdAt)}
          />
          <div class="chip-row">
            <Chip label={humanise(comparison.verdict)} tone={verdictTone(comparison.verdict)} />
            {comparison.goalId === undefined ? null : <Chip label={`goal ${comparison.goalId}`} />}
          </div>
          <p class="verdict-reason">{comparison.verdictReason}</p>
          <DefinitionList
            rows={[
              { label: 'Baseline', value: describeSide(comparison.baseline) },
              { label: 'Candidate', value: describeSide(comparison.candidate) },
            ]}
          />

          <div class="subpanel">
            <SectionHeading title="Metric deltas" count={comparison.metricDeltas.length} />
            <MetricDeltas comparison={comparison} />
          </div>

          <div class="subpanel">
            <SectionHeading
              title="Acceptance criteria"
              count={comparison.acceptanceResults.length}
            />
            {comparison.acceptanceResults.length === 0 ? (
              <p class="muted">This comparison did not evaluate acceptance criteria.</p>
            ) : (
              <ul class="plain">
                {comparison.acceptanceResults.map((result) => (
                  <li key={result.criterion}>
                    <BooleanValue
                      value={result.satisfied}
                      trueLabel="satisfied"
                      falseLabel="not satisfied"
                    />
                    <strong>{` ${result.criterion}`}</strong>
                    <p class="muted">{result.detail}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <GraphDeltaBlock comparison={comparison} />

          {comparison.findingDelta === undefined ? null : (
            <div class="subpanel">
              <SectionHeading title="Finding delta" />
              <DefinitionList
                rows={[
                  {
                    label: 'Resolved',
                    value: comparison.findingDelta.resolved.join(', ') || 'none',
                    code: comparison.findingDelta.resolved.length > 0,
                  },
                  {
                    label: 'Introduced',
                    value: comparison.findingDelta.introduced.join(', ') || 'none',
                    code: comparison.findingDelta.introduced.length > 0,
                  },
                  {
                    label: 'Unchanged',
                    value: comparison.findingDelta.unchanged.join(', ') || 'none',
                    code: comparison.findingDelta.unchanged.length > 0,
                  },
                ]}
              />
            </div>
          )}

          <div class="subpanel">
            <SectionHeading title="Limitations" count={comparison.limitations.length} />
            {comparison.limitations.length === 0 ? (
              <p class="muted">No limitation was recorded, which is itself worth checking.</p>
            ) : (
              <Callout tone="warn" title="What this comparison does not establish">
                <ul class="plain">
                  {comparison.limitations.map((limitation) => (
                    <li key={limitation}>{limitation}</li>
                  ))}
                </ul>
              </Callout>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
