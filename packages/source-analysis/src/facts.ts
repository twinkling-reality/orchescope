import type { SourceLocation } from '@orchescope/schema';
import type { Language } from './language.ts';

/**
 * The language neutral fact model.
 *
 * Each file is parsed once and reduced to these facts. Discovery adapters then match against facts
 * rather than against an abstract syntax tree, which has three consequences worth stating: the parser
 * is an implementation detail of this package, adapters are pure functions that are trivial to test,
 * and a Python keyword argument and a JavaScript object literal property are the same shape, so one
 * matching rule covers both ecosystems.
 */

export type ArgumentFact =
  | {
      readonly kind: 'object';
      readonly entries: readonly ObjectEntryFact[];
      /** Python's synthetic keyword bundle, distinct from a positional dictionary value. */
      readonly role?: 'keywords';
      /** Exact spread operands retained even though their eventual keys may be computed. */
      readonly spreads?: readonly ObjectSpreadFact[];
      /** False when a spread or computed key means the retained entries are not the whole object. */
      readonly complete?: boolean;
    }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'null' }
  | { readonly kind: 'identifier'; readonly name: string }
  | { readonly kind: 'member'; readonly path: readonly string[] }
  | {
      /** Bounded alternatives written by a short-circuiting source selection. */
      readonly kind: 'selection';
      readonly operator: 'or';
      readonly alternatives: readonly SourceChoiceFact[];
      /** False when the retained alternatives are not the whole expression. */
      readonly complete: boolean;
    }
  | {
      readonly kind: 'array';
      readonly items: readonly ArgumentFact[];
      /** False when a spread means the retained items are not the whole array. */
      readonly complete?: boolean;
    }
  /** `args` carries what the call was given, which is where an SDK such as `openai('gpt-4o-mini')` puts the model. */
  | {
      readonly kind: 'call';
      readonly path: readonly string[];
      readonly args: readonly ArgumentFact[];
    }
  | { readonly kind: 'function'; readonly location: SourceLocation }
  | {
      readonly kind: 'template';
      readonly value: string;
      readonly hasSubstitutions: boolean;
      /**
       * The names this template substitutes, which is what says how a value was assembled.
       *
       * A prompt written as a constant and spliced into a message at the call site is two literals that
       * each say nothing on their own: the constant interpolates nothing, and the template that puts the
       * untrusted value beside it is too short to be a prompt. What the template names is the only thing
       * that puts the two halves back together.
       */
      readonly substitutedNames?: readonly string[];
      /** False means the bounded name list omitted at least one substitution. */
      readonly substitutionsComplete?: boolean;
    }
  /**
   * A value computed from other values, flattened to the operators used and the names read.
   *
   * The operator is the fact worth keeping. `sleep(base * 2 ** (attempt - 1))` is an exponential backoff
   * and `sleep(500)` is a fixed one, and the difference is written in the syntax. Reduced to `unknown` it
   * meant every discovered retry declared `backoff: 'unknown'`, including the ones whose growth is spelled
   * out one line below the request they protect.
   */
  | {
      readonly kind: 'arithmetic';
      readonly operators: readonly string[];
      readonly names: readonly string[];
    }
  | { readonly kind: 'unknown'; readonly nodeType: string };

export type ObjectEntryFact = {
  readonly key: string;
  readonly value: ArgumentFact;
  readonly location: SourceLocation;
};

export type ObjectSpreadFact = {
  readonly value: ArgumentFact;
  readonly location: SourceLocation;
};

export type SourceChoiceFact = {
  readonly value: ArgumentFact;
  readonly location: SourceLocation;
};

export type CallKind = 'call' | 'new' | 'decorator';

export type CalleeOrigin = {
  /** Package or module the callee's root binding was imported from. */
  readonly module: string;
  /** Name as exported by that module, or `*` for a namespace import. */
  readonly imported: string;
  readonly isType: boolean;
};

