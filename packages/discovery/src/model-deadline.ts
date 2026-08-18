import type { EdgePolicy, Metadata } from '@orchescope/schema';
import type {
  ArgumentFact,
  CallFact,
  Language,
  ObjectEntryFact,
} from '@orchescope/source-analysis';
import { findEntry, numberValue, objectArgument } from '@orchescope/source-analysis';

/**
 * The deadline a model call declares, where it was declared, and how it was spelled.
 *
 * A timeout on the client covers every call made through it, a timeout on the call covers that call, and
 * a timeout on a request covers that request, so they are different facts about different populations
 * and a reader who cannot tell them apart cannot act on any of them. The relation carries the number;
 * this says where the number was read.
 *
 * `timeoutMs` is absent where the source states a deadline and settles no number for it. That is a
 * different fact from declaring none, and collapsing the two accuses a repository of having no deadline
 * because it wrote the number as a constant. The same distinction is why a tenacity `stop` this build
 * cannot read is recorded as bounded with no count.
 */
export type DeclaredDeadline = {
  readonly timeoutMs?: number;
  readonly declaredAt: 'call site' | 'client' | 'request';
  /** Which spelling stated it, for a deadline a request carries rather than a client or an SDK option. */
  readonly readFrom?: RequestDeadlineSpelling;
};

/**
 * How a request states its own deadline, which differs by ecosystem rather than by client.
 *
 * JavaScript has no timeout argument on `fetch` at all: the deadline is a signal that expires, and it is
 * the request's only way to state one. Python's clients take a `timeout` keyword and have no signal.
 * A remediation that names the wrong one of these tells a reader to reach for something their language
 * does not have, which is a goal nobody can complete.
 */
export type RequestDeadlineSpelling = 'abort signal' | 'timeout argument';

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

const statedMilliseconds = (
  value: ArgumentFact | undefined,
  convention: TimeoutConvention,
): number | undefined => {
  const stated = numberValue(value);
  if (stated === undefined || stated <= 0) return undefined;
  return Math.round(stated * convention.millisecondsPerUnit);
};

const timeoutAt = (
  call: CallFact,
  argumentIndex: number,
  convention: TimeoutConvention,
): number | undefined =>
  statedMilliseconds(findEntry(objectArgument(call, argumentIndex), 'timeout')?.value, convention);

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
 * The deadline a plain request states, for a model reached without an SDK.
 *
 * The question each spelling has to answer is whether the syntax establishes that a deadline exists at
 * all, separately from whether it settles the number, and the two ecosystems answer it differently.
 *
 * `AbortSignal.timeout(x)` establishes one whatever `x` is: expiry is the whole purpose of that
 * constructor and there is no argument that makes it something else. So a request built with it declares
 * a deadline, and the number is carried only when the argument is written as a literal. Reading it any
 * other way means a request whose duration is a named constant, which is how most repositories write it,
 * is reported as declaring nothing.
 *
 * A `timeout` keyword establishes nothing on its own, because `timeout=None` in Python and `timeout: 0`
 * in axios are both how a caller asks for no deadline. A literal settles it and a name does not, so a
 * number is required rather than merely a key.
 *
 * A signal from an `AbortController` is refused. What aborts that controller is written somewhere else,
 * and the commonest reason to hold one is a caller cancelling rather than a clock expiring, so reading
 * it as a deadline would claim a bound on the strength of a shape that frequently is not one.
 */
export const requestDeadline = (
  options: readonly ObjectEntryFact[],
  language: Language,
): DeclaredDeadline | undefined =>
  language === 'python' ? pythonRequestDeadline(options) : javaScriptRequestDeadline(options);

const ABORT_SIGNAL_TIMEOUT = 'AbortSignal.timeout';

