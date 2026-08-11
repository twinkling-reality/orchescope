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
import {
  formatInteger,
  formatNumber,
  formatPercent,
  formatTimestamp,
  humanise,
  UNKNOWN,
} from '../presentation/format.ts';
import { buildSectionPresentations } from '../presentation/section-presentation.ts';
import { useApp } from '../store.tsx';
import {
  Data,
  DefinitionList,
  Eyebrow,
  Meta,
  RefusalPanel,
  RuledStat,
  State,
  StatRow,
} from '../ui/primitives.tsx';
import { SectionSkeleton } from '../ui/section-skeleton.tsx';

function describeSide(side: ComparisonSide): string {
  const git =
    side.git === undefined
      ? ''
      : ` at ${side.git.ref ?? 'unknown ref'} ${side.git.commit ?? ''}${side.git.dirty ? ' with uncommitted changes' : ''}`;
  // Pluralised rather than suffixed, because `1 runs` was on the page beside a sentence about how few
  // runs there were, which is the one place a grammar slip reads as a counting mistake.
  const runs =
    side.runIds.length === 0
      ? 'no runs'
      : `${formatInteger(side.runIds.length)} ${side.runIds.length === 1 ? 'run' : 'runs'}`;
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
            <th scope="col">What was measured</th>
            <th scope="col">Before</th>
            <th scope="col">After</th>
            <th scope="col">Change</th>
            <th scope="col">Change as a percentage</th>
            <th scope="col">Runs before</th>
            <th scope="col">Runs after</th>
            <th scope="col">Which way</th>
            <th scope="col">What to be careful of</th>
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
  const [latest] = comparisons;
  const presentation = buildSectionPresentations(app.bundle).comparisons;

  return (
    <SectionSkeleton
      section="comparisons"
      summary={
        <section class="tile is-band section-lead">
          <h3 class="section-lead-question">
            What changed, and whether the evidence supports saying so
          </h3>
          {presentation.summaryRefusal === null ? (
            <div class="section-lead-body">
              {/* The verdict leads, not the count of comparisons. A verdict of insufficient evidence
                  is as much an answer as an improvement, and reporting it as a number of comparisons
                  would bury the one thing a reader came for. */}
              <p class="section-lead-answer">
                <span class="section-lead-figure is-word">
                  {humanise(latest?.verdict ?? 'unknown')}
                </span>
                <span>
                  {latest === undefined
                    ? ''
                    : `${latest.verdictReason}, over ${formatInteger(latest.metricDeltas.length)} ${latest.metricDeltas.length === 1 ? 'thing measured' : 'things measured'}.${comparisons.length === 1 ? '' : ` The other ${formatInteger(comparisons.length - 1)} ${comparisons.length === 2 ? 'comparison is' : 'comparisons are'} below.`}`}
                </span>
              </p>
              <div class="section-lead-aside">
                <Meta>
                  <span>{`${formatInteger(comparisons.length)} recorded`}</span>
                  <span>every number says how many runs it rests on</span>
                </Meta>
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
        /*
         * This slot used to render `null` whenever there was exactly one comparison, and
         * `demo-populated` has exactly one and is the only bundle in the corpus that has any. So the
         * three slot contract was satisfied on no comparison bearing report at all: the slot was
         * either a refusal or absent, never filled.
         *
         * It is a way into the cards below rather than a second telling of them, so each row is a
         * link and the verdict reason it used to repeat from the band is gone. A row carries what a
         * reader picks between: which comparison, how it came out, and how much it rests on.
         */
        <section class="tile">
          <h3 class="section-title">
            Comparison index
            <Data>{` ${formatInteger(comparisons.length)}`}</Data>
          </h3>
          {presentation.primaryRefusal === null ? (
            <ul class="plain small">
              {comparisons.map((comparison) => (
                <li key={comparison.id}>
                  <a class="link-button" href={`#comparison-${comparison.id}`}>
                    <span class="mono">{comparison.id}</span>
                  </a>
                  <span>{` ${humanise(comparison.verdict)}`}</span>
                  <Data>
                    {` ${formatInteger(comparison.metricDeltas.length)} ${comparison.metricDeltas.length === 1 ? 'measurement' : 'measurements'}`}
                  </Data>
                </li>
              ))}
            </ul>
          ) : (
            <RefusalPanel
              title={presentation.primaryRefusal.title}
              commands={presentation.primaryRefusal.commands}
            >
              <p>{presentation.primaryRefusal.reason}</p>
            </RefusalPanel>
          )}
        </section>
      }
      detail={
        presentation.detailRefusal === null ? (
          comparisons.map((comparison) => (
            <div class="bento" key={comparison.id} id={`comparison-${comparison.id}`}>
              <section class="tile">
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
                        label="Runs before the change"
                        basis="observed"
                        nil={comparison.baseline.runIds.length === 0}
                      />
                      <RuledStat
                        value={formatInteger(comparison.candidate.runIds.length)}
                        label="Runs after the change"
                        basis="observed"
                        nil={comparison.candidate.runIds.length === 0}
                      />
                      <RuledStat
                        value={formatInteger(comparison.metricDeltas.length)}
                        label="Things measured on both sides"
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
                    What this does not prove
                  </Eyebrow>
                </div>
                <div class="tile-body">
                  {comparison.limitations.length === 0 ? (
                    <p class="lede">
                      Nothing was recorded here, which is itself worth a look: every comparison is
                      at least limited by how many runs went into it.
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
                    What had to be true
                  </Eyebrow>
                </div>
                <div class="tile-body">
                  <DefinitionList
                    rows={[
                      { label: 'Before', value: describeSide(comparison.baseline) },
                      { label: 'After', value: describeSide(comparison.candidate) },
                    ]}
                  />
                  {comparison.acceptanceResults.length === 0 ? (
                    <p class="note">Nothing was set out here for this comparison to check.</p>
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
                    <Eyebrow level={3}>What changed in the system itself</Eyebrow>
                  </div>
                  <GraphDeltaBlock comparison={comparison} />
                </section>
                <section class="tile">
                  <div class="tile-head">
                    <Eyebrow level={3}>Which problems went away</Eyebrow>
                  </div>
                  <div class="tile-body">
                    {comparison.findingDelta === undefined ? (
                      <p class="note">This comparison did not look at problems at all.</p>
                    ) : (
                      <DefinitionList
                        rows={[
                          {
                            label: 'Gone',
                            value: comparison.findingDelta.resolved.join(', ') || 'none',
                            code: comparison.findingDelta.resolved.length > 0,
                          },
                          {
                            label: 'New',
                            value: comparison.findingDelta.introduced.join(', ') || 'none',
                            code: comparison.findingDelta.introduced.length > 0,
                          },
                          {
                            label: 'Still there',
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
                  Every number, before and after
                </Eyebrow>
                <p class="lede">
                  {`${formatInteger(comparison.baseline.runIds.length)} ${comparison.baseline.runIds.length === 1 ? 'run' : 'runs'} before the change against ${formatInteger(comparison.candidate.runIds.length)} ${comparison.candidate.runIds.length === 1 ? 'run' : 'runs'} after it. Every row says how many runs are behind each side and what to be careful of.`}
                </p>
                <MetricDeltas comparison={comparison} />
              </section>
            </div>
          ))
        ) : (
          <section class="tile">
            <Eyebrow level={3}>What each comparison measured</Eyebrow>
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