export type CallFact = {
  readonly kind: CallKind;
  /** Callee as a dotted path, for example `["client","chat","completions","create"]`. */
  readonly calleePath: readonly string[];
  /** True when this call invokes the result of another call, such as `factory()()`. */
  readonly invokesReturnedCallable?: true;
  readonly origin: CalleeOrigin | undefined;
  readonly args: readonly ArgumentFact[];
  readonly location: SourceLocation;
  readonly offset: number;
  /** Nearest named function, class or method the call sits inside. */
  readonly enclosing: string | undefined;
  /** Exact nearest callable range, used only to prove lexical containment and never as graph identity. */
  readonly enclosingLocation?: SourceLocation;
  /** True when a callable boundary exists but source gives it no authoritative name. */
  readonly enclosingUnresolved?: true;
  /** Named outer lexical scope retained for binding lookup when the immediate callable is unresolved. */
  readonly lexicalEnclosing?: string;
  /** Exact callable scopes containing this call, outermost first. Never used in graph identity. */
  readonly lexicalScopes?: readonly LexicalScopeFact[];
  /** Bindings declared by that unresolved callable which prevent fallback to the outer lexical scope. */
  readonly lexicalShadows?: readonly string[];
  /** Conditional branches that must run for this call to be reached, outermost first. */
  readonly branches?: readonly BranchPredicateFact[];
  /** True when the call is awaited, which distinguishes a scheduled call from a fired one. */
  readonly awaited: boolean;
};

export type LexicalScopeFact = {
  readonly location: SourceLocation;
  /** Parameters, declarations and writes that stop lookup from falling through this scope. */
  readonly bindings: readonly string[];
};

export type ImportFact = {
  readonly module: string;
  readonly imported: string;
  readonly local: string;
  readonly isType: boolean;
  readonly location: SourceLocation;
  /** Nearest function, class or method whose runtime scope owns this import. */
  readonly enclosing?: string;
};

export type DecoratorFact = {
  readonly path: readonly string[];
  readonly origin: CalleeOrigin | undefined;
  readonly args: readonly ArgumentFact[];
  /** Exact decorator expression establishing this callable annotation. */
  readonly location: SourceLocation;
};

export type DefinitionFact = {
  readonly kind: 'function' | 'class' | 'variable' | 'method';
  readonly name: string;
  readonly exported: boolean;
  readonly async: boolean;
  /** True when the callable contains a yield in its own body and therefore returns a generator. */
  readonly generator?: true;
  /** Python binding directive governing this definition when it writes an outer scope. */
  readonly bindingScope?: 'global' | 'nonlocal';
  /** Named callable scope targeted by `nonlocal`; absent for a `global` module binding. */
  readonly bindingOwner?: string;
  /** Exact callable range that owns this local binding; absent for a module binding. */
  readonly lexicalOwnerLocation?: SourceLocation;
  /** Exact callable range targeted by `nonlocal`; absent for a `global` module binding. */
  readonly bindingOwnerLocation?: SourceLocation;
  readonly decorators: readonly DecoratorFact[];
  readonly location: SourceLocation;
  /** Dotted path of the initialiser call, when the definition is `const x = f(...)`. */
  readonly initializer: readonly string[] | undefined;
  /**
   * Reduced right hand side of a variable binding.
   *
   * This is a source fact, not substitution. A consumer may follow it only after proving that the
   * binding is unique and unchanged at the use site. Keeping the value here lets one bounded resolver
   * treat an inline request object and the same object assigned one line above alike without teaching
   * an adapter either language's syntax.
   */
  readonly value?: ArgumentFact;
  /**
   * Names the initialiser takes its value from, when it takes it from a name rather than by calling one.
   *
   * `const fetchImpl = opts.fetchImpl ?? fetch` is how a module is written so that its network client can
   * be replaced in a test, and it is the shape that made such a module invisible: adapters match a client
   * by the callee path, `fetchImpl` is not `fetch`, and the request, its method and the retry around it
   * were all discovered for the modules that call `fetch` directly and for no others. That inverts the
   * incentive, because the code written to be testable is the code that cannot be seen.
   *
   * Every candidate is recorded rather than one. `a ?? b`, `a || b` and a ternary each offer more than one
   * name and the syntax does not say which is taken, so choosing would be a guess where listing is a fact.
   */
  readonly aliasedFrom?: readonly (readonly string[])[];
  /**
   * The literals this definition binds to the name, when it binds any.
   *
   * `agents_config = 'config/agents.yaml'` in a `@CrewBase` class names the document every agent in that crew
   * is configured from, and it was the one step of that chain the model did not carry: `initializer` records a
   * dotted path when the right hand side is a call and there was no field for a value at all, so a class
   * attribute holding a path was a definition with a location and nothing in it.
   *
   * Recorded and never substituted, which is the whole of what makes it safe. "The class body writes this
   * literal to this name at this line" is unconditionally true. "This name holds this literal where it is
   * read" is not, and `@CrewBase` is the case that proves it, because the decorator replaces the attribute
   * before any method runs. `initializer` stays beside this so a rebinding by a call is visible rather than
   * hidden behind a value.
   *
   * Every literal the binding offers is listed rather than one, for the reason `aliasedFrom` gives above:
   * `a or 'b'` and a conditional expression each offer more than one and the syntax does not say which is
   * taken, so choosing would be a guess where listing is a fact.
   */
  readonly literals?: readonly ArgumentFact[];
  /**
   * Bounded control-flow facts declared by a function.
   *
   * These stay on the definition because a return belongs to the function whose contract it helps
   * describe. Literal annotations and literal return statements are recorded independently: agreement is
   * evidence that a bounded router was resolved, while disagreement is evidence that it was not. Dynamic
   * returns are retained as non-literal values instead of disappearing.
   */
  readonly returnAnnotation?: ReturnAnnotationFact;
  readonly returns?: readonly ReturnFact[];
  /** Direct parameters declared by a callable definition. An annotation is retained when it is written. */
  readonly parameters?: readonly ParameterFact[];
  readonly enclosing: string | undefined;
  /** Exact containing callable range when its semantic name is unavailable or insufficient for lexical scope. */
  readonly enclosingLocation?: SourceLocation;
  /** True when the containing callable exists but has no authoritative semantic name. */
  readonly enclosingUnresolved?: true;
  /** Conditional branches that must run for this definition to be reached, outermost first. */
  readonly branches?: readonly BranchPredicateFact[];
};

