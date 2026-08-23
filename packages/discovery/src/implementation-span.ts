import type { ComponentIdentity, SourceLocation } from '@orchescope/schema';
import type { ArgumentFact, CallFact, ModuleFacts } from '@orchescope/source-analysis';

/**
 * The source range whose body implements a declared component.
 *
 * A tool is declared by a registration call and implemented by the handler that call is given. The two
 * are different facts and only the first was ever recorded, which left every tool a leaf: the write its
 * handler performs sat one frame away with nothing pointing at it, so the rule asking whether a model
 * can reach a consequential operation answered no on every repository it was ever run against.
 *
 * The span is recorded by whichever adapter reads the declaration, because only that adapter knows
 * which argument is the body. It is a claim, not a coincidence of line numbers: an adapter records a
 * span when it can say that the code in that range is what runs when the component is invoked.
 *
 * An inline function carries its own exact callable range. An identifier is accepted only when the
 * declaration settles to one function in the registration call's lexical scope. Configuration expressions
 * and nested callable declarations outside that exact range are not implementation behaviour.
 */
export type ImplementationSpan = {
  readonly identity: ComponentIdentity;
  readonly file: string;
  readonly body: SourceLocation;
  /** What the declaration called the thing, so a relation drawn from it names the declaration. */
  readonly symbol: string;
};

export type ImplementationSpanRegistry = {
  readonly record: (span: ImplementationSpan) => void;
  readonly all: () => readonly ImplementationSpan[];
};

/** Exact callable value a registration executes, never the wider configuration expression around it. */
export const implementationBody = (
  module: ModuleFacts,
  call: CallFact,
  value: ArgumentFact | undefined,
): SourceLocation | undefined => {
  if (value?.kind === 'function') return value.location;
  if (value?.kind === 'identifier') {
    const candidates = module.definitions.filter(
      (definition) =>
        definition.name === value.name &&
        definition.enclosing === call.enclosing &&
        (definition.kind === 'function' ||
          (definition.kind === 'variable' && definition.value?.kind === 'function')),
    );
    return candidates.length === 1 ? candidates[0]?.location : undefined;
  }
  return undefined;
};

export const createImplementationSpanRegistry = (): ImplementationSpanRegistry => {
  const spans: ImplementationSpan[] = [];
  return {
    record: (span) => {
      spans.push(span);
    },
    all: () => spans,
  };
};
