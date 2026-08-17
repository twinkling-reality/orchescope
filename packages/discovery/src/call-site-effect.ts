import type { ComponentIdentity, SideEffectClass } from '@orchescope/schema';
import type { CallFact } from '@orchescope/source-analysis';

/**
 * The operation one call site produced.
 *
 * Discovery resolves a callee through the binding registry, which answers for a name someone declared
 * and answers nothing for `fetch(...)` written in place. Anything asking what a line of code reaches
 * was therefore blind to the plainer of the two spellings, even though the request at that line had
 * already been discovered, classified and given a component. A repository that injects its client so it
 * can be tested was more legible than one that does not, which is the wrong way round.
 *
 * Two readers have wanted this and each was found by a separate field report: a retry looking at the
 * call it repeats, and the join from a declared component to what its body reaches. Writing it down
 * once, where every adapter can ask, is what stops a third reader from having to discover it again.
 *
 * The index is complete rather than partial. Every call site that produced a component records it,
 * services and models and datastores alike, because an adapter written later inherits the answer rather
 * than having to know which half of the registry was ever wired.
 *
 * Keyed by the call's own offset rather than by its callee path, because a function that requests two
 * different hosts writes `fetch` at both of them and they are two operations.
 */
/**
 * What one call site produced: the component, and how this call was classified.
 *
 * The class travels with the call rather than being read back off the component, because a component
 * can stand for more than one call. A function that posts a job and then polls its status builds both
 * addresses at run time, so both requests are one component named for that function, and asking that
 * component what the poll does answers with the class of the POST.
 */
export type CallSiteOperation = {
  readonly identity: ComponentIdentity;
  readonly sideEffect: SideEffectClass | undefined;
};

export type CallSiteEffects = {
  readonly record: (
    file: string,
    call: CallFact,
    identity: ComponentIdentity,
    sideEffect?: SideEffectClass,
  ) => void;
  readonly at: (file: string, call: CallFact) => CallSiteOperation | undefined;
};

const key = (file: string, call: CallFact): string => `${file}#${call.offset}`;

export const createCallSiteEffects = (): CallSiteEffects => {
  const effects = new Map<string, CallSiteOperation>();
  return {
    record: (file, call, identity, sideEffect) => {
      effects.set(key(file, call), { identity, sideEffect });
    },
    at: (file, call) => effects.get(key(file, call)),
  };
};