export type ParameterFact = {
  readonly name: string;
  /** Dotted type name written in the annotation. Generic arguments are not inferred. */
  readonly annotation?: readonly string[];
  /** Reduced default expression when the declaration captures one. */
  readonly defaultValue?: ArgumentFact;
  readonly location: SourceLocation;
};

export type LiteralDestinationFact = {
  readonly value: string;
  readonly location: SourceLocation;
};

export type ReturnAnnotationFact = {
  /** Every literal string inside a `Literal[...]` return annotation. */
  readonly destinations: readonly LiteralDestinationFact[];
  /** Exact annotation range, retained even when the annotation is not a supported literal form. */
  readonly location: SourceLocation;
  /** False when the annotation contains any form other than bounded literal strings. */
  readonly complete: boolean;
};

export type BranchPredicateFact = {
  readonly operator: string;
  readonly references: readonly (readonly string[])[];
  readonly location: SourceLocation;
  readonly branch: 'consequence' | 'alternative';
};

export type ReturnFact = {
  readonly value: ArgumentFact;
  readonly location: SourceLocation;
  /** Nearest branch deciding whether this return runs, when the syntax states one. */
  readonly predicate?: BranchPredicateFact;
};

export type EnvironmentFact = {
  readonly name: string;
  readonly location: SourceLocation;
  readonly enclosing: string | undefined;
};

/** A string long enough to be a prompt or an instruction rather than an identifier. */
export type TextFact = {
  readonly value: string;
  readonly approximateTokens: number;
  readonly hasSubstitutions: boolean;
  /**
   * The names this template substitutes, when it substitutes any.
   *
   * A prompt is often written as a constant and assembled somewhere else, and reading each literal on its
   * own loses the assembly: the constant interpolates nothing and the template that splices it is too
   * short to be a prompt, so the prompt was recorded as one that takes no run time value while the value
   * went in four lines away. What a template names is what lets the two halves be put back together.
   *
   * Bounded, because a template can substitute as much as anyone cares to put in it.
   */
  readonly substitutedNames?: readonly string[];
  readonly location: SourceLocation;
  /** The name this text belongs to: the constant or property holding it, or the function it is written inside. */
  readonly enclosing: string | undefined;
};

