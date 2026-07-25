/**
 * Evaluator results. A skipped evaluator is shown as skipped with its reason and never as a pass,
 * because an evaluator that did not run has not agreed with anything.
 */

import type { EvaluatorResult } from '@orchescope/schema';
import { Chip } from './atoms.tsx';

const NO_REASON = 'no reason recorded';

function EvaluatorRow(props: { readonly result: EvaluatorResult }) {
  const { result } = props;
  const skipped = result.skipped === true;
  return (
    <li>
      {skipped ? (
        <Chip label="skipped" tone="warn" title={result.skipReason ?? NO_REASON} />
      ) : (
        <Chip label={result.passed ? 'pass' : 'fail'} tone={result.passed ? 'good' : 'bad'} />
      )}
      <span class="mono">{result.kind}</span>
      <span class="muted">{` ${skipped ? (result.skipReason ?? NO_REASON) : result.detail}`}</span>
    </li>
  );
}

export function EvaluatorResults(props: {
  readonly results: readonly EvaluatorResult[];
  readonly emptyMessage: string;
}) {
  if (props.results.length === 0) {
    return <p class="muted">{props.emptyMessage}</p>;
  }
  return (
    <ul class="plain">
      {props.results.map((result, offset) => (
        <EvaluatorRow key={`${result.kind}:${offset}`} result={result} />
      ))}
    </ul>
  );
}
