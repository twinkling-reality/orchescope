import type { SourceLocation } from '@orchescope/schema';
import type { Node } from 'web-tree-sitter';
import {
  type ArgumentFact,
  type AssignmentFact,
  approximateTokens,
  type BranchPredicateFact,
  type CalleeOrigin,
  type CallFact,
  type ControlFlowFact,
  type DecoratorFact,
  type DefinitionFact,
  type EnvironmentFact,
  type ImportFact,
  isLiteralFact,
  type ModuleFacts,
  type ObjectEntryFact,
  type ObjectSpreadFact,
  type ParameterFact,
  type ReturnAnnotationFact,
  type ReturnFact,
  TEXT_FACT_MIN_LENGTH,
  type TextFact,
} from '../facts.ts';
import { pythonParser } from './runtime.ts';

/**
 * Python fact extraction with tree-sitter.
 *
 * Keyword arguments are folded into a single synthetic object argument appended after the positional
 * arguments, so that `Agent(name="triage", tools=[...])` and `new Agent({ name: 'triage', tools: [] })`
 * produce the same fact shape and one discovery rule covers both ecosystems.
 *
 * Positions come from tree-sitter row and column values rather than byte offsets, which avoids the
 * UTF-8 against UTF-16 offset mismatch entirely.
 */

const location = (file: string, node: Node): SourceLocation => ({
  file,
  startLine: node.startPosition.row + 1,
  startColumn: node.startPosition.column,
  endLine: node.endPosition.row + 1,
  endColumn: node.endPosition.column,
});

/**
 * The children that are part of the program, which excludes what is only written beside it.
 *
 * The parser reports a comment as a named child, so anything reading a sequence of children by position
 * counted one. An argument list with a note in it moved every argument after the note along by a slot,
 * and `create(  # Azure OpenAI takes the deployment name as the model name` put the whole keyword object
 * at index one, where no adapter looks. Two of the provider call sites in one field report's target
 * repository were unreadable for that reason alone, and the report of what they configure was a report
 * about a comment.
 */
const namedChildren = (node: Node): readonly Node[] => {
  const children: Node[] = [];
  for (let index = 0; index < node.namedChildCount; index += 1) {
    const child = node.namedChild(index);
    if (child !== null && child.type !== 'comment') children.push(child);
  }
  return children;
};

const childField = (node: Node, name: string): Node | undefined =>
  node.childForFieldName(name) ?? undefined;

/**
 * Every child under one field name, which is how a subscript says how many keys were written.
 *
 * `d['a']` and `d['a', 'b']` are both a `subscript` node and only the count separates them. Reading the
 * first child of a repeated field would take `a` from both, which is a guess wearing the shape of a fact.
 * The nodes a query returns are fresh wrappers rather than the ones a field lookup returns, so they cannot
 * be told apart from the value by identity, and asking for the field by name is what avoids needing to.
 */
const childFields = (node: Node, name: string): readonly Node[] => {
  const children: Node[] = [];
  for (const child of node.childrenForFieldName(name)) {
    if (child !== null && child.type !== 'comment') children.push(child);
  }
  return children;
};

