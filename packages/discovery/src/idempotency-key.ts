import type { CallFact, ObjectEntryFact } from '@orchescope/source-analysis';

/**
 * How a repository spells an idempotency key, and the two places it can be read.
 *
 * The schema says `idempotency: 'declared'` means a key was found on the retried operation, and nothing
 * ever assigned it: all five sites that construct a retry policy wrote `'unknown'`, so
 * `bounded-retry-with-declared-idempotency` selected on a value that did not exist and reported `clear`
 * on every repository it was ever given, including ones that plainly contain the shape it describes. A
 * rule that cannot fire is worse than one that fires wrongly, because nothing in the output says so.
 *
 * The two readings are deliberately different in strength and are not interchangeable.
 *
 * On the call itself is proof enough to say `declared`: the request that leaves the process carries the
 * key, and there is no frame between the reading and the claim.
 *
 * One frame away, in the function performing the operation, is evidence that stops a rule asserting an
 * absence and is not enough to declare the retry safe. That reading lives with the rest of the sink
 * evidence and shares only this vocabulary.
 */
export const IDEMPOTENCY_KEY_NAME = /^idempotency[-_]?(key|token)$/i;

/**
 * Nested one level, because a JavaScript request carries the key under `headers` and a Python client
 * carries it under `headers` or `json`. Deeper than that is a document this build has not read.
 */
export const entryDeclaresKey = (entries: readonly ObjectEntryFact[], depth: number): boolean =>
  entries.some((entry) => {
    if (IDEMPOTENCY_KEY_NAME.test(entry.key)) return true;
    if (depth === 0 || entry.value.kind !== 'object') return false;
    return entryDeclaresKey(entry.value.entries, depth - 1);
  });

/** Whether this call's own arguments carry an idempotency key. */
export const keyDeclaredAt = (call: CallFact): boolean =>
  call.args.some((argument) => argument.kind === 'object' && entryDeclaresKey(argument.entries, 1));
