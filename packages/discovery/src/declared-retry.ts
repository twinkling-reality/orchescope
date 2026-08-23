import type {
  ArgumentFact,
  CallFact,
  DecoratorFact,
  DefinitionFact,
  ModuleFacts,
} from '@orchescope/source-analysis';
import { calleeName, findEntry, numberValue, objectArgument } from '@orchescope/source-analysis';
import { importsAny, matchRuntimeSymbol } from './matching.ts';

/**
 * A retry a library declares, rather than one a repository writes out as a loop.
 *
 * Everything else here reads a retry from its shape: a loop that repeats the same work, a counter in a
 * header, a wait before the next pass. Tenacity states the whole policy in its arguments instead, and
 * neither of the forms it documents has a shape to read. `async for attempt in AsyncRetrying(...)` is
 * syntactically an iteration over an object, so the loop reader saw each pass taking the next item; and
 * `@retry(...)` above a function is no loop at all. A retrieval application wrapping fifteen attempts
 * around a model call and an image describe call had all three retry rules report that no retry had been
 * examined.
 *
 * What the arguments say is stated fact and not inference, which is the whole reason this is worth
 * reading: `stop_after_attempt(15)` is an attempt ceiling of fifteen and `wait_random_exponential` is an
 * exponential backoff, in a way that a counter called `i` and a `sleep` of unknown growth never are.
 *
 * The two defaults are stated by the library and are read as facts about the code rather than as gaps in
 * this reading. A tenacity retry with no `stop` retries forever, and one with no `wait` re-attempts with
 * no pause at all. Both are the dangerous answer, and both are what the author wrote.
 */

export type DeclaredRetry = {
  readonly maxAttempts: number | undefined;
  readonly bounded: boolean;
  readonly backoff: 'none' | 'fixed' | 'exponential' | 'unknown';
  /** How the declaration reads, for the sentence a rule prints back to whoever has to check it. */
  readonly declaredAs: string;
};

const TENACITY_PACKAGES = ['tenacity'];

/** The two objects tenacity documents for retrying a block rather than a function. */
const RETRY_CONSTRUCTORS = new Set(['Retrying', 'AsyncRetrying']);

const EXPONENTIAL_WAITS = new Set([
  'wait_exponential',
  'wait_random_exponential',
  'wait_exponential_jitter',
]);
const FIXED_WAITS = new Set(['wait_fixed']);
const NO_WAIT = new Set(['wait_none']);

/** The callee of an argument that is itself a call, which is how tenacity states every part of a policy. */
const calledAs = (value: ArgumentFact | undefined): string | undefined =>
  value?.kind === 'call' ? value.path[value.path.length - 1] : undefined;

/** A bare name, which is how `stop_never` and a policy held in a constant are written. */
const namedAs = (value: ArgumentFact | undefined): string | undefined => {
  if (value?.kind === 'identifier') return value.name;
  if (value?.kind === 'member') return value.path[value.path.length - 1];
  return undefined;
};

type Ceiling = { readonly maxAttempts: number | undefined; readonly bounded: boolean };

/**
 * What the `stop` argument says about how many attempts there may be.
 *
 * Three answers and they are not the same. An absent `stop` is tenacity's documented default of retrying
 * forever, so it is read as unbounded. `stop_never` says the same thing in the author's own hand. And a
 * `stop` this build cannot read is a condition somebody stated, so it is recorded as bounded without a
 * count: calling it unbounded would accuse a repository of something on the strength of a spelling that
 * was not recognised, which is the one direction a reader cannot check.
 */
const ceilingOf = (stop: ArgumentFact | undefined): Ceiling => {
  if (stop === undefined) return { maxAttempts: undefined, bounded: false };
  if (namedAs(stop) === 'stop_never') return { maxAttempts: undefined, bounded: false };
  if (calledAs(stop) !== 'stop_after_attempt') return { maxAttempts: undefined, bounded: true };
  const args = stop.kind === 'call' ? stop.args : [];
  const stated =
    numberValue(args[0]) ??
    numberValue(
      findEntry(args[0]?.kind === 'object' ? args[0].entries : [], 'max_attempt_number')?.value,
    );
  return { maxAttempts: stated, bounded: true };
};

