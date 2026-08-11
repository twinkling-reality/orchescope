/**
 * The rest of what we found, which is not the same thing as the answer above it.
 *
 * The tile that used to sit here listed the top three problems, and the first of them was the finding
 * the hero had already named. This one never repeats it: the hero is the one to act on, and this is the
 * shape of everything behind it, which is a different question with a different answer.
 */

import type { JSX } from 'preact';
import { describeSeverity } from '../../presentation/basis.ts';
import type { FindingMix, Polarity } from '../../presentation/finding-mix.ts';
import { formatInteger } from '../../presentation/format.ts';
import { useApp } from '../../store.tsx';
import { SeverityMark } from '../../ui/primitives.tsx';

/* `flask` has exactly one finding, so every one of these read `1 problems`. */
const LABELS: Readonly<Record<Polarity, readonly [string, string]>> = {
  risk: ['problem', 'problems'],
  strength: ['thing done well', 'things done well'],
};

const label = (polarity: Polarity, count: number): string => LABELS[polarity][count === 1 ? 0 : 1];

export function OverviewProblems(props: {
  readonly mixes: Readonly<Record<Polarity, FindingMix>>;
}) {
  const app = useApp();
  const { risk, strength } = props.mixes;
  return (
    <section class="tile is-anchor overview-problems">
      <h3 class="overview-panel-title">Everything else we found</h3>
      {risk.total === 0 ? (
        <p class="overview-panel-instruction">
          Nothing we check for had enough behind it to be worth reporting. That is not the same as
          your system being fine.
        </p>
      ) : (
        <>
          <p class="tile-figure">
            <span class="tile-figure-value">{formatInteger(risk.total)}</span>
            <span class="tile-figure-label">{label('risk', risk.total)}</span>
          </p>
          {/* How bad they are, in one shape. The rank is ink rather than hue: solid for high, solid and
              half height for medium, an outline for low. More ink means worse, which is what the mark
              beside each count already says. */}
          <div
            class="mix-bar"
            role="img"
            aria-label={risk.slices
              .map((slice) => `${slice.count} ${slice.label.toLowerCase()}`)
              .join(', ')}
          >
            {risk.slices.map((slice) => {
              const style: JSX.CSSProperties = { '--slice': `${(slice.share * 100).toFixed(2)}%` };
              return (
                <span
                  class={`mix-slice mark-${describeSeverity(slice.severity).mark}`}
                  key={slice.severity}
                  style={style}
                />
              );
            })}
          </div>
          <ul class="mix-key">
            {risk.slices.map((slice) => (
              <li class="mix-key-item" key={slice.severity}>
                <SeverityMark severity={slice.severity} />
                <span class="mix-key-count">{formatInteger(slice.count)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p class="more">
        <button
          type="button"
          class="link-button"
          onClick={() => {
            app.navigate('findings');
          }}
        >
          {strength.total === 0
            ? `Open all ${formatInteger(risk.total)} ${label('risk', risk.total)}`
            : `Open all ${formatInteger(risk.total)} ${label('risk', risk.total)} and ${formatInteger(strength.total)} ${label('strength', strength.total)}`}
        </button>
      </p>
    </section>
  );
}
