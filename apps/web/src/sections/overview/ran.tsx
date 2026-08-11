/**
 * How much of the system a run has actually touched.
 *
 * This is the join, and it is a tile rather than the hero. `7 of 21 never ran` is a fact about the
 * quality of our own measurement rather than about the reader's system, so it does not lead; but it is
 * what every runtime claim on every other screen rests on, so it does not leave either.
 */

import type { MeterCount } from '../../presentation/delta-meter.ts';
import { formatInteger } from '../../presentation/format.ts';
import type { DeltaPresentation } from '../../presentation/overview-presentation.ts';
import { useApp } from '../../store.tsx';
import { Meter } from '../../ui/meter.tsx';
import { Data, RefusalPanel } from '../../ui/primitives.tsx';

function Count(props: { readonly count: MeterCount }) {
  const app = useApp();
  const { count } = props;
  return (
    <li>
      <button
        type="button"
        class="more-link"
        onClick={() => {
          app.navigate('map', { presence: count.presence });
          app.announce(`System map narrowed to ${count.label.toLowerCase()}.`);
        }}
      >
        <span class="more-count">
          <Data nil={count.count === 0}>{formatInteger(count.count)}</Data>
        </span>
        <span class="more-label">{count.label.toLowerCase()}</span>
      </button>
    </li>
  );
}

export function OverviewRan(props: { readonly presentation: DeltaPresentation }) {
  const { presentation } = props;
  return (
    <section class="tile overview-ran">
      <h3 class="overview-panel-title">How much of it has actually run</h3>
      {presentation.state === 'measured' ? (
        <>
          <p class="tile-figure">
            <span class="tile-figure-value">{formatInteger(presentation.sets.seen)}</span>
            <span class="tile-figure-label">
              {`of ${formatInteger(presentation.sets.reachable)} ran at least once`}
            </span>
          </p>
          <Meter meter={presentation.meter} />
          <ul class="more-row is-stacked">
            {presentation.meter.counts.map((count) => (
              <Count count={count} key={count.presence} />
            ))}
          </ul>
        </>
      ) : (
        <RefusalPanel
          title={
            presentation.state === 'unmeasured'
              ? 'Nothing has been run, so nothing here has been compared.'
              : presentation.refusal.title
          }
        >
          <p>
            {presentation.state === 'unmeasured'
              ? `${formatInteger(presentation.declared)} parts a run can reach are written down. Which of them your system actually uses stays unknown until one run is recorded.`
              : presentation.refusal.reason}
          </p>
        </RefusalPanel>
      )}
    </section>
  );
}