/** Strips the quotes and prefix from a Python string literal without evaluating escapes. */
const stringLiteralValue = (node: Node): string | undefined => {
  if (node.type !== 'string') return undefined;
  const parts: string[] = [];
  for (const child of namedChildren(node)) {
    if (child.type === 'string_content') parts.push(child.text);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: this is the marker recorded in place of a substitution
    else if (child.type === 'interpolation') parts.push('${...}');
  }
  if (parts.length > 0) return parts.join('');
  const raw = node.text;
  const match = /^[a-zA-Z]*('''|"""|'|")([\s\S]*)\1$/.exec(raw);
  return match?.[2] ?? undefined;
};

const hasInterpolation = (node: Node): boolean =>
  namedChildren(node).some((child) => child.type === 'interpolation');

/** Enough of an f-string to recognise which prompt it is splicing. */
const MAX_SUBSTITUTED_NAMES = 8;

/** The names an f-string substitutes, which is what says how a value was assembled. */
const substitutionsIn = (
  node: Node,
): { readonly names: readonly string[]; readonly complete: boolean } => {
  const names = new Set<string>();
  const walk = (candidate: Node): void => {
    if (names.size > MAX_SUBSTITUTED_NAMES) return;
    if (candidate.type === 'identifier') {
      names.add(candidate.text);
      return;
    }
    for (const child of candidate.namedChildren) walk(child);
  };
  for (const child of namedChildren(node)) {
    if (child.type === 'interpolation') walk(child);
  }
  return {
    names: [...names].slice(0, MAX_SUBSTITUTED_NAMES),
    complete: names.size <= MAX_SUBSTITUTED_NAMES,
  };
};

const attributePath = (node: Node): readonly string[] => {
  if (node.type === 'identifier') return [node.text];
  if (node.type === 'attribute') {
    const object = childField(node, 'object');
    const attribute = childField(node, 'attribute');
    if (object === undefined || attribute === undefined) return [];
    const prefix = attributePath(object);
    if (prefix.length === 0) return [];
    return [...prefix, attribute.text];
  }
  if (node.type === 'call') {
    const callee = childField(node, 'function');
    return callee === undefined ? [] : attributePath(callee);
  }
  if (node.type === 'subscript') {
    const value = childField(node, 'value');
    return value === undefined ? [] : attributePath(value);
  }
  return [];
};

type Context = {
  readonly file: string;
  readonly bindings: Map<string, CalleeOrigin>;
  readonly imports: ImportFact[];
  readonly calls: CallFact[];
  readonly assignments: AssignmentFact[];
  readonly definitions: DefinitionFact[];
  readonly environmentRefs: EnvironmentFact[];
  readonly texts: TextFact[];
  readonly controlFlow: ControlFlowFact[];
  readonly documentationOffsets: Set<number>;
};

/**
 * String leaves that make one Python documentation expression.
 *
 * Python gives a string a documentation role only when the first statement of a module, class or
 * function suite is a string constant. That is syntax, not prose: a docstring may say "system prompt",
 * while an assigned triple-quoted value may say the same words and still be a value the program uses.
 * Parentheses and adjacent literals preserve the constant; byte strings and interpolated strings do not.
 */
const documentationStringLeaves = (node: Node): readonly Node[] | undefined => {
  if (node.type === 'string') {
    const prefix = /^[a-zA-Z]*/.exec(node.text)?.[0]?.toLowerCase() ?? '';
    return prefix.includes('b') || prefix.includes('f') || hasInterpolation(node)
      ? undefined
      : [node];
  }
  if (node.type !== 'concatenated_string' && node.type !== 'parenthesized_expression') {
    return undefined;
  }
  const children = namedChildren(node);
  if (children.length === 0) return undefined;
  const leaves: Node[] = [];
  for (const child of children) {
    const nested = documentationStringLeaves(child);
    if (nested === undefined) return undefined;
    leaves.push(...nested);
  }
  return leaves;
};

/** Every string node belonging to the formal docstring at the head of this suite. */
const documentationStringsIn = (suite: Node): readonly Node[] => {
  const first = namedChildren(suite)[0];
  if (first?.type !== 'expression_statement') return [];
  const expressions = namedChildren(first);
  if (expressions.length !== 1 || expressions[0] === undefined) return [];
  return documentationStringLeaves(expressions[0]) ?? [];
};

const recordDocumentationStrings = (suite: Node, context: Context): void => {
  for (const string of documentationStringsIn(suite)) {
    context.documentationOffsets.add(string.startIndex);
  }
};

/**
 * A subscript reduced to the member path it selects, where every key it is given is a literal.
 *
 * The fact model is described as language neutral so that one adapter covers a framework in both ecosystems,
 * and this is where that stopped being true. `Agent(config=self.agents_config['k'])` recorded
 * `{"kind":"unknown","nodeType":"subscript"}` while the identical TypeScript recorded a member path, and
 * `subscript` is the most common unknown node type in every Python checkout in the corpus without exception.
 *
 * Only a literal key. `x['k']` selects the entry named `k` by the language definition and leaves nothing
 * open. `x[k]` selects by whatever the name holds when the program runs, which the syntax does not say, and
 * recording the variable's own name there is the defect just removed from the JavaScript reader. An f-string
 * is not a literal for this purpose, and neither is `x[a, b]`, where more than one key is written and taking
 * the first would be a guess. A chain is walked whole, so `x['a']['b']` keeps both keys rather than losing
 * the inner one to the reduction of its own value.
 */
const subscriptPath = (node: Node): ArgumentFact => {
  const unknown = { kind: 'unknown', nodeType: node.type } as const;
  const keys: string[] = [];
  let current: Node = node;
  while (current.type === 'subscript') {
    const written = childFields(current, 'subscript');
    const [key] = written;
    if (written.length !== 1 || key === undefined || key.type !== 'string') return unknown;
    if (hasInterpolation(key)) return unknown;
    const literal = stringLiteralValue(key);
    if (literal === undefined) return unknown;
    keys.unshift(literal);
    const value = childField(current, 'value');
    if (value === undefined) return unknown;
    current = value;
  }
  const path = attributePath(current);
  return path.length === 0 ? unknown : { kind: 'member', path: [...path, ...keys] };
};

const stringArgumentFact = (node: Node): ArgumentFact => {
  const value = stringLiteralValue(node);
  if (value === undefined) return { kind: 'unknown', nodeType: node.type };
  if (!hasInterpolation(node)) return { kind: 'string', value };
  const substitutions = substitutionsIn(node);
  return {
    kind: 'template',
    value,
    hasSubstitutions: true,
    substitutedNames: substitutions.names,
    substitutionsComplete: substitutions.complete,
  };
};

const numberArgumentFact = (node: Node): ArgumentFact => {
  const value = Number(node.text);
  return Number.isFinite(value)
    ? { kind: 'number', value }
    : { kind: 'unknown', nodeType: node.type };
};

const signedNumberArgumentFact = (node: Node): ArgumentFact => {
  const operand = childField(node, 'argument') ?? namedChildren(node)[0];
  const sign = node.text.trimStart()[0];
  if (
    operand === undefined ||
    (operand.type !== 'integer' && operand.type !== 'float') ||
    (sign !== '-' && sign !== '+')
  ) {
    return { kind: 'unknown', nodeType: node.type };
  }
  const reduced = numberArgumentFact(operand);
  return reduced.kind === 'number'
    ? { kind: 'number', value: sign === '-' ? -reduced.value : reduced.value }
    : { kind: 'unknown', nodeType: node.type };
};

const MAX_SOURCE_CHOICES = 8;

function sourceSelectionFact(node: Node, context: Context): ArgumentFact {
  const alternatives: Extract<
    ArgumentFact,
    { readonly kind: 'selection' }
  >['alternatives'][number][] = [];
  let complete = true;
  let closed = false;
  const staticTruth = (value: ArgumentFact): boolean | undefined => {
    if (value.kind === 'string') return value.value.length > 0;
    if (value.kind === 'number') return value.value !== 0;
    if (value.kind === 'boolean') return value.value;
    if (value.kind === 'null') return false;
    if (value.kind === 'array' && value.complete !== false) return value.items.length > 0;
    if (value.kind === 'object' && value.complete !== false) return value.entries.length > 0;
    return undefined;
  };
  const walk = (candidate: Node): void => {
    if (closed) return;
    const operators =
      candidate.type === 'boolean_operator'
        ? candidate.children.filter((child) => !child.isNamed)
        : [];
    if (
      candidate.type === 'boolean_operator' &&
      operators.length > 0 &&
      operators.every((operator) => operator.type === 'or')
    ) {
      for (const operand of namedChildren(candidate)) walk(operand);
      return;
    }
    const value = argumentFact(candidate, context);
    const truth = staticTruth(value);
    if (truth === false) return;
    if (alternatives.length >= MAX_SOURCE_CHOICES) {
      complete = false;
      return;
    }
    alternatives.push({
      value,
      location: location(context.file, candidate),
    });
    if (truth === true) closed = true;
  };
  walk(node);
  return { kind: 'selection', operator: 'or', alternatives, complete };
}

function dictionaryArgumentFact(node: Node, context: Context): ArgumentFact {
  const entries: ObjectEntryFact[] = [];
  const spreads: ObjectSpreadFact[] = [];
  for (const pair of namedChildren(node)) {
    if (pair.type === 'dictionary_splat') {
      const valueNode = namedChildren(pair)[0];
      if (valueNode !== undefined) {
        spreads.push({
          value: argumentFact(valueNode, context),
          location: location(context.file, pair),
        });
      }
      continue;
    }
    if (pair.type !== 'pair') continue;
    const keyNode = childField(pair, 'key');
    const valueNode = childField(pair, 'value');
    if (keyNode === undefined || valueNode === undefined) continue;
    const key = keyNode.type === 'string' ? stringLiteralValue(keyNode) : keyNode.text;
    if (key === undefined) continue;
    entries.push({
      key,
      value: argumentFact(valueNode, context),
      location: location(context.file, pair),
    });
  }
  return {
    kind: 'object',
    entries,
    spreads,
    complete: namedChildren(node).every((child) => {
      if (child.type !== 'pair') return false;
      const key = childField(child, 'key');
      return key?.type === 'string' && stringLiteralValue(key) !== undefined;
    }),
  };
}

const argumentFact = (node: Node, context: Context): ArgumentFact => {
  switch (node.type) {
    case 'string':
      return stringArgumentFact(node);
    case 'integer':
    case 'float':
      return numberArgumentFact(node);
    case 'unary_operator':
      return signedNumberArgumentFact(node);
    case 'true':
      return { kind: 'boolean', value: true };
    case 'false':
      return { kind: 'boolean', value: false };
    case 'none':
      return { kind: 'null' };
    case 'identifier':
      return { kind: 'identifier', name: node.text };
    case 'attribute': {
      const path = attributePath(node);
      return path.length === 0
        ? { kind: 'unknown', nodeType: node.type }
        : { kind: 'member', path };
    }
    case 'boolean_operator': {
      const operators = node.children.filter((child) => !child.isNamed);
      if (operators.length === 0 || operators.some((operator) => operator.type !== 'or')) {
        return { kind: 'unknown', nodeType: node.type };
      }
      return sourceSelectionFact(node, context);
    }
    case 'subscript':
      return subscriptPath(node);
    case 'call': {
      /*
       * Reduced the same way a call at the top level is, because it is the same shape and a reader
       * asking what it was given cannot know how deeply it was nested. Mapping the children one by one
       * left every keyword argument of a nested call as an unknown: `stop_after_attempt(15)` read
       * correctly and `stop_after_attempt(max_attempt_number=15)` did not, and the two are one policy
       * spelled two ways.
       */
      const callee = childField(node, 'function');
      const { positional, keywords, keywordSpreads, keywordsComplete } = splitArguments(
        node,
        context,
      );
      return {
        kind: 'call',
        path: callee === undefined ? [] : attributePath(callee),
        args:
          keywords.length === 0 && keywordsComplete
            ? positional
            : [
                ...positional,
                {
                  kind: 'object',
                  entries: keywords,
                  role: 'keywords',
                  spreads: keywordSpreads,
                  complete: keywordsComplete,
                },
              ],
      };
    }
    case 'list':
    case 'tuple':
    case 'set': {
      const children = namedChildren(node);
      const items = children
        .filter((child) => !child.type.includes('splat'))
        .map((child) => argumentFact(child, context));
      return {
        kind: 'array',
        items,
        complete: children.every((child) => !child.type.includes('splat')),
      };
    }
    case 'dictionary':
      return dictionaryArgumentFact(node, context);
    case 'lambda':
      return {
        kind: 'function',
        location: location(context.file, node),
      };
    case 'await': {
      const inner = namedChildren(node)[0];
      return inner === undefined
        ? { kind: 'unknown', nodeType: node.type }
        : argumentFact(inner, context);
    }
    default:
      return { kind: 'unknown', nodeType: node.type };
  }
};

const importScope = (enclosing: string | undefined): { enclosing?: string } =>
  enclosing === undefined ? {} : { enclosing };

const recordImport = (
  node: Node,
  context: Context,
  isType: boolean,
  enclosing: string | undefined,
): void => {
  if (node.type === 'import_statement') {
    for (const child of namedChildren(node)) {
      if (child.type === 'dotted_name') {
        const moduleName = child.text;
        const local = moduleName.split('.')[0] ?? moduleName;
        context.imports.push({
          module: moduleName,
          imported: '*',
          local,
          isType,
          location: location(context.file, child),
          ...importScope(enclosing),
        });
        context.bindings.set(local, { module: moduleName, imported: '*', isType });
        continue;
      }
      if (child.type === 'aliased_import') {
        const nameNode = childField(child, 'name');
        const aliasNode = childField(child, 'alias');
        if (nameNode === undefined || aliasNode === undefined) continue;
        context.imports.push({
          module: nameNode.text,
          imported: '*',
          local: aliasNode.text,
          isType,
          location: location(context.file, child),
          ...importScope(enclosing),
        });
        context.bindings.set(aliasNode.text, {
          module: nameNode.text,
          imported: '*',
          isType,
        });
      }
    }
    return;
  }

  const moduleNode = childField(node, 'module_name');
  const moduleName = moduleNode?.text ?? '';
  const wildcard = namedChildren(node).some((child) => child.type === 'wildcard_import');
  if (wildcard) {
    context.imports.push({
      module: moduleName,
      imported: '*',
      local: '*',
      isType,
      location: location(context.file, node),
      ...importScope(enclosing),
    });
    return;
  }
  for (const child of namedChildren(node)) {
    if (child === moduleNode) continue;
    if (child.type === 'dotted_name') {
      const imported = child.text;
      context.imports.push({
        module: moduleName,
        imported,
        local: imported,
        isType,
        location: location(context.file, child),
        ...importScope(enclosing),
      });
      context.bindings.set(imported, { module: moduleName, imported, isType });
      continue;
    }
    if (child.type === 'aliased_import') {
      const nameNode = childField(child, 'name');
      const aliasNode = childField(child, 'alias');
      if (nameNode === undefined || aliasNode === undefined) continue;
      context.imports.push({
        module: moduleName,
        imported: nameNode.text,
        local: aliasNode.text,
        isType,
        location: location(context.file, child),
        ...importScope(enclosing),
      });
      context.bindings.set(aliasNode.text, {
        module: moduleName,
        imported: nameNode.text,
        isType,
      });
    }
  }
};

const ENV_CALLS = new Set(['os.getenv', 'os.environ.get', 'environ.get', 'getenv']);

const environmentName = (
  path: readonly string[],
  args: readonly ArgumentFact[],
): string | undefined => {
  if (!ENV_CALLS.has(path.join('.'))) return undefined;
  const first = args[0];
  return first !== undefined && first.kind === 'string' ? first.value : undefined;
};

const subscriptEnvironment = (node: Node): string | undefined => {
  if (node.type !== 'subscript') return undefined;
  const value = childField(node, 'value');
  if (value === undefined) return undefined;
  const path = attributePath(value).join('.');
  if (path !== 'os.environ' && path !== 'environ') return undefined;
  const subscript = childField(node, 'subscript');
  return subscript !== undefined && subscript.type === 'string'
    ? stringLiteralValue(subscript)
    : undefined;
};

type Frame = {
  readonly name: string | undefined;
  readonly awaited: boolean;
  /** Imports inside an exact TYPE_CHECKING consequence do not establish runtime bindings. */
  readonly typeOnly: boolean;
  /** Conditional branches owning the source being traversed, outermost first. */
  readonly branches: readonly BranchPredicateFact[];
};

const TYPING_MODULES = new Set(['typing', 'typing_extensions']);

const typeCheckingRootShadowed = (context: Context, frame: Frame, root: string): boolean => {
  const scope = context.definitions.find(
    (definition) =>
      (definition.kind === 'function' || definition.kind === 'method') &&
      (definition.name === frame.name || definition.name.endsWith(`.${frame.name}`)),
  );
  return (
    scope?.parameters?.some((parameter) => parameter.name === root) === true ||
    context.definitions.some(
      (definition) =>
        definition.name === root &&
        (definition.enclosing === undefined || definition.enclosing === frame.name),
    ) ||
    context.assignments.some(
      (assignment) =>
        assignment.target.length === 1 &&
        assignment.target[0] === root &&
        (assignment.enclosing === undefined || assignment.enclosing === frame.name),
    )
  );
};

/**
 * Whether a Python condition makes its consequence unavailable at runtime through `TYPE_CHECKING`.
 *
 * Aliases are accepted only through an exact runtime import from `typing` or `typing_extensions`.
 * A conjunction is unavailable when one operand is an exact `TYPE_CHECKING` reference. Disjunction,
 * negation, calls and lookalike modules do not establish that the whole condition is false at runtime.
 */
const isTypeCheckingGuard = (condition: Node, context: Context, frame: Frame): boolean => {
  if (condition.type === 'parenthesized_expression') {
    const inner = namedChildren(condition)[0];
    return inner !== undefined && isTypeCheckingGuard(inner, context, frame);
  }
  if (condition.type === 'boolean_operator') {
    const operators = condition.children.filter((child) => !child.isNamed);
    if (operators.length === 0 || operators.some((operator) => operator.type !== 'and')) {
      return false;
    }
    return namedChildren(condition).some((operand) => isTypeCheckingGuard(operand, context, frame));
  }
  const path = attributePath(condition);
  if (path.length !== 1 && path.length !== 2) return false;
  const root = path[0];
  if (root === undefined || typeCheckingRootShadowed(context, frame, root)) return false;
  const binding = context.bindings.get(root);
  if (binding === undefined || binding.isType || !TYPING_MODULES.has(binding.module)) return false;
  if (path.length === 1) return binding.imported === 'TYPE_CHECKING';
  return binding.imported === '*' && path[1] === 'TYPE_CHECKING';
};

const restoreBindings = (context: Context, saved: ReadonlyMap<string, CalleeOrigin>): void => {
  context.bindings.clear();
  for (const [name, origin] of saved) context.bindings.set(name, origin);
};

const CONTROL_FLOW_TYPES: Readonly<Record<string, ControlFlowFact['kind']>> = {
  try_statement: 'try_catch',
  for_statement: 'loop',
  while_statement: 'loop',
};

/**
 * What a loop's form says about whether its passes repeat work or walk a collection.
 *
 * Python draws the line more sharply than JavaScript does: `for` binds the next element, always, and a
 * loop that repeats the same work is a `while`. This is what separates a retry from an iteration, and
 * reading a loop without it is how per item error isolation came to be reported as a retry around a non
 * idempotent operation.
 */
const RANGE_CALL = /^range\s*\(/;

/**
 * `for x in range(n)` is the Python idiom for repeating the same work a fixed number of times, and `for x
 * in items` is iteration. The iterable is what tells them apart, and it is also what says the passes are
 * bounded: a poll reported as having no attempt limit was bounded by `range(self.max_polling_time)` in the
 * line the finding pointed at.
 */
/**
 * Operators that compare a value against a bound, as opposed to testing whether something has happened.
 *
 * `while attempt < max_attempts` states the same ceiling `for _ in range(n)` states, and `while not done`
 * states none. Reading every `while` as unbounded told the author of the first that they had written no
 * attempt limit, in the line where they had written one.
 */
const COUNTING_OPERATORS = new Set(['<', '<=', '>', '>=']);

/**
 * Names the loop writes to anywhere inside itself, which is how a counter advances and how a bound grows.
 *
 * Python spells both as an assignment, plain or augmented, and there is no increment operator to read
 * separately. Uncapped, because the set is read for absence as well as presence and a name missing from
 * it would report a bound that grows as one that holds still.
 */
const collectAssignedNames = (node: Node | null, into: Set<string>): void => {
  if (node === null) return;
  if (node.type === 'assignment' || node.type === 'augmented_assignment') {
    const target = node.childForFieldName('left');
    if (target !== null && target.type === 'identifier') into.add(target.text);
  }
  for (const child of node.namedChildren) collectAssignedNames(child, into);
};

const identifiersUnder = (node: Node): ReadonlySet<string> => {
  const names = new Set<string>();
  const walk = (candidate: Node): void => {
    if (candidate.type === 'identifier') {
      names.add(candidate.text);
      return;
    }
    for (const child of candidate.namedChildren) walk(child);
  };
  walk(node);
  return names;
};

/**
 * Whether a `while` head closes, given the names its body writes to.
 *
 * A comparison against a bound is a ceiling only when the two sides move apart: one of them advances and
 * the other holds still. `while attempt < max_attempts` with nothing incrementing `attempt` never ends,
 * and neither does the same head with `max_attempts` growing every pass, and both were read as bounded on
 * the strength of the operator alone.
 *
 * A chained comparison is refused rather than guessed at. `while 0 < attempt < limit` states a ceiling
 * whose reading depends on which of three operands moves, and the head does not settle that.
 */
const comparisonCloses = (condition: Node, advanced: ReadonlySet<string>): boolean => {
  if (!condition.children.some((child) => !child.isNamed && COUNTING_OPERATORS.has(child.type))) {
    return false;
  }
  const sides = condition.namedChildren;
  if (sides.length !== 2) return false;
  const moves = (side: Node): boolean =>
    [...identifiersUnder(side)].some((name) => advanced.has(name));
  const [left, right] = sides;
  return left !== undefined && right !== undefined && moves(left) !== moves(right);
};

/**
 * Whether a condition closes, following the way it is joined.
 *
 * `while True and attempts < 10` is how one pinned repository writes a bounded poll, and reading only a
 * bare comparison called it infinite and then accused it of retrying a write without a limit. An `and`
 * ends the loop as soon as any operand is false, so one closing operand closes the loop; an `or` runs
 * while any operand holds, so every one of them has to close. A negation is refused rather than
 * inverted, because what a reader would have to work out is not what the head says.
 */
const conditionCloses = (condition: Node, advanced: ReadonlySet<string>): boolean => {
  if (condition.type === 'comparison_operator') return comparisonCloses(condition, advanced);
  if (condition.type === 'parenthesized_expression') {
    const inner = condition.namedChildren[0];
    return inner !== undefined && conditionCloses(inner, advanced);
  }
  if (condition.type !== 'boolean_operator') return false;
  const joined = condition.children.some((child) => !child.isNamed && child.type === 'and');
  const operands = condition.namedChildren;
  if (operands.length === 0) return false;
  return joined
    ? operands.some((operand) => conditionCloses(operand, advanced))
    : operands.every((operand) => conditionCloses(operand, advanced));
};

const whilePassesBounded = (node: Node): boolean => {
  const condition = node.childForFieldName('condition');
  if (condition === null) return false;
  const advanced = new Set<string>();
  collectAssignedNames(node.childForFieldName('body'), advanced);
  return conditionCloses(condition, advanced);
};

const loopForm = (node: Node): { repeats: 'same_work' | 'each_item'; passesBounded: boolean } => {
  if (node.type === 'while_statement') {
    return { repeats: 'same_work', passesBounded: whilePassesBounded(node) };
  }
  const iterable = node.childForFieldName('right');
  const overRange = iterable !== null && RANGE_CALL.test(iterable.text);
  return { repeats: overRange ? 'same_work' : 'each_item', passesBounded: true };
};

/** Enough of a condition to recognise a counter by the name its author gave it. */
const MAX_HEADER_NAMES = 8;

/** The identifiers a loop names in its condition or counted-range header. */
const loopHeaderNames = (node: Node): readonly string[] => {
  const names = new Set<string>();
  const walk = (candidate: Node | null): void => {
    if (candidate === null || names.size >= MAX_HEADER_NAMES) return;
    if (candidate.type === 'identifier') {
      names.add(candidate.text);
      return;
    }
    for (const child of namedChildren(candidate)) walk(child);
  };
  if (node.type === 'for_statement') {
    walk(node.childForFieldName('left'));
    walk(node.childForFieldName('right'));
  } else {
    walk(node.childForFieldName('condition'));
  }
  return [...names];
};

/**
 * Ways a value is made to grow by a factor rather than by a step.
 *
 * A wait that doubles is a backoff and a wait that gains a hundred milliseconds is not, and this is the
 * whole of the difference in the syntax. `delay *= 2` and `delay = delay * 2` are one thing written two
 * ways, so both are read.
 */
const GROWING_ASSIGNMENTS = new Set(['*=', '**=', '<<=']);
const GROWING_OPERATORS = new Set(['*', '**', '<<']);

const growsByFactor = (node: Node, target: string): boolean => {
  if (node.type === 'augmented_assignment') {
    return node.children.some((child) => !child.isNamed && GROWING_ASSIGNMENTS.has(child.type));
  }
  const right = node.childForFieldName('right');
  if (right === null || right.type !== 'binary_operator') return false;
  const grows = right.children.some((child) => !child.isNamed && GROWING_OPERATORS.has(child.type));
  return grows && [...identifiersUnder(right)].includes(target);
};

/** Names the loop multiplies on each pass, which is a wait growing one statement away from its call. */
const collectGrowingNames = (node: Node | null, into: Set<string>): void => {
  if (node === null) return;
  if (node.type === 'assignment' || node.type === 'augmented_assignment') {
    const target = node.childForFieldName('left');
    if (target !== null && target.type === 'identifier' && growsByFactor(node, target.text)) {
      into.add(target.text);
    }
  }
  for (const child of node.namedChildren) collectGrowingNames(child, into);
};

const growingNamesOf = (node: Node): readonly string[] => {
  const names = new Set<string>();
  collectGrowingNames(node.childForFieldName('body'), names);
  return [...names];
};

const FUNCTION_TYPES = new Set(['function_definition', 'lambda']);

/**
 * Whether a statement here ends the enclosing work.
 *
 * A nested function is not descended into: a `return` inside a comprehension's lambda says nothing about
 * the block holding it, and counting it would make almost every block look like one that exits.
 */
const endsTheWork = (node: Node | null): boolean => {
  if (node === null) return false;
  if (node.type === 'return_statement' || node.type === 'break_statement') return true;
  if (FUNCTION_TYPES.has(node.type)) return false;
  return node.namedChildren.some((child) => endsTheWork(child));
};

/** Whether every path through this handler ends the work instead of allowing another pass. */
const alwaysEndsTheWork = (node: Node | null): boolean => {
  if (node === null) return false;
  if (
    node.type === 'return_statement' ||
    node.type === 'break_statement' ||
    node.type === 'raise_statement'
  ) {
    return true;
  }
  if (FUNCTION_TYPES.has(node.type)) return false;
  if (node.type === 'if_statement') {
    const body = node.childForFieldName('consequence') ?? node.childForFieldName('body');
    const alternative = node.childForFieldName('alternative');
    return alwaysEndsTheWork(body) && alwaysEndsTheWork(alternative);
  }
  if (
    node.type === 'block' ||
    node.type === 'except_clause' ||
    node.type === 'else_clause' ||
    node.type === 'finally_clause'
  ) {
    return node.namedChildren.some((child) => alwaysEndsTheWork(child));
  }
  return false;
};

/** Whether a pass succeeds out of this `try` and fails through it, which is one attempt of a retry. */
const exitsOnSuccessIn = (node: Node): boolean => {
  const body = node.childForFieldName('body');
  if (!endsTheWork(body)) return false;
  return !node.namedChildren.some(
    (child) => child.type === 'except_clause' && alwaysEndsTheWork(child),
  );
};

const decoratorFacts = (node: Node, context: Context): readonly DecoratorFact[] => {
  const facts: DecoratorFact[] = [];
  for (const child of node.children) {
    if (child === null || child.type !== 'decorator') continue;
    const inner = namedChildren(child)[0];
    if (inner === undefined) continue;
    if (inner.type === 'call') {
      const callee = childField(inner, 'function');
      const path = callee === undefined ? [] : attributePath(callee);
      const { positional, keywords, keywordSpreads, keywordsComplete } = splitArguments(
        inner,
        context,
      );
      facts.push({
        path,
        origin: path[0] === undefined ? undefined : context.bindings.get(path[0]),
        args:
          keywords.length === 0 && keywordsComplete
            ? positional
            : [
                ...positional,
                {
                  kind: 'object',
                  entries: keywords,
                  role: 'keywords',
                  spreads: keywordSpreads,
                  complete: keywordsComplete,
                },
              ],
        location: location(context.file, child),
      });
      continue;
    }
    const path = attributePath(inner);
    facts.push({
      path,
      origin: path[0] === undefined ? undefined : context.bindings.get(path[0]),
      args: [],
      location: location(context.file, child),
    });
  }
  return facts;
};

/**
 * A call's arguments, separated into the positional ones and the keyword object.
 *
 * A `**` splat contributes keywords, not a positional argument, and counting it as one moved the
 * keyword object along by a slot: `create(model=..., timeout=..., **overrides)` reduced to an unknown
 * first argument and the keywords second, so every adapter asking a Python call what it was configured
 * with read nothing. The model went unnamed, the deadline went unread, and the shape is the one the
 * provider SDKs document for passing options through. JavaScript reduces the same program correctly
 * already, because an object spread is skipped where it sits and shifts nothing.
 *
 * A `*` splat stays positional, where it belongs. Its arity is unknown, which makes any later index
 * unreliable, and recording it says so rather than quietly renumbering what follows.
 */
const splitArguments = (
  call: Node,
  context: Context,
): {
  positional: ArgumentFact[];
  keywords: ObjectEntryFact[];
  keywordSpreads: ObjectSpreadFact[];
  keywordsComplete: boolean;
} => {
  const positional: ArgumentFact[] = [];
  const keywords: ObjectEntryFact[] = [];
  const keywordSpreads: ObjectSpreadFact[] = [];
  let keywordsComplete = true;
  const list = childField(call, 'arguments');
  if (list === undefined) return { positional, keywords, keywordSpreads, keywordsComplete };
  for (const child of namedChildren(list)) {
    if (child.type === 'dictionary_splat') {
      keywordsComplete = false;
      const valueNode = namedChildren(child)[0];
      if (valueNode !== undefined) {
        keywordSpreads.push({
          value: argumentFact(valueNode, context),
          location: location(context.file, child),
        });
      }
      continue;
    }
    if (child.type === 'keyword_argument') {
      const nameNode = childField(child, 'name');
      const valueNode = childField(child, 'value');
      if (nameNode === undefined || valueNode === undefined) continue;
      keywords.push({
        key: nameNode.text,
        value: argumentFact(valueNode, context),
        location: location(context.file, child),
      });
      continue;
    }
    positional.push(argumentFact(child, context));
  }
  return { positional, keywords, keywordSpreads, keywordsComplete };
};

/** Traverses every branch of an if, including each independently guarded `elif` consequence. */
function traverseIfStatement(
  node: Node,
  context: Context,
  frame: Frame,
  collecting: (readonly string[])[][],
): void {
  const condition = childField(node, 'condition');
  if (condition !== undefined) traverse(condition, context, frame, collecting);

  const consequence = childField(node, 'consequence');
  if (consequence !== undefined) {
    const predicate = branchPredicate(condition, 'consequence', context);
    const savedBindings = new Map(context.bindings);
    traverse(
      consequence,
      context,
      {
        ...frame,
        typeOnly:
          frame.typeOnly ||
          (condition !== undefined && isTypeCheckingGuard(condition, context, frame)),
        branches: predicate === undefined ? frame.branches : [...frame.branches, predicate],
      },
      collecting,
    );
    restoreBindings(context, savedBindings);
  }

  const alternative = childField(node, 'alternative');
  if (alternative !== undefined) {
    const predicate = branchPredicate(condition, 'alternative', context);
    const alternativeFrame = {
      ...frame,
      branches: predicate === undefined ? frame.branches : [...frame.branches, predicate],
    };
    const savedBindings = new Map(context.bindings);
    if (alternative.type === 'elif_clause') {
      traverseIfStatement(alternative, context, alternativeFrame, collecting);
    } else {
      traverse(alternative, context, alternativeFrame, collecting);
    }
    restoreBindings(context, savedBindings);
  }

  for (const child of namedChildren(node)) {
    const alreadyTraversed = [condition, consequence, alternative].some(
      (candidate) =>
        candidate !== undefined &&
        candidate.startIndex === child.startIndex &&
        candidate.endIndex === child.endIndex,
    );
    if (alreadyTraversed) continue;
    const predicate: BranchPredicateFact = {
      operator: `${node.type}:${child.type}`,
      references: [],
      location: location(context.file, child),
      branch: 'alternative',
    };
    const savedBindings = new Map(context.bindings);
    traverse(child, context, { ...frame, branches: [...frame.branches, predicate] }, collecting);
    restoreBindings(context, savedBindings);
  }
}

const isConditionalControlBody = (kind: ControlFlowFact['kind'], child: Node): boolean =>
  (kind === 'loop' && (child.type === 'block' || child.type === 'else_clause')) ||
  (kind === 'try_catch' &&
    (child.type === 'block' || child.type === 'except_clause' || child.type === 'else_clause'));

const traverseControlFlow = (
  node: Node,
  controlKind: ControlFlowFact['kind'],
  context: Context,
  frame: Frame,
  collecting: (readonly string[])[][],
): void => {
  const contains: (readonly string[])[] = [];
  collecting.push(contains);
  let conditionalBody = 0;
  let successfulTryBody: BranchPredicateFact | undefined;
  for (const child of namedChildren(node)) {
    if (!isConditionalControlBody(controlKind, child)) {
      traverse(child, context, frame, collecting);
      continue;
    }
    conditionalBody += 1;
    const predicate: BranchPredicateFact = {
      operator: `${node.type}:${child.type}:${conditionalBody}`,
      references: [],
      location: location(context.file, child),
      branch: 'consequence',
    };
    const inherited =
      controlKind === 'try_catch' && child.type === 'else_clause' && successfulTryBody !== undefined
        ? [...frame.branches, successfulTryBody]
        : frame.branches;
    traverse(child, context, { ...frame, branches: [...inherited, predicate] }, collecting);
    if (controlKind === 'try_catch' && child.type === 'block') successfulTryBody = predicate;
  }
  collecting.pop();
  const form = controlKind === 'loop' ? loopForm(node) : undefined;
  context.controlFlow.push({
    kind: controlKind,
    location: location(context.file, node),
    enclosing: frame.name,
    contains,
    ...(form === undefined ? {} : form),
    ...(controlKind === 'try_catch' ? { exitsOnSuccess: exitsOnSuccessIn(node) } : {}),
    ...(form?.repeats === 'same_work'
      ? {
          headerNames: loopHeaderNames(node),
          growingNames: growingNamesOf(node),
          countsPasses: node.type === 'for_statement',
        }
      : {}),
  });
};

const traverseMatchStatement = (
  node: Node,
  context: Context,
  frame: Frame,
  collecting: (readonly string[])[][],
): void => {
  let matchedCase = 0;
  for (const child of namedChildren(node)) {
    if (child.type !== 'block') {
      traverse(child, context, frame, collecting);
      continue;
    }
    for (const clause of namedChildren(child)) {
      matchedCase += 1;
      const predicate: BranchPredicateFact = {
        operator: `match_case:${matchedCase}`,
        references: [],
        location: location(context.file, clause),
        branch: 'consequence',
      };
      traverse(clause, context, { ...frame, branches: [...frame.branches, predicate] }, collecting);
    }
  }
};

const traverse = (
  node: Node,
  context: Context,
  frame: Frame,
  collecting: (readonly string[])[][],
): void => {
  const controlKind = CONTROL_FLOW_TYPES[node.type];
  if (controlKind !== undefined) {
    traverseControlFlow(node, controlKind, context, frame, collecting);
    return;
  }

  switch (node.type) {
    case 'import_statement':
    case 'import_from_statement':
      recordImport(node, context, frame.typeOnly, frame.name);
      return;
    case 'if_statement': {
      traverseIfStatement(node, context, frame, collecting);
      return;
    }
    case 'match_statement': {
      traverseMatchStatement(node, context, frame, collecting);
      return;
    }
    case 'decorated_definition': {
      recordDecoratedDefinition(node, context, frame, collecting);
      return;
    }
    case 'function_definition': {
      recordFunction(node, context, frame, [], collecting);
      return;
    }
    case 'class_definition': {
      recordClass(node, context, frame, [], collecting);
      return;
    }
    case 'assignment': {
      recordAssignment(node, context, frame, collecting);
      return;
    }
    case 'augmented_assignment': {
      recordAssignment(node, context, frame, collecting, true);
      return;
    }
    case 'delete_statement': {
      for (const target of namedChildren(node).flatMap(assignmentTargets)) {
        const path = assignmentPath(target);
        if (path.length === 0) continue;
        context.assignments.push({
          target: path,
          ...(targetIncludesSubscript(target) ? { targetIncludesSubscript: true } : {}),
          value: { kind: 'unknown', nodeType: 'delete' },
          location: location(context.file, node),
          operation: 'delete',
          ...(frame.name === undefined ? {} : { enclosing: frame.name }),
        });
      }
      return;
    }
    case 'with_statement': {
      recordWithBindings(node, context, frame);
      for (const child of namedChildren(node)) traverse(child, context, frame, collecting);
      return;
    }
    case 'await': {
      for (const child of namedChildren(node)) {
        traverse(child, context, { ...frame, awaited: true }, collecting);
      }
      return;
    }
    case 'call': {
      recordCall(node, context, frame, collecting);
      return;
    }
    case 'subscript': {
      const envName = subscriptEnvironment(node);
      if (envName !== undefined) {
        context.environmentRefs.push({
          name: envName,
          location: location(context.file, node),
          enclosing: frame.name,
        });
        return;
      }
      for (const child of namedChildren(node)) traverse(child, context, frame, collecting);
      return;
    }
    case 'string': {
      if (context.documentationOffsets.has(node.startIndex)) return;
      const value = stringLiteralValue(node);
      if (value !== undefined && value.length >= TEXT_FACT_MIN_LENGTH) {
        context.texts.push({
          value,
          approximateTokens: approximateTokens(value),
          hasSubstitutions: hasInterpolation(node),
          location: location(context.file, node),
          enclosing: frame.name,
        });
      }
      return;
    }
    default: {
      for (const child of namedChildren(node)) traverse(child, context, frame, collecting);
    }
  }
};

const recordCall = (
  node: Node,
  context: Context,
  frame: Frame,
  collecting: (readonly string[])[][],
): void => {
  const callee = childField(node, 'function');
  const path = callee === undefined ? [] : attributePath(callee);
  const { positional, keywords, keywordSpreads, keywordsComplete } = splitArguments(node, context);
  const args =
    keywords.length === 0 && keywordsComplete
      ? positional
      : [
          ...positional,
          {
            kind: 'object' as const,
            entries: keywords,
            role: 'keywords' as const,
            spreads: keywordSpreads,
            complete: keywordsComplete,
          },
        ];

  const envName = environmentName(path, positional);
  if (envName !== undefined) {
    context.environmentRefs.push({
      name: envName,
      location: location(context.file, node),
      enclosing: frame.name,
    });
  }

  context.calls.push({
    kind: 'call',
    calleePath: path,
    origin: path[0] === undefined ? undefined : context.bindings.get(path[0]),
    args,
    location: location(context.file, node),
    offset: node.startIndex,
    enclosing: frame.name,
    ...(frame.branches.length === 0 ? {} : { branches: frame.branches }),
    awaited: frame.awaited,
  });
  const current = collecting[collecting.length - 1];
  if (current !== undefined && path.length > 0) current.push(path);

  const list = childField(node, 'arguments');
  if (list !== undefined) {
    for (const child of namedChildren(list)) {
      traverse(child, context, { ...frame, awaited: false }, collecting);
    }
  }
};

const recordDecoratedDefinition = (
  node: Node,
  context: Context,
  frame: Frame,
  collecting: (readonly string[])[][],
): void => {
  const decorators = decoratorFacts(node, context);
  const definition = childField(node, 'definition');
  if (definition === undefined) return;
  if (definition.type === 'function_definition') {
    recordFunction(definition, context, frame, decorators, collecting);
    return;
  }
  if (definition.type === 'class_definition') {
    recordClass(definition, context, frame, decorators, collecting);
    return;
  }
  traverse(definition, context, frame, collecting);
};

/** Whether the annotation head resolves to the standard bounded `Literal` type. */
const isLiteralAnnotationHead = (head: Node | undefined, context: Context): boolean => {
  if (head === undefined) return false;
  const path = attributePath(head);
  const root = path[0];
  const leaf = path[path.length - 1];
  if (root === undefined || leaf === undefined) return false;
  const binding = context.bindings.get(root);
  if (path.length === 1) {
    if (
      binding !== undefined &&
      binding.imported === 'Literal' &&
      TYPING_MODULES.has(binding.module)
    ) {
      return true;
    }
    return context.imports.some(
      (entry) =>
        entry.local === '*' &&
        entry.imported === '*' &&
        TYPING_MODULES.has(entry.module) &&
        root === 'Literal',
    );
  }
  return leaf === 'Literal' && binding?.imported === '*' && TYPING_MODULES.has(binding.module);
};

/** Literal destinations named by a Python `Literal[...]` return annotation. */
const returnAnnotationOf = (node: Node, context: Context): ReturnAnnotationFact | undefined => {
  const annotation = childField(node, 'return_type');
  if (annotation === undefined) return undefined;
  const generic = annotation.namedChildren.find((child) => child.type === 'generic_type');
  const head = generic?.namedChildren[0];
  const parameters = generic?.namedChildren.slice(1) ?? [];
  const literalHead = isLiteralAnnotationHead(head, context);
  const strings: Node[] = [];
  let unsupported = !literalHead || parameters.length === 0;

  const collect = (candidate: Node): void => {
    if (candidate.type === 'string') {
      strings.push(candidate);
      return;
    }
    if (candidate.type !== 'type' && candidate.type !== 'type_parameter') {
      unsupported = true;
      return;
    }
    if (candidate.namedChildren.length === 0) unsupported = true;
    for (const child of candidate.namedChildren) collect(child);
  };
  if (literalHead) {
    for (const parameter of parameters) collect(parameter);
  }

  return {
    destinations: strings.flatMap((string) => {
      const value = stringLiteralValue(string);
      return value === undefined ? [] : [{ value, location: location(context.file, string) }];
    }),
    location: location(context.file, annotation),
    complete: !unsupported && strings.length > 0,
  };
};

/** Member and identifier paths read by one predicate, without duplicating member suffixes. */
const predicateReferences = (node: Node): readonly (readonly string[])[] => {
  const references = new Map<string, readonly string[]>();
  const collect = (candidate: Node): void => {
    if (candidate.type === 'attribute' || candidate.type === 'identifier') {
      const path = attributePath(candidate);
      if (path.length > 0) references.set(path.join('.'), path);
      return;
    }
    for (const child of candidate.namedChildren) collect(child);
  };
  collect(node);
  return [...references.values()];
};

const branchPredicate = (
  condition: Node | undefined,
  branch: BranchPredicateFact['branch'],
  context: Context,
): BranchPredicateFact | undefined => {
  if (condition === undefined) return undefined;
  const operator = condition.children.find((child) => !child.isNamed)?.type;
  return {
    operator: operator ?? condition.type,
    references: predicateReferences(condition),
    location: location(context.file, condition),
    branch,
  };
};

const returnFact = (
  statement: Node,
  context: Context,
  predicate: BranchPredicateFact | undefined,
): ReturnFact => {
  const value = namedChildren(statement)[0];
  return {
    value:
      value === undefined
        ? { kind: 'unknown', nodeType: 'bare_return' }
        : argumentFact(value, context),
    location: location(context.file, statement),
    ...(predicate === undefined ? {} : { predicate }),
  };
};

/**
 * Direct returns of one function, preserving the nearest branch that selects each one.
 *
 * Nested functions and classes are separate definitions. Descending into either would attribute their
 * returns to the outer router and turn a local helper into a possible graph destination.
 */
const returnsOf = (node: Node, context: Context): readonly ReturnFact[] => {
  const returns: ReturnFact[] = [];
  const body = childField(node, 'body');
  if (body === undefined) return returns;
  const nestedScopes = new Set(['function_definition', 'class_definition', 'lambda']);

  const walk = (candidate: Node, predicate?: BranchPredicateFact): void => {
    if (candidate !== body && nestedScopes.has(candidate.type)) {
      return;
    }
    if (candidate.type === 'return_statement') {
      returns.push(returnFact(candidate, context, predicate));
      return;
    }
    if (candidate.type === 'if_statement' || candidate.type === 'elif_clause') {
      const condition = childField(candidate, 'condition');
      const consequence = childField(candidate, 'consequence');
      if (consequence !== undefined) {
        walk(consequence, branchPredicate(condition, 'consequence', context));
      }
      const alternative = childField(candidate, 'alternative');
      if (alternative !== undefined) {
        if (alternative.type === 'elif_clause') walk(alternative, predicate);
        else {
          const alternativeBody = childField(alternative, 'body') ?? alternative.namedChildren[0];
          if (alternativeBody !== undefined) {
            walk(alternativeBody, branchPredicate(condition, 'alternative', context));
          }
        }
      }
      return;
    }
    for (const child of namedChildren(candidate)) walk(child, predicate);
  };
  walk(body);
  return returns;
};

/** A simple dotted type name written on a parameter. Generic annotations remain outside this bound. */
const parameterAnnotationPath = (annotation: Node | undefined): readonly string[] => {
  if (annotation === undefined) return [];
  if (annotation.type === 'identifier' || annotation.type === 'attribute') {
    return attributePath(annotation);
  }
  if (annotation.type === 'type') {
    const inner = namedChildren(annotation)[0];
    return parameterAnnotationPath(inner);
  }
  return [];
};

/** Direct parameters declared by one function, with a simple annotation where one is written. */
const parametersOf = (node: Node, context: Context): readonly ParameterFact[] => {
  const parameters = childField(node, 'parameters');
  if (parameters === undefined) return [];
  const facts: ParameterFact[] = [];
  for (const parameter of namedChildren(parameters)) {
    const nameNode =
      childField(parameter, 'name') ??
      (parameter.type === 'identifier'
        ? parameter
        : namedChildren(parameter).find((child) => child.type === 'identifier'));
    const annotation = childField(parameter, 'type');
    const path = parameterAnnotationPath(annotation);
    if (nameNode === undefined) continue;
    facts.push({
      name: nameNode.text,
      ...(path.length === 0 ? {} : { annotation: path }),
      location: location(context.file, annotation ?? nameNode),
    });
  }
  return facts;
};

const recordFunction = (
  node: Node,
  context: Context,
  frame: Frame,
  decorators: readonly DecoratorFact[],
  collecting: (readonly string[])[][],
): void => {
  const nameNode = childField(node, 'name');
  const name = nameNode?.text ?? '(anonymous)';
  const isAsync = node.children.some((child) => child !== null && child.type === 'async');
  const returnAnnotation = returnAnnotationOf(node, context);
  const returns = returnsOf(node, context);
  const parameters = parametersOf(node, context);
  context.definitions.push({
    kind: frame.name === undefined ? 'function' : 'method',
    name: frame.name === undefined ? name : `${frame.name}.${name}`,
    exported: !name.startsWith('_'),
    async: isAsync,
    decorators,
    location: location(context.file, node),
    initializer: undefined,
    ...(returnAnnotation === undefined ? {} : { returnAnnotation }),
    ...(returns.length === 0 ? {} : { returns }),
    ...(parameters.length === 0 ? {} : { parameters }),
    enclosing: frame.name,
    ...(frame.branches.length === 0 ? {} : { branches: frame.branches }),
  });
  const body = childField(node, 'body');
  if (body !== undefined) {
    const savedBindings = new Map(context.bindings);
    recordDocumentationStrings(body, context);
    traverse(
      body,
      context,
      { name, awaited: false, typeOnly: frame.typeOnly, branches: [] },
      collecting,
    );
    restoreBindings(context, savedBindings);
  }
};

const recordClass = (
  node: Node,
  context: Context,
  frame: Frame,
  decorators: readonly DecoratorFact[],
  collecting: (readonly string[])[][],
): void => {
  const nameNode = childField(node, 'name');
  const name = nameNode?.text ?? '(anonymous)';
  const superclasses = childField(node, 'superclasses');
  const bases =
    superclasses === undefined
      ? []
      : namedChildren(superclasses)
          .map((child) => attributePath(child).join('.'))
          .filter((value) => value.length > 0);
  context.definitions.push({
    kind: 'class',
    name,
    exported: !name.startsWith('_'),
    async: false,
    decorators,
    location: location(context.file, node),
    initializer: bases.length > 0 ? bases : undefined,
    enclosing: frame.name,
    ...(frame.branches.length === 0 ? {} : { branches: frame.branches }),
  });
  const body = childField(node, 'body');
  if (body !== undefined) {
    const savedBindings = new Map(context.bindings);
    recordDocumentationStrings(body, context);
    traverse(
      body,
      context,
      { name, awaited: false, typeOnly: frame.typeOnly, branches: frame.branches },
      collecting,
    );
    restoreBindings(context, savedBindings);
  }
};

/**
 * The names an assignment takes its value from, when it takes it from a name rather than by calling one.
 *
 * `post = requests.post` and `send = custom or requests.post` are the Python spellings of the injected
 * client, and the second is why both sides of a boolean operator are read: the default is the name that
 * says what the value is.
 */
const aliasedNames = (right: Node): readonly (readonly string[])[] => {
  if (right.type === 'identifier' || right.type === 'attribute') {
    const path = attributePath(right);
    return path.length === 0 ? [] : [path];
  }
  if (right.type === 'boolean_operator' || right.type === 'conditional_expression') {
    return right.namedChildren.flatMap((child) => aliasedNames(child));
  }
  return [];
};

/**
 * The literals an assignment binds, which is every one it offers rather than the one it probably takes.
 *
 * `a or 'b'` and `'a' if c else 'b'` each bind more than one and the syntax does not say which, so both sides
 * are read for the same reason `aliasedNames` reads both sides of a boolean operator.
 */
const boundLiterals = (right: Node, context: Context): readonly ArgumentFact[] => {
  if (right.type === 'boolean_operator' || right.type === 'conditional_expression') {
    return namedChildren(right).flatMap((child) => boundLiterals(child, context));
  }
  const fact = argumentFact(right, context);
  return isLiteralFact(fact) ? [fact] : [];
};

/**
 * Variables introduced by a context manager.
 *
 * `with DDGS() as ddgs` gives subsequent member calls the same stable receiver fact as
 * `ddgs = DDGS()`. Only a direct call and a single identifier alias are retained.
 */
const recordWithBindings = (node: Node, context: Context, frame: Frame): void => {
  const clause = namedChildren(node).find((child) => child.type === 'with_clause');
  if (clause === undefined) return;
  for (const item of namedChildren(clause)) {
    if (item.type !== 'with_item') continue;
    const pattern = childField(item, 'value');
    if (pattern?.type !== 'as_pattern') continue;
    const value = namedChildren(pattern)[0];
    const alias = childField(pattern, 'alias');
    const nameNode = alias?.namedChildren.find((child) => child.type === 'identifier');
    if (value?.type !== 'call' || nameNode === undefined) continue;
    const callee = childField(value, 'function');
    const initializer = callee === undefined ? [] : attributePath(callee);
    if (initializer.length === 0) continue;
    context.definitions.push({
      kind: 'variable',
      name: nameNode.text,
      exported: !nameNode.text.startsWith('_'),
      async: false,
      decorators: [],
      location: location(context.file, item),
      initializer,
      value: argumentFact(value, context),
      enclosing: frame.name,
    });
  }
};

const assignmentPath = (left: Node | undefined): readonly string[] => {
  if (left === undefined) return [];
  if (left.type === 'parenthesized_expression') {
    return assignmentPath(namedChildren(left)[0]);
  }
  if (left.type === 'list_splat' || left.type === 'list_splat_pattern') {
    return assignmentPath(namedChildren(left)[0]);
  }
  if (left.type === 'attribute') {
    const object = childField(left, 'object');
    const attribute = childField(left, 'attribute');
    if (object === undefined || attribute === undefined) return [];
    const prefix = assignmentPath(object);
    return prefix.length === 0 ? [] : [...prefix, attribute.text];
  }
  if (left.type !== 'subscript') return attributePath(left);
  const member = left?.type === 'subscript' ? subscriptPath(left) : undefined;
  if (member?.kind === 'member') return member.path;
  return assignmentPath(childField(left, 'value') ?? left);
};

const targetIncludesSubscript = (node: Node | undefined): boolean =>
  node !== undefined &&
  (node.type === 'subscript' ||
    namedChildren(node).some((child) => targetIncludesSubscript(child)));

const ASSIGNMENT_TARGET_CONTAINERS = new Set([
  'expression_list',
  'list',
  'list_pattern',
  'list_splat',
  'list_splat_pattern',
  'parenthesized_expression',
  'pattern_list',
  'tuple',
  'tuple_pattern',
]);

const assignmentTargets = (node: Node): readonly Node[] =>
  ASSIGNMENT_TARGET_CONTAINERS.has(node.type)
    ? namedChildren(node).flatMap(assignmentTargets)
    : [node];

const directDefinitionTarget = (node: Node | undefined): Node | undefined => {
  if (node?.type !== 'parenthesized_expression') return node;
  const children = namedChildren(node);
  return children.length === 1 ? directDefinitionTarget(children[0]) : undefined;
};

const isDestructuringTarget = (node: Node | undefined): boolean => {
  if (node === undefined) return false;
  if (node.type === 'parenthesized_expression') {
    const children = namedChildren(node);
    return children.length !== 1 || isDestructuringTarget(children[0]);
  }
  return ASSIGNMENT_TARGET_CONTAINERS.has(node.type);
};

const recordAssignmentWrite = (
  node: Node,
  left: Node | undefined,
  right: Node | undefined,
  path: readonly string[],
  context: Context,
  frame: Frame,
  destructured: boolean,
): void => {
  if ((path.length > 1 || (left?.type === 'subscript' && path.length > 0)) && right !== undefined) {
    context.assignments.push({
      target: path,
      ...(targetIncludesSubscript(left) ? { targetIncludesSubscript: true } : {}),
      value: destructured
        ? { kind: 'unknown', nodeType: 'destructuring_assignment' }
        : argumentFact(right, context),
      location: location(context.file, node),
      ...(frame.name === undefined ? {} : { enclosing: frame.name }),
    });
  }
};

const recordAssignmentDefinition = (
  node: Node,
  left: Node | undefined,
  right: Node | undefined,
  path: readonly string[],
  context: Context,
  frame: Frame,
): void => {
  const name = left === undefined || left.type === 'subscript' ? undefined : path.join('.');
  if (name === undefined || name.length === 0) return;
  const initializer =
    right !== undefined && right.type === 'call'
      ? attributePath(childField(right, 'function') ?? right)
      : undefined;
  const aliasedFrom = right === undefined ? [] : aliasedNames(right);
  const literals = right === undefined ? [] : boundLiterals(right, context);
  context.definitions.push({
    kind: 'variable',
    name,
    exported: !name.startsWith('_'),
    async: false,
    decorators: [],
    location: location(context.file, node),
    initializer: initializer !== undefined && initializer.length > 0 ? initializer : undefined,
    ...(right === undefined ? {} : { value: argumentFact(right, context) }),
    ...(aliasedFrom.length === 0 ? {} : { aliasedFrom }),
    ...(literals.length === 0 ? {} : { literals }),
    enclosing: frame.name,
    ...(frame.branches.length === 0 ? {} : { branches: frame.branches }),
  });
};

const recordAssignment = (
  node: Node,
  context: Context,
  frame: Frame,
  collecting: (readonly string[])[][],
  augmented = false,
): void => {
  const left = childField(node, 'left');
  const right = childField(node, 'right');
  const targets = left === undefined ? [] : assignmentTargets(left);
  const destructured = !augmented && isDestructuringTarget(left);
  /*
   * A plain root assignment is a definition. Member and subscript writes are retained separately so
   * consumers can refuse a stale value even when a computed key prevents exact member settlement.
   */
  for (const target of targets) {
    recordAssignmentWrite(
      node,
      target,
      right,
      assignmentPath(target),
      context,
      frame,
      destructured,
    );
  }
  const definitionTarget = augmented ? undefined : directDefinitionTarget(left);
  if (definitionTarget !== undefined && !ASSIGNMENT_TARGET_CONTAINERS.has(definitionTarget.type)) {
    recordAssignmentDefinition(
      node,
      definitionTarget,
      right,
      assignmentPath(definitionTarget),
      context,
      frame,
    );
  }
  if (right !== undefined) traverse(right, context, frame, collecting);
};

export const analyzePython = async (input: {
  readonly file: string;
  readonly text: string;
  readonly contentHash: string;
}): Promise<ModuleFacts> => {
  const parser = await pythonParser();
  const context: Context = {
    file: input.file,
    bindings: new Map(),
    imports: [],
    calls: [],
    assignments: [],
    definitions: [],
    environmentRefs: [],
    texts: [],
    controlFlow: [],
    documentationOffsets: new Set(),
  };
  const tree = parser.parse(input.text);
  if (tree === null) {
    return {
      file: input.file,
      language: 'python',
      contentHash: input.contentHash,
      imports: [],
      exportedNames: [],
      calls: [],
      assignments: [],
      definitions: [],
      environmentRefs: [],
      texts: [],
      controlFlow: [],
      parseErrors: ['the Python parser returned no tree'],
    };
  }
  try {
    const root = tree.rootNode;
    recordDocumentationStrings(root, context);
    for (const child of namedChildren(root)) {
      traverse(
        child,
        context,
        { name: undefined, awaited: false, typeOnly: false, branches: [] },
        [],
      );
    }
    return {
      file: input.file,
      language: 'python',
      contentHash: input.contentHash,
      imports: context.imports,
      exportedNames: context.definitions
        .filter((definition) => definition.exported)
        .map((definition) => definition.name),
      calls: context.calls,
      definitions: context.definitions,
      environmentRefs: context.environmentRefs,
      texts: context.texts,
      assignments: context.assignments,
      controlFlow: context.controlFlow,
      parseErrors: root.hasError ? ['the file contains at least one syntax error'] : [],
    };
  } finally {
    // The tree lives in WebAssembly memory and is not reclaimed by the JavaScript collector.
    tree.delete();
  }
};
