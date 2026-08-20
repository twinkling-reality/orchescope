import type { NormalizedSpan } from '@orchescope/schema';
import { componentKindFor } from './attributes.ts';

/**
 * A call this build's own instrumentation watched, where the target's instrumentation watched it too.
 *
 * `orchescope trace` patches `fetch` in the target so that a run of a system with no instrumentation of
 * its own still says something. A system worth auditing usually has its own, and then both watch the same
 * HTTP request: this build from outside, the target's instrumentation from inside the SDK that made it.
 * Two spans, one call.
 *
 * Read as two calls it doubles everything a reader counts. On a run of a pinned OpenAI Agents application
 * two model calls were reported as four, and because the two producers name a model differently the same
 * model arrived as two components: `gen_ai.request.model` is what was sent, `gpt-5.4-mini`, and
 * `llm.model_name` is what came back, `gpt-5.4-mini-2026-03-17`. Neither number nor name was wrong on its
 * own. Together they described a system that made twice as many calls to twice as many models as it did.
 *
 * **The two producers are told apart by the scope that exported them.** This build's shim exports under
 * `orchescope` and nothing else does, so no guess is involved in knowing which span is ours.
 *
 * **What settles which one to keep is that the request was in flight for the whole of the other span.** An
 * SDK's model call contains the HTTP request it makes, and the two spans are not even in one trace: an
 * instrumentation that bridges its SDK's own events after the fact opens no context the patched `fetch`
 * runs inside, so each of ours is its own root. Time is what relates them, and containment is the shape
 * that relationship has.
 *
 * **One to one matching is not needed and is not attempted.** The question is only whether something
 * better placed already reported this call, so where a system makes concurrent calls to one provider any
 * container answers it the same way, and the answer does not depend on which.
 *
 * **A superseded span is not an unattributed one.** `unattributed` records what this build could not read
 * and is part of saying what it could not see. Everything this span said is reported, by a witness that
 * said more, so there is no gap to state.
 */

/** The scope this build's own shim exports under, set in `packages/instrumentation/src/exporter.ts`. */
const OWN_SCOPE = 'orchescope';

const toNanos = (value: string): bigint => {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
};

const isModelCall = (span: NormalizedSpan): boolean => componentKindFor(span.operation) === 'model';

type Interval = { readonly start: bigint; readonly end: bigint };

const intervalOf = (span: NormalizedSpan): Interval => ({
  start: toNanos(span.startTimeUnixNano),
  end: toNanos(span.endTimeUnixNano),
});

const containedBy = (inner: Interval, outer: Interval): boolean =>
  outer.start <= inner.start && inner.end <= outer.end;

/**
 * The spans of this run that another producer already reported, which are read as nothing.
 *
 * Only model calls are asked about. A tool call, an agent step or a protocol call this shim reports is the
 * only account of it anywhere: nothing else in the run is watching the same thing from a better place, so
 * there is nothing for it to be superseded by.
 */
export const supersededSpans = (spans: readonly NormalizedSpan[]): ReadonlySet<string> => {
  const ours = spans.filter((span) => span.scopeName === OWN_SCOPE && isModelCall(span));
  if (ours.length === 0) return new Set();
  const theirs = spans
    .filter((span) => span.scopeName !== OWN_SCOPE && isModelCall(span))
    .map(intervalOf);
  if (theirs.length === 0) return new Set();

  const superseded = new Set<string>();
  for (const span of ours) {
    const interval = intervalOf(span);
    if (theirs.some((outer) => containedBy(interval, outer))) superseded.add(span.spanId);
  }
  return superseded;
};
