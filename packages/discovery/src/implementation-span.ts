import type { ComponentIdentity, SourceLocation } from '@orchescope/schema';

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
 * A registration call's own range is used where the handler is an inline function, since an anonymous
 * function argument carries no location of its own in the fact model. That range also holds the
 * declaration's configuration object, which is a wider net than the body alone and is bounded by what a
 * registration call contains.
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

export const createImplementationSpanRegistry = (): ImplementationSpanRegistry => {
  const spans: ImplementationSpan[] = [];
  return {
    record: (span) => {
      spans.push(span);
    },
    all: () => spans,
  };
};
