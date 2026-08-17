import type { ComponentIdentity } from '@orchescope/schema';
import type { CallFact } from '@orchescope/source-analysis';

/**
 * The operation one call site produced.
 *
 * Discovery resolves a callee through the binding registry, which answers for a name someone declared
 * and answers nothing for `fetch(...)` written in place. A retry wrapped around an inline request was
 * therefore invisible: the request had already been discovered, classified and given a component, and
 * the retry looking at the same line found no name to resolve and skipped it. The more common spelling
 * of a retry was the one that could not be seen, and a repository that injects its client so it can be
 * tested was more legible than one that does not, which is the wrong way round.
 *
 * Keyed by the call's own offset rather than by its callee path, because a function that requests two
 * different hosts writes `fetch` at both of them and they are two operations.
 */
export type CallSiteEffects = {
  readonly record: (file: string, call: CallFact, identity: ComponentIdentity) => void;
  readonly at: (file: string, call: CallFact) => ComponentIdentity | undefined;
};

const key = (file: string, call: CallFact): string => `${file}#${call.offset}`;

export const createCallSiteEffects = (): CallSiteEffects => {
  const effects = new Map<string, ComponentIdentity>();
  return {
    record: (file, call, identity) => {
      effects.set(key(file, call), identity);
    },
    at: (file, call) => effects.get(key(file, call)),
  };
};
