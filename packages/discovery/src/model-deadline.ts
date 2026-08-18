import type { CallFact, Language } from '@orchescope/source-analysis';
import { findEntry, numberValue, objectArgument } from '@orchescope/source-analysis';

/**
 * The deadline a model call declares, and which of the two places declared it.
 *
 * A timeout on the client covers every call made through it and a timeout on the call covers that call,
 * so they are different facts about different populations and a reader who cannot tell them apart cannot
 * act on either. The relation carries the number; this says where the number was read.
 */
export type DeclaredDeadline = {
  readonly timeoutMs: number;
  readonly declaredAt: 'call site' | 'client';
};

/**
 * How the provider SDKs spell a timeout, which differs by language rather than by provider.
 *
 * Two external constraints, both of them the sort that a reader of one ecosystem never sees. The Python
 * clients for `openai` and `anthropic` hand the value to httpx and take a number of **seconds**; their
 * JavaScript clients take a number of **milliseconds**. And Python puts the option among the call's
 * keyword arguments, where the method signature declares it, while the JavaScript SDKs take it in a
 * second request options argument, after the body.
 *
 * `timeout=60.0` and `timeout: 60000` are therefore one deadline written twice, and reading either as a
 * bare number reports one of them as sixty milliseconds. Stated once here because every reader of a
 * provider SDK timeout has the same two ways to get it wrong.
 */
type TimeoutConvention = {
  readonly requestOptionIndex: number;
  readonly millisecondsPerUnit: number;
};

const PYTHON: TimeoutConvention = { requestOptionIndex: 0, millisecondsPerUnit: 1000 };
const JAVASCRIPT: TimeoutConvention = { requestOptionIndex: 1, millisecondsPerUnit: 1 };

const conventionFor = (language: Language): TimeoutConvention =>
  language === 'python' ? PYTHON : JAVASCRIPT;

const timeoutAt = (
  call: CallFact,
  argumentIndex: number,
  convention: TimeoutConvention,
): number | undefined => {
  const stated = numberValue(findEntry(objectArgument(call, argumentIndex), 'timeout')?.value);
  if (stated === undefined || stated <= 0) return undefined;
  return Math.round(stated * convention.millisecondsPerUnit);
};

/**
 * The deadline a client construction states, in milliseconds.
 *
 * Configuration is the first argument in both ecosystems: `AsyncOpenAI(timeout=60.0)` and
 * `new OpenAI({ timeout: 60000 })`.
 */
export const clientTimeoutMs = (call: CallFact, language: Language): number | undefined =>
  timeoutAt(call, 0, conventionFor(language));

/**
 * The deadline that governs one model call.
 *
 * The call's own timeout wins over its client's, because that is what the SDKs do with them: a per
 * request timeout overrides the client default for that request and leaves every other call alone.
 * A client whose deadline could not be resolved contributes nothing rather than a default, since a
 * number nobody wrote is not a declaration.
 */
export const modelCallDeadline = (
  call: CallFact,
  language: Language,
  clientMs: number | undefined,
): DeclaredDeadline | undefined => {
  const convention = conventionFor(language);
  const atCallSite = timeoutAt(call, convention.requestOptionIndex, convention);
  if (atCallSite !== undefined) return { timeoutMs: atCallSite, declaredAt: 'call site' };
  if (clientMs !== undefined) return { timeoutMs: clientMs, declaredAt: 'client' };
  return undefined;
};

/**
 * The deadline a relation standing for several calls may claim.
 *
 * One relation holds every call a function makes to one model, and a function that times one of its two
 * calls has not given the relation a deadline: a rule reading a number there would report the untimed
 * call as covered. So the relation claims one only when every call it stands for declares one.
 *
 * Where they declare different numbers the largest is the one carried, because reconciliation reads this
 * as the point past which an observed duration contradicts the declaration, and the shortest of several
 * deadlines would contradict a call that was written to be allowed to take longer.
 */
export const deadlineOfRelation = (
  deadlines: readonly (DeclaredDeadline | undefined)[],
): DeclaredDeadline | undefined => {
  if (deadlines.length === 0) return undefined;
  let widest: DeclaredDeadline | undefined;
  for (const deadline of deadlines) {
    if (deadline === undefined) return undefined;
    if (widest === undefined || deadline.timeoutMs > widest.timeoutMs) widest = deadline;
  }
  return widest;
};