/**
 * What the `wait` argument says about the pause between attempts.
 *
 * An absent `wait` is `wait_none`, which tenacity documents as its default, so a retry that states no
 * wait re-attempts as fast as its dependency can fail. That is a fact about the code and is recorded as
 * `none`; a wait written in a spelling this does not know stays `unknown`, which reads as the gap in this
 * reading that it is.
 */
const backoffOf = (wait: ArgumentFact | undefined): DeclaredRetry['backoff'] => {
  if (wait === undefined) return 'none';
  const called = calledAs(wait) ?? namedAs(wait);
  if (called === undefined) return 'unknown';
  if (EXPONENTIAL_WAITS.has(called)) return 'exponential';
  if (FIXED_WAITS.has(called)) return 'fixed';
  if (NO_WAIT.has(called)) return 'none';
  return 'unknown';
};

const policyFrom = (
  entries: ReturnType<typeof objectArgument>,
  declaredAs: string,
): DeclaredRetry => {
  const ceiling = ceilingOf(findEntry(entries, 'stop')?.value);
  return {
    ...ceiling,
    backoff: backoffOf(findEntry(entries, 'wait')?.value),
    declaredAs,
  };
};

/** Whether this module can be talking about tenacity at all, which is what keeps a common word precise. */
export const usesTenacity = (module: ModuleFacts): boolean => importsAny(module, TENACITY_PACKAGES);

/**
 * The retry a `Retrying` or `AsyncRetrying` construction declares.
 *
 * Answers only for a construction that states a policy. `Retrying(some_function)` hands tenacity the work
 * as an argument and is the helper form, which is read elsewhere and by its wrapped operation.
 */
export const constructedRetry = (
  modules: readonly ModuleFacts[],
  module: ModuleFacts,
  call: CallFact,
): DeclaredRetry | undefined => {
  const matched = matchRuntimeSymbol(
    modules,
    module,
    {
      path: call.calleePath,
      origin: call.origin,
      enclosing: call.enclosing,
      location: call.location,
    },
    { names: [...RETRY_CONSTRUCTORS], packages: TENACITY_PACKAGES },
  );
  if (matched === undefined) return undefined;
  const entries = objectArgument(call);
  if (entries.length === 0) return undefined;
  return policyFrom(entries, `a loop over tenacity's ${calleeName(call)}`);
};

/** Whether a callee path names one of the constructions above, asked of a loop's contents. */
export const namesRetryConstructor = (path: readonly string[]): boolean => {
  const last = path[path.length - 1];
  return last !== undefined && RETRY_CONSTRUCTORS.has(last);
};

/**
 * The retry a `@retry` decorator declares over the function it is written above.
 *
 * `retry` is too common a word to match on its own, so the decorator has to have come from tenacity: by
 * the import its name resolves through, by being written `tenacity.retry`, or failing both by sitting in
 * a module that imports tenacity at all. A bare `@retry` with no arguments is tenacity's documented
 * shorthand and declares its defaults, which are to retry forever with no wait.
 */
export const decoratedRetry = (
  modules: readonly ModuleFacts[],
  module: ModuleFacts,
  definition: DefinitionFact,
  decorator: DecoratorFact,
): DeclaredRetry | undefined => {
  const matched = matchRuntimeSymbol(
    modules,
    module,
    {
      path: decorator.path,
      origin: decorator.origin,
      enclosing: definition.enclosing,
      location: decorator.location,
    },
    { names: ['retry'], packages: TENACITY_PACKAGES },
  );
  if (matched === undefined) return undefined;
  const entries = decorator.args[0]?.kind === 'object' ? decorator.args[0].entries : [];
  return policyFrom(entries, "a function decorated with tenacity's retry");
};
