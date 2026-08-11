/**
 * What checked a run, and what each one decided. A check that was skipped says so with its reason and
 * never says it passed, because a check that did not run has not agreed with anything.
 *
 * The three states are three words rather than three colours. A colour would have to be read as good
 * or bad, and skipped is neither.
 */

import type { EvaluatorResult } from '@orchescope/schema';
import { Eyebrow } from './primitives.tsx';

const NO_REASON = 'no reason recorded';

function EvaluatorRow(props: { readonly result: EvaluatorResult }) {
  const { result } = props;
  const skipped = result.skipped === true;
  const verdict = skipped ? 'skipped' : result.passed ? 'passed' : 'failed';
  return (
    <li class="evaluator">
      <span class="verdict">{verdict}</span>
      <span class="mono">{result.kind}</span>
      <span class="muted">{` ${skipped ? (result.skipReason ?? NO_REASON) : result.detail}`}</span>
    </li>
  );
}

/**
 * The heading is always drawn, including when nothing ran, because a tile whose whole subject is what
 * decided the outcome has to name itself before it says nothing did. `level` is the caller's, since the
 * same block is a tile of its own on the resilience screen and a group inside a run elsewhere.
 */
export function EvaluatorResults(props: {
  readonly results: readonly EvaluatorResult[];
  readonly emptyMessage: string;
  readonly level?: 3 | 4;
}) {
  return (
    <div class="group">
      <Eyebrow level={props.level ?? 4} count={props.results.length}>
        What decided this
      </Eyebrow>
      {props.results.length === 0 ? (
        <p class="note">{props.emptyMessage}</p>
      ) : (
        <ul class="plain small">
          {props.results.map((result, offset) => (
            <EvaluatorRow key={`${result.kind}:${offset}`} result={result} />
          ))}
        </ul>
      )}
    </div>
  );
}
