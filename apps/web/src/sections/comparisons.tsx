/**
 * Baseline against candidate. Sample sizes are shown on both sides of every delta and the caveat is
 * shown next to it, because a percentage computed from three runs against two is not a comparison.
 *
 * One comparison is one bento. The band is the verdict and the reason for it. The anchor is what the
 * comparison does not establish, because the limitation is the part a reader skips and the part that
 * decides whether the verdict means anything: a verdict of unchanged from one run against one is a
 * refusal, not a result, and it belongs on the ground the eye goes to first. The stage carries the
 * two sides and the acceptance criteria, the stack the graph and finding deltas, and the table of
 * metric deltas is an evidence tile below with nothing folded away.
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
  DefinitionList,
  Eyebrow,
  Meta,
  RefusalPanel,
  RuledStat,
  State,
  StatRow,
} from '../ui/primitives.tsx';

function describeSide(side: ComparisonSide): string {
  const git =
    side.git === undefined
      ? ''
      : ` at ${side.git.ref ?? 'unknown ref'} ${side.git.commit ?? ''}${side.git.dirty ? ' (dirty)' : ''}`;
  const runs = side.runIds.length === 0 ? 'no runs' : `${formatInteger(side.runIds.length)} runs`;
  return `${side.label}: ${humanise(side.kind)} ${side.reference}${git}, ${runs}`;
}

function MetricDeltas(props: { readonly comparison: Comparison }) {
  const { metricDeltas } = props.comparison;
  if (metricDeltas.length === 0) {
    return <p class="note">No metric was compared.</p>;
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
              <td class="num">
                {delta.baseline === undefined ? (
                  <span class="muted">not measured</span>
                ) : (
                  formatNumber(delta.baseline)
                )}
              </td>
              <td class="num">
                {delta.candidate === undefined ? (
                  <span class="muted">not measured</span>
                ) : (
                  formatNumber(delta.candidate)
                )}
              </td>
              <td class="num">
                {delta.absoluteChange === undefined ? (
                  <span class="muted">{UNKNOWN}</span>
                ) : (
                  formatNumber(delta.absoluteChange)
                )}
              </td>
              <td class="num">
                {delta.relativeChange === undefined ? (
                  <span class="muted">{UNKNOWN}</span>
                ) : (
                  formatPercent(delta.relativeChange)
                )}
              </td>
              <td class="num">{formatInteger(delta.baselineSamples)}</td>
              <td class="num">{formatInteger(delta.candidateSamples)}</td>
              <td>{humanise(delta.direction)}</td>
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
      <div class="tile-body">
        <p class="note">This comparison did not compare the graphs.</p>
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
    <div class="tile-body">
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
        <ul class="plain small">
          {delta.renamedComponents.map((rename) => (
            <li key={`${rename.from}->${rename.to}`} class="mono">
              {`${rename.from} → ${rename.to}`}
            </li>
          ))}
        </ul>
      )}
      {delta.changedComponents.length === 0 ? null : (
        <ul class="plain small">
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
      <div class="bento">
        <section class="tile is-band">
          <Eyebrow level={3}>Comparisons</Eyebrow>
          <RefusalPanel
            title="No comparison has been made, so nothing here has been shown to improve."
            commands={[compareCommand()]}
          >
            <p>
              A comparison measures a candidate against a baseline and refuses to call the result an
              improvement unless the success rate holds and the sample sizes support it. That
              refusal is the point: a change that cannot be measured has not been verified.
            </p>
          </RefusalPanel>
        </section>
      </div>
    );
  }

  return (
    <>
      {comparisons.map((comparison) => (
        <div class="bento" key={comparison.id}>
          <section class="tile is-band">
            <Eyebrow>Comparison</Eyebrow>
            <h3 class="mono">{comparison.id}</h3>
            <div class="lead-head">
              <p class="display">{comparison.verdictReason}</p>
              <div class="lead-measure">
                <Meta>
                  <span>{humanise(comparison.verdict)}</span>
                  <span>{formatTimestamp(comparison.createdAt)}</span>
                  {comparison.goalId === undefined ? null : (
                    <span>{`goal ${comparison.goalId}`}</span>
                  )}
                </Meta>
                <StatRow>
                  <RuledStat
                    value={formatInteger(comparison.baseline.runIds.length)}
                    label="Baseline runs"
                    basis="observed"
                    nil={comparison.baseline.runIds.length === 0}
                  />
                  <RuledStat
                    value={formatInteger(comparison.candidate.runIds.length)}
                    label="Candidate runs"
                    basis="observed"
                    nil={comparison.candidate.runIds.length === 0}
                  />
                  <RuledStat
                    value={formatInteger(comparison.metricDeltas.length)}
                    label="Metrics compared"
                    basis="observed"
                    nil={comparison.metricDeltas.length === 0}
                  />
                </StatRow>
              </div>
            </div>
          </section>

          <section class="tile is-anchor">
            <div class="tile-head">
              <Eyebrow level={3} count={comparison.limitations.length}>
                What this does not establish
              </Eyebrow>
            </div>
            <div class="tile-body">
              {comparison.limitations.length === 0 ? (
                <p class="lede">
                  No limitation was recorded, which is itself worth checking: every comparison has
                  at least the limits of its own sample.
                </p>
              ) : (
                <ul class="plain small">
                  {comparison.limitations.map((limitation) => (
                    <li key={limitation}>{limitation}</li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section class="tile is-stage">
            <div class="tile-head">
              <Eyebrow level={3} count={comparison.acceptanceResults.length}>
                Acceptance criteria
              </Eyebrow>
            </div>
            <div class="tile-body">
              <DefinitionList
                rows={[
                  { label: 'Baseline', value: describeSide(comparison.baseline) },
                  { label: 'Candidate', value: describeSide(comparison.candidate) },
                ]}
              />
              {comparison.acceptanceResults.length === 0 ? (
                <p class="note">This comparison did not evaluate acceptance criteria.</p>
              ) : (
                <ul class="plain small">
                  {comparison.acceptanceResults.map((result) => (
                    <li key={result.criterion}>
                      <State
                        value={result.satisfied}
                        trueLabel="satisfied"
                        falseLabel="not satisfied"
                      />
                      <span>{`: ${result.criterion}`}</span>
                      <p class="muted">{result.detail}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <div class="tile-stack">
            <section class="tile">
              <div class="tile-head">
                <Eyebrow level={3}>Graph delta</Eyebrow>
              </div>
              <GraphDeltaBlock comparison={comparison} />
            </section>
            <section class="tile">
              <div class="tile-head">
                <Eyebrow level={3}>Finding delta</Eyebrow>
              </div>
              <div class="tile-body">
                {comparison.findingDelta === undefined ? (
                  <p class="note">This comparison did not compare the findings.</p>
                ) : (
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
                )}
              </div>
            </section>
          </div>

          <section class="tile">
            <Eyebrow level={3} count={comparison.metricDeltas.length}>
              Metric deltas
            </Eyebrow>
            <p class="lede">
              {`${formatInteger(comparison.baseline.runIds.length)} baseline runs against ${formatInteger(comparison.candidate.runIds.length)} candidate runs. Every row carries the sample size on both sides and the caveat beside it.`}
            </p>
            <MetricDeltas comparison={comparison} />
          </section>
        </div>
      ))}
    </>
  );
}