export type ControlFlowFact = {
  readonly kind: 'try_catch' | 'loop' | 'promise_all' | 'sequential_await';
  readonly location: SourceLocation;
  readonly enclosing: string | undefined;
  /** Exact nearest callable range, used only for lexical ambiguity settlement. */
  readonly enclosingLocation?: SourceLocation;
  /** True when the construct sits inside a callable whose source name cannot be settled. */
  readonly enclosingUnresolved?: true;
  /** Callee paths that appear inside this construct, in source order. */
  readonly contains: readonly (readonly string[])[];
  /**
   * For a loop, whether each pass does the same work again or takes the next item.
   *
   * This is the fact that separates a retry from an iteration, and reading a loop without it is how a
   * `for (const device of page) { try { ... } catch { ... } }` came to be reported as a retry around a
   * non idempotent operation. Every pass of that loop acts on a different device: there is no re-attempt
   * of anything, and the per item catch is error isolation rather than recovery. It is recorded as a
   * property of the loop's form rather than decided later, because the form is the fact.
   */
  readonly repeats?: 'same_work' | 'each_item';
  /**
   * For a loop, the identifiers its header names.
   *
   * A retry counts attempts in the header: `for (let attempt = 0; attempt < MAX; attempt += 1)`. What that
   * counter is called is the author's word for what the loop is doing, and it is the only place in the
   * syntax where a loop says it is re-attempting rather than iterating. Bounded, because a header can name
   * as much as anyone cares to put in it.
   */
  readonly headerNames?: readonly string[];
  /**
   * For a loop, whether the header itself advances a bounded/counting pass variable.
   *
   * `for (let attempt = 0; ...; attempt += 1)` and `for attempt in range(...)` make each pass an
   * explicitly counted attempt. A `while` condition can mention `attempts` while polling an expected
   * pending state; the name alone does not turn that protocol loop into a retry. Keeping the loop form
   * beside the names prevents those two statements from being collapsed later.
   */
  readonly countsPasses?: boolean;
  /**
   * For a loop, names it multiplies or exponentiates on each pass.
   *
   * A wait that grows is usually written at the call, `sleep(100 * 2 ** attempt)`, and is sometimes
   * written beside it: `await sleep(delayMs)` followed by `delayMs *= 2` is the same backoff with the
   * growth one statement away. The call site alone cannot tell the two apart, so the loop records which
   * of its names grow and the reader joins them up. Without it a real exponential backoff was reported
   * as `unknown`, which reads as a gap in the reading rather than as a fact about the code.
   */
  readonly growingNames?: readonly string[];
  /**
   * For a `try`, whether its guarded body ends the work and its handler lets it carry on.
   *
   * This is the shape of one attempt: a pass that succeeds returns, and a pass that fails falls through
   * to whatever comes next. Inside a loop that repeats the same work, that is a retry and there is
   * nothing else it can be, which is what lets a counting loop be read as re-attempting when its author
   * called the counter `i` and wrote no wait. A handler that returns as well is a single attempt with a
   * fallback, and a loop around it runs once.
   */
  readonly exitsOnSuccess?: boolean;
  /**
   * For a loop, whether its own form limits how many passes it makes.
   *
   * `for _ in range(10)` and `for (let i = 0; i < 3; i += 1)` state a ceiling in the syntax; `while` and
   * `for (;;)` do not. A retry that was reported as having no attempt limit turned out to be a poll bounded
   * by `range(self.max_polling_time)`, which the syntax had said all along.
   */
  readonly passesBounded?: boolean;
};

/**
 * A value written onto something that already exists.
 *
 * A constructor argument is not the only way a repository declares a relation, and for a cycle it cannot be: an agent
 * cannot name a peer that is not constructed yet, so the wiring is written afterwards. The customer service demo
 * declares `handoffs=[]` on its triage agent and then assigns five of them on the next line, which read as an agent
 * that hands off to nobody until a run said otherwise.
 *
 * The target is the dotted path written on the left, so `triage_agent.handoffs` arrives as two segments and a reader
 * can ask which name it belongs to. The value is reduced the same way a call argument is, because it is the same
 * grammar: a list, an identifier, a call, or a literal. Appending and extending are calls and are already recorded as
 * calls, so this is only the shape that is not one. JavaScript and TypeScript root reassignments are retained too:
 * `graph = replacement` is evidence that a constructor's provider identity no longer authorizes subsequent calls through
 * that binding. Initial declarations remain DefinitionFacts.
 */
