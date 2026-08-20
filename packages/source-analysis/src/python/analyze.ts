import type { SourceLocation } from '@orchescope/schema';
import type { Node } from 'web-tree-sitter';
import {
  type ArgumentFact,
  type AssignmentFact,
  approximateTokens,
  type CalleeOrigin,
  type CallFact,
  type ControlFlowFact,
  type DecoratorFact,
  type DefinitionFact,
  type EnvironmentFact,
  type ImportFact,
  type ModuleFacts,
  type ObjectEntryFact,
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
const substitutedNamesIn = (node: Node): readonly string[] => {
  const names = new Set<string>();
  const walk = (candidate: Node): void => {
    if (names.size >= MAX_SUBSTITUTED_NAMES) return;
    if (candidate.type === 'identifier') {
      names.add(candidate.text);
      return;
    }
    for (const child of candidate.namedChildren) walk(child);
  };
  for (const child of namedChildren(node)) {
    if (child.type === 'interpolation') walk(child);
  }
  return [...names];
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
};

const argumentFact = (node: Node, context: Context): ArgumentFact => {
  switch (node.type) {
    case 'string': {
      const value = stringLiteralValue(node);
      if (value === undefined) return { kind: 'unknown', nodeType: node.type };
      return hasInterpolation(node)
        ? {
            kind: 'template',
            value,
            hasSubstitutions: true,
            substitutedNames: substitutedNamesIn(node),
          }
        : { kind: 'string', value };
    }
    case 'integer':
    case 'float': {
      const value = Number(node.text);
      return Number.isFinite(value)
        ? { kind: 'number', value }
        : { kind: 'unknown', nodeType: node.type };
    }
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
    case 'call': {
      /*
       * Reduced the same way a call at the top level is, because it is the same shape and a reader
       * asking what it was given cannot know how deeply it was nested. Mapping the children one by one
       * left every keyword argument of a nested call as an unknown: `stop_after_attempt(15)` read
       * correctly and `stop_after_attempt(max_attempt_number=15)` did not, and the two are one policy
       * spelled two ways.
       */
      const callee = childField(node, 'function');
      const { positional, keywords } = splitArguments(node, context);
      return {
        kind: 'call',
        path: callee === undefined ? [] : attributePath(callee),
        args:
          keywords.length === 0
            ? positional
            : [...positional, { kind: 'object', entries: keywords }],
      };
    }
    case 'list':
    case 'tuple':
    case 'set': {
      const items = namedChildren(node).map((child) => argumentFact(child, context));
      return { kind: 'array', items };
    }
    case 'dictionary': {
      const entries: ObjectEntryFact[] = [];
      for (const pair of namedChildren(node)) {
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
      return { kind: 'object', entries };
    }
    case 'lambda':
      return { kind: 'function' };
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

const recordImport = (node: Node, context: Context): void => {
  if (node.type === 'import_statement') {
    for (const child of namedChildren(node)) {
      if (child.type === 'dotted_name') {
        const moduleName = child.text;
        const local = moduleName.split('.')[0] ?? moduleName;
        context.imports.push({
          module: moduleName,
          imported: '*',
          local,
          isType: false,
          location: location(context.file, child),
        });
        context.bindings.set(local, { module: moduleName, imported: '*', isType: false });
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
          isType: false,
          location: location(context.file, child),
        });
        context.bindings.set(aliasNode.text, {
          module: nameNode.text,
          imported: '*',
          isType: false,
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
      isType: false,
      location: location(context.file, node),
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
        isType: false,
        location: location(context.file, child),
      });
      context.bindings.set(imported, { module: moduleName, imported, isType: false });
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
        isType: false,
        location: location(context.file, child),
      });
      context.bindings.set(aliasNode.text, {
        module: moduleName,
        imported: nameNode.text,
        isType: false,
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

type Frame = { readonly name: string | undefined; readonly awaited: boolean };

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

/**
 * The identifiers a `while` names in its condition, which is where a retry counts its attempts.
 *
 * The condition is the child before the body, and every identifier under it is collected: `while attempt <
 * MAX_ATTEMPTS` names both, and either is the author saying what the loop is doing.
 */
const conditionNames = (node: Node): readonly string[] => {
  const names = new Set<string>();
  const walk = (candidate: Node | null): void => {
    if (candidate === null || names.size >= MAX_HEADER_NAMES) return;
    if (candidate.type === 'identifier') {
      names.add(candidate.text);
      return;
    }
    for (const child of namedChildren(candidate)) walk(child);
  };
  walk(node.childForFieldName('condition'));
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

/** Whether a pass succeeds out of this `try` and fails through it, which is one attempt of a retry. */
const exitsOnSuccessIn = (node: Node): boolean => {
  const body = node.childForFieldName('body');
  if (!endsTheWork(body)) return false;
  return !node.namedChildren.some((child) => child.type === 'except_clause' && endsTheWork(child));
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
      const { positional, keywords } = splitArguments(inner, context);
      facts.push({
        path,
        origin: path[0] === undefined ? undefined : context.bindings.get(path[0]),
        args:
          keywords.length === 0
            ? positional
            : [...positional, { kind: 'object', entries: keywords }],
      });
      continue;
    }
    const path = attributePath(inner);
    facts.push({
      path,
      origin: path[0] === undefined ? undefined : context.bindings.get(path[0]),
      args: [],
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
): { positional: ArgumentFact[]; keywords: ObjectEntryFact[] } => {
  const positional: ArgumentFact[] = [];
  const keywords: ObjectEntryFact[] = [];
  const list = childField(call, 'arguments');
  if (list === undefined) return { positional, keywords };
  for (const child of namedChildren(list)) {
    if (child.type === 'dictionary_splat') continue;
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
  return { positional, keywords };
};

const traverse = (
  node: Node,
  context: Context,
  frame: Frame,
  collecting: (readonly string[])[][],
): void => {
  const controlKind = CONTROL_FLOW_TYPES[node.type];
  if (controlKind !== undefined) {
    const contains: (readonly string[])[] = [];
    collecting.push(contains);
    for (const child of namedChildren(node)) traverse(child, context, frame, collecting);
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
        ? { headerNames: conditionNames(node), growingNames: growingNamesOf(node) }
        : {}),
    });
    return;
  }

  switch (node.type) {
    case 'import_statement':
    case 'import_from_statement':
      recordImport(node, context);
      return;
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
  const { positional, keywords } = splitArguments(node, context);
  const args =
    keywords.length === 0
      ? positional
      : [...positional, { kind: 'object' as const, entries: keywords }];

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
  context.definitions.push({
    kind: frame.name === undefined ? 'function' : 'method',
    name: frame.name === undefined ? name : `${frame.name}.${name}`,
    exported: !name.startsWith('_'),
    async: isAsync,
    decorators,
    location: location(context.file, node),
    initializer: undefined,
    enclosing: frame.name,
  });
  const body = childField(node, 'body');
  if (body !== undefined) {
    traverse(body, context, { name, awaited: false }, collecting);
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
  });
  const body = childField(node, 'body');
  if (body !== undefined) traverse(body, context, { name, awaited: false }, collecting);
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

const recordAssignment = (
  node: Node,
  context: Context,
  frame: Frame,
  collecting: (readonly string[])[][],
): void => {
  const left = childField(node, 'left');
  const right = childField(node, 'right');
  const path = left === undefined ? [] : attributePath(left);
  /*
   * A value written onto something that already exists, kept only where the target is a member.
   *
   * A plain `x = ...` is already a variable definition and adding it here would say the same thing twice. What is
   * not said anywhere else is `agent.handoffs = [...]`, which is how a repository wires a cycle it could not name
   * in a constructor.
   */
  if (path.length > 1 && right !== undefined) {
    context.assignments.push({
      target: path,
      value: argumentFact(right, context),
      location: location(context.file, node),
    });
  }
  const name = left === undefined ? undefined : path.join('.');
  if (name !== undefined && name.length > 0) {
    const initializer =
      right !== undefined && right.type === 'call'
        ? attributePath(childField(right, 'function') ?? right)
        : undefined;
    const aliasedFrom = right === undefined ? [] : aliasedNames(right);
    context.definitions.push({
      kind: 'variable',
      name,
      exported: !name.startsWith('_'),
      async: false,
      decorators: [],
      location: location(context.file, node),
      initializer: initializer !== undefined && initializer.length > 0 ? initializer : undefined,
      ...(aliasedFrom.length === 0 ? {} : { aliasedFrom }),
      enclosing: frame.name,
    });
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
    for (const child of namedChildren(root)) {
      traverse(child, context, { name: undefined, awaited: false }, []);
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
