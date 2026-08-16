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
  | { readonly kind: 'object'; readonly entries: readonly ObjectEntryFact[] }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'null' }
  | { readonly kind: 'identifier'; readonly name: string }
  | { readonly kind: 'member'; readonly path: readonly string[] }
  | { readonly kind: 'array'; readonly items: readonly ArgumentFact[] }
  /** `args` carries what the call was given, which is where an SDK such as `openai('gpt-4o-mini')` puts the model. */
  | {
      readonly kind: 'call';
      readonly path: readonly string[];
      readonly args: readonly ArgumentFact[];
    }
  | { readonly kind: 'function' }
  | { readonly kind: 'template'; readonly value: string; readonly hasSubstitutions: boolean }
  | { readonly kind: 'unknown'; readonly nodeType: string };

export type ObjectEntryFact = {
  readonly key: string;
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
  readonly origin: CalleeOrigin | undefined;
  readonly args: readonly ArgumentFact[];
  readonly location: SourceLocation;
  readonly offset: number;
  /** Nearest named function, class or method the call sits inside. */
  readonly enclosing: string | undefined;
  /** True when the call is awaited, which distinguishes a scheduled call from a fired one. */
  readonly awaited: boolean;
};

export type ImportFact = {
  readonly module: string;
  readonly imported: string;
  readonly local: string;
  readonly isType: boolean;
  readonly location: SourceLocation;
};

export type DecoratorFact = {
  readonly path: readonly string[];
  readonly origin: CalleeOrigin | undefined;
  readonly args: readonly ArgumentFact[];
};

export type DefinitionFact = {
  readonly kind: 'function' | 'class' | 'variable' | 'method';
  readonly name: string;
  readonly exported: boolean;
  readonly async: boolean;
  readonly decorators: readonly DecoratorFact[];
  readonly location: SourceLocation;
  /** Dotted path of the initialiser call, when the definition is `const x = f(...)`. */
  readonly initializer: readonly string[] | undefined;
  readonly enclosing: string | undefined;
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
  readonly location: SourceLocation;
  /** The name this text belongs to: the constant or property holding it, or the function it is written inside. */
  readonly enclosing: string | undefined;
};

export type ControlFlowFact = {
  readonly kind: 'try_catch' | 'loop' | 'promise_all' | 'sequential_await';
  readonly location: SourceLocation;
  readonly enclosing: string | undefined;
  /** Callee paths that appear inside this construct, in source order. */
  readonly contains: readonly (readonly string[])[];
};

export type ModuleFacts = {
  readonly file: string;
  readonly language: Language;
  readonly contentHash: string;
  readonly imports: readonly ImportFact[];
  readonly exportedNames: readonly string[];
  readonly calls: readonly CallFact[];
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