const javaScriptRequestDeadline = (
  options: readonly ObjectEntryFact[],
): DeclaredDeadline | undefined => {
  const signal = findEntry(options, 'signal')?.value;
  if (signal?.kind === 'call' && signal.path.join('.') === ABORT_SIGNAL_TIMEOUT) {
    const stated = statedMilliseconds(signal.args[0], JAVASCRIPT);
    return {
      declaredAt: 'request',
      readFrom: 'abort signal',
      ...(stated === undefined ? {} : { timeoutMs: stated }),
    };
  }
  const stated = statedMilliseconds(findEntry(options, 'timeout')?.value, JAVASCRIPT);
  return stated === undefined
    ? undefined
    : { timeoutMs: stated, declaredAt: 'request', readFrom: 'timeout argument' };
};

/**
 * Whether a `timeout` holds the pair of numbers `requests` takes for connecting and for reading.
 *
 * Both phases are bounded, so a deadline exists and this is not the shape that would be a guess. Which
 * of the two bounds the request as a whole is not something the tuple settles, so no number is carried.
 */
const isPhasePair = (value: ArgumentFact | undefined): boolean =>
  value?.kind === 'array' &&
  value.items.length >= 2 &&
  value.items.every((item) => item.kind === 'number');

const pythonRequestDeadline = (
  options: readonly ObjectEntryFact[],
): DeclaredDeadline | undefined => {
  const stated = findEntry(options, 'timeout')?.value;
  if (isPhasePair(stated)) return { declaredAt: 'request', readFrom: 'timeout argument' };
  const timeoutMs = statedMilliseconds(stated, PYTHON);
  return timeoutMs === undefined
    ? undefined
    : { timeoutMs, declaredAt: 'request', readFrom: 'timeout argument' };
};

/**
 * The deadline a relation standing for several calls may claim.
 *
 * One relation holds every call a function makes to one model, and a function that times one of its two
 * calls has not given the relation a deadline: a rule reading a number there would report the untimed
 * call as covered. So the relation claims one only when every call it stands for declares one. The
 * builder merges two drafts for the same relation by union, which is why this is settled before any edge
 * is written rather than left to whichever call was read last.
 *
 * Where they declare different numbers the largest is the one carried, because reconciliation reads this
 * as the point past which an observed duration contradicts the declaration, and the shortest of several
 * deadlines would contradict a call that was written to be allowed to take longer. Where any of them
 * settles no number the relation carries none, since a call whose deadline nobody here can read may be
 * the longest of them.
 */
export const deadlineOfRelation = (
  deadlines: readonly (DeclaredDeadline | undefined)[],
): DeclaredDeadline | undefined => {
  if (deadlines.length === 0) return undefined;
  const declared: DeclaredDeadline[] = [];
  for (const deadline of deadlines) {
    if (deadline === undefined) return undefined;
    declared.push(deadline);
  }
  const widest = declared.reduce((carried, deadline) =>
    (deadline.timeoutMs ?? 0) > (carried.timeoutMs ?? 0) ? deadline : carried,
  );
  if (declared.every((deadline) => deadline.timeoutMs !== undefined)) return widest;
  const { timeoutMs: _unread, ...withoutNumber } = widest;
  return withoutNumber;
};

/**
 * How a relation records the deadline it was given.
 *
 * Both adapters that read a model call write this, and they have to write it identically: a rule reads
 * one field to decide whether a deadline was declared, so an adapter spelling it differently produces a
 * relation the rule cannot see into. The policy carries the number only where one was read, and the
 * metadata carries the declaration either way, which is what lets a rule tell a deadline it could not
 * measure from an absent one.
 */
export const deadlineOnRelation = (
  deadline: DeclaredDeadline | undefined,
): { readonly policy?: EdgePolicy; readonly metadata?: Metadata } => {
  if (deadline === undefined) return {};
  return {
    ...(deadline.timeoutMs === undefined ? {} : { policy: { timeoutMs: deadline.timeoutMs } }),
    metadata: {
      timeoutDeclaredAt: deadline.declaredAt,
      ...(deadline.readFrom === undefined ? {} : { timeoutReadFrom: deadline.readFrom }),
    },
  };
};