export type AssignmentFact = {
  readonly target: readonly string[];
  /** True when any part of the written target used a subscript rather than direct member access. */
  readonly targetIncludesSubscript?: true;
  readonly value: ArgumentFact;
  /** Names read by a destructuring right-hand side whose per-target value cannot be settled exactly. */
  readonly sourceReferences?: readonly (readonly string[])[];
  /** Python binding directive governing this write when it targets an outer scope. */
  readonly bindingScope?: 'global' | 'nonlocal';
  /** Named callable scope targeted by `nonlocal`; absent for a `global` module binding. */
  readonly bindingOwner?: string;
  /** Exact callable range that owns this write; absent for a module-level write. */
  readonly lexicalOwnerLocation?: SourceLocation;
  /** Exact callable range targeted by `nonlocal`; absent for a `global` module binding. */
  readonly bindingOwnerLocation?: SourceLocation;
  readonly location: SourceLocation;
  /** A delete is retained as a write that removes the target rather than assigning the reduced value. */
  readonly operation?: 'delete';
  /** Nearest named lexical scope, absent for a module-level write. */
  readonly enclosing?: string;
  /** Exact containing callable range, retained only for lexical binding settlement. */
  readonly enclosingLocation?: SourceLocation;
  /** True when the containing callable exists but has no authoritative semantic name. */
  readonly enclosingUnresolved?: true;
};

export type ModuleFacts = {
  readonly file: string;
  readonly language: Language;
  readonly contentHash: string;
  readonly imports: readonly ImportFact[];
  readonly exportedNames: readonly string[];
  readonly calls: readonly CallFact[];
  readonly assignments: readonly AssignmentFact[];
  readonly definitions: readonly DefinitionFact[];
  readonly environmentRefs: readonly EnvironmentFact[];
  readonly texts: readonly TextFact[];
  readonly controlFlow: readonly ControlFlowFact[];
  readonly parseErrors: readonly string[];
};

/** Minimum characters before a literal is recorded as a candidate prompt. */
export const TEXT_FACT_MIN_LENGTH = 40;

/** Rough token estimate used only for reporting relative prompt size, never for billing. */
export const approximateTokens = (text: string): number => Math.ceil(text.length / 4);

/**
 * Whether this value is written out in the source rather than computed, named or called.
 *
 * A template counts only where it substitutes nothing: `f"config/{name}.yaml"` is a path the program assembles
 * and `f"config/agents.yaml"` is a path the author typed, and the difference is the whole question.
 */
export const isLiteralFact = (fact: ArgumentFact): boolean =>
  fact.kind === 'string' ||
  fact.kind === 'number' ||
  fact.kind === 'boolean' ||
  fact.kind === 'null' ||
  (fact.kind === 'template' && !fact.hasSubstitutions);

export const findEntry = (
  entries: readonly ObjectEntryFact[],
  key: string,
): ObjectEntryFact | undefined => entries.find((entry) => entry.key === key);

export const objectArgument = (call: CallFact, index = 0): readonly ObjectEntryFact[] => {
  const argument = call.args[index];
  return argument !== undefined && argument.kind === 'object' ? argument.entries : [];
};

export const stringValue = (value: ArgumentFact | undefined): string | undefined => {
  if (value === undefined) return undefined;
  if (value.kind === 'string') return value.value;
  if (value.kind === 'template' && !value.hasSubstitutions) return value.value;
  return undefined;
};

export const numberValue = (value: ArgumentFact | undefined): number | undefined =>
  value !== undefined && value.kind === 'number' ? value.value : undefined;

export const booleanValue = (value: ArgumentFact | undefined): boolean | undefined =>
  value !== undefined && value.kind === 'boolean' ? value.value : undefined;

export const identifierItems = (value: ArgumentFact | undefined): readonly string[] => {
  if (value === undefined || value.kind !== 'array') return [];
  const names: string[] = [];
  for (const item of value.items) {
    if (item.kind === 'identifier') names.push(item.name);
    else if (item.kind === 'member') {
      const last = item.path[item.path.length - 1];
      if (last !== undefined) names.push(last);
    } else if (item.kind === 'call') {
      const last = item.path[item.path.length - 1];
      if (last !== undefined) names.push(last);
    } else if (item.kind === 'string') names.push(item.value);
  }
  return names;
};

export const calleeName = (call: CallFact): string =>
  call.calleePath[call.calleePath.length - 1] ?? '';

export const calleeRoot = (call: CallFact): string => call.calleePath[0] ?? '';

export const dotted = (path: readonly string[]): string => path.join('.');
