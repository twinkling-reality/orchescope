import { parseSync } from 'oxc-parser';
import {
  type ArgumentFact,
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
import type { Language } from '../language.ts';
import { buildLineIndex, type LineIndex } from '../line-index.ts';

/**
 * JavaScript and TypeScript fact extraction, built on `oxc-parser`.
 *
 * One traversal produces every fact. The traversal tracks the enclosing named scope and the awaited
 * state so that a call can be attributed to the function it lives in, and so that a sequence of
 * awaited calls can be distinguished from a set of calls started together.
 */

type Node = { readonly type: string; readonly start: number; readonly end: number } & Record<
  string,
  unknown
>;

const asNode = (value: unknown): Node | undefined =>
  typeof value === 'object' && value !== null && typeof (value as Node).type === 'string'
    ? (value as Node)
    : undefined;

const field = (node: Node, key: string): unknown => (node as Record<string, unknown>)[key];

const nodeArray = (value: unknown): readonly Node[] => {
  if (!Array.isArray(value)) return [];
  const nodes: Node[] = [];
  for (const item of value) {
    const node = asNode(item);
    if (node !== undefined) nodes.push(node);
  }
  return nodes;
};

const identifierName = (node: Node | undefined): string | undefined => {
  if (node === undefined) return undefined;
  if (node.type === 'Identifier') {
    const name = field(node, 'name');
    return typeof name === 'string' ? name : undefined;
  }
  if (node.type === 'PrivateIdentifier') {
    const name = field(node, 'name');
    return typeof name === 'string' ? `#${name}` : undefined;
  }
  return undefined;
};

const literalString = (node: Node | undefined): string | undefined => {
  if (node === undefined) return undefined;
  if (node.type === 'Literal') {
    const value = field(node, 'value');
    return typeof value === 'string' ? value : undefined;
  }
  if (node.type === 'StringLiteral') {
    const value = field(node, 'value');
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
};

/** Resolves `a.b.c` and `a["b"]` into a dotted path. Returns an empty path for dynamic access. */
const memberPath = (node: Node): readonly string[] => {
  const parts: string[] = [];
  let current: Node | undefined = node;
  while (current !== undefined) {
    if (current.type === 'MemberExpression' || current.type === 'StaticMemberExpression') {
      const property = asNode(field(current, 'property'));
      const name = identifierName(property) ?? literalString(property);
      if (name === undefined) return [];
      parts.unshift(name);
      current = asNode(field(current, 'object'));
      continue;
    }
    if (current.type === 'ComputedMemberExpression') {
      const expression = asNode(field(current, 'expression'));
      const name = literalString(expression);
      if (name === undefined) return [];
      parts.unshift(name);
      current = asNode(field(current, 'object'));
      continue;
    }
    if (current.type === 'CallExpression' || current.type === 'NewExpression') {
      const callee = asNode(field(current, 'callee'));
      if (callee === undefined) return [];
      const inner = calleePath(callee);
      if (inner.length === 0) return [];
      parts.unshift(...inner);
      return parts;
    }
    if (current.type === 'ThisExpression') {
      parts.unshift('this');
      return parts;
    }
    const name = identifierName(current);
    if (name === undefined) return [];
    parts.unshift(name);
    return parts;
  }
  return parts;
};

const calleePath = (callee: Node): readonly string[] => {
  const name = identifierName(callee);
  if (name !== undefined) return [name];
  if (
    callee.type === 'MemberExpression' ||
    callee.type === 'StaticMemberExpression' ||
    callee.type === 'ComputedMemberExpression'
  ) {
    return memberPath(callee);
  }
  return [];
};

/** Enough of a template to recognise which prompt it is splicing. */
const MAX_SUBSTITUTED_NAMES = 8;

const templateValue = (
  node: Node,
): { value: string; hasSubstitutions: boolean; substitutedNames: readonly string[] } => {
  const quasis = nodeArray(field(node, 'quasis'));
  const expressions = nodeArray(field(node, 'expressions'));
  const substituted = new Set<string>();
  for (const expression of expressions) {
    collectIdentifiers(expression, substituted, MAX_SUBSTITUTED_NAMES);
  }
  const parts: string[] = [];
  for (const quasi of quasis) {
    const cooked = asNode(field(quasi, 'value'));
    const raw = cooked === undefined ? field(quasi, 'value') : field(cooked, 'cooked');
    if (typeof raw === 'string') parts.push(raw);
    else {
      const value = field(quasi, 'value');
      if (typeof value === 'object' && value !== null) {
        const cookedValue = (value as Record<string, unknown>)['cooked'];
        if (typeof cookedValue === 'string') parts.push(cookedValue);
      }
    }
  }
  return {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: this is the marker recorded in place of a substitution
    value: parts.join('${...}'),
    hasSubstitutions: expressions.length > 0,
    substitutedNames: [...substituted],
  };
};

type Context = {
  readonly file: string;
  readonly index: LineIndex;
  readonly bindings: Map<string, CalleeOrigin>;
  readonly imports: ImportFact[];
  readonly calls: CallFact[];
  readonly definitions: DefinitionFact[];
  readonly environmentRefs: EnvironmentFact[];
  readonly texts: TextFact[];
  readonly controlFlow: ControlFlowFact[];
  readonly exportedNames: Set<string>;
};

const argumentFact = (node: Node, context: Context): ArgumentFact => {
  switch (node.type) {
    case 'Literal': {
      const value = field(node, 'value');
      if (typeof value === 'string') return { kind: 'string', value };
      if (typeof value === 'number') return { kind: 'number', value };
      if (typeof value === 'boolean') return { kind: 'boolean', value };
      if (value === null) return { kind: 'null' };
      return { kind: 'unknown', nodeType: node.type };
    }
    case 'StringLiteral': {
      const value = field(node, 'value');
      return typeof value === 'string'
        ? { kind: 'string', value }
        : { kind: 'unknown', nodeType: node.type };
    }
    case 'NumericLiteral': {
      const value = field(node, 'value');
      return typeof value === 'number'
        ? { kind: 'number', value }
        : { kind: 'unknown', nodeType: node.type };
    }
    case 'BooleanLiteral': {
      const value = field(node, 'value');
      return typeof value === 'boolean'
        ? { kind: 'boolean', value }
        : { kind: 'unknown', nodeType: node.type };
    }
    case 'NullLiteral':
      return { kind: 'null' };
    case 'TemplateLiteral': {
      const template = templateValue(node);
      return {
        kind: 'template',
        value: template.value,
        hasSubstitutions: template.hasSubstitutions,
        substitutedNames: template.substitutedNames,
      };
    }
    case 'Identifier': {
      const name = identifierName(node);
      return name === undefined
        ? { kind: 'unknown', nodeType: node.type }
        : { kind: 'identifier', name };
    }
    case 'ObjectExpression':
      return { kind: 'object', entries: objectEntries(node, context) };
    case 'ArrayExpression': {
      const items: ArgumentFact[] = [];
      for (const element of nodeArray(field(node, 'elements'))) {
        items.push(argumentFact(element, context));
      }
      return { kind: 'array', items };
    }
    case 'MemberExpression':
    case 'StaticMemberExpression':
    case 'ComputedMemberExpression': {
      const path = memberPath(node);
      return path.length === 0
        ? { kind: 'unknown', nodeType: node.type }
        : { kind: 'member', path };
    }
    case 'CallExpression':
    case 'NewExpression': {
      const callee = asNode(field(node, 'callee'));
      const path = callee === undefined ? [] : calleePath(callee);
      return {
        kind: 'call',
        path,
        args: nodeArray(field(node, 'arguments')).map((argument) =>
          argumentFact(argument, context),
        ),
      };
    }
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
      return { kind: 'function' };
    case 'AwaitExpression':
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSNonNullExpression': {
      const inner = asNode(field(node, 'expression')) ?? asNode(field(node, 'argument'));
      return inner === undefined
        ? { kind: 'unknown', nodeType: node.type }
        : argumentFact(inner, context);
    }
    case 'BinaryExpression': {
      const flattened = arithmeticParts(node);
      return { kind: 'arithmetic', operators: flattened.operators, names: flattened.names };
    }
    default:
      return { kind: 'unknown', nodeType: node.type };
  }
};

/**
 * Every operator and every name in a computed value, with the nesting flattened away.
 *
 * A backoff is written as one expression and read as one fact: whether the wait grows. `base * 2 ** (n -
 * 1)` nests exponentiation inside multiplication inside subtraction, and which of those sits at the top
 * is an accident of precedence rather than something a reader of the graph should have to undo.
 */
const arithmeticParts = (
  node: Node,
): { readonly operators: readonly string[]; readonly names: readonly string[] } => {
  const operators = new Set<string>();
  const names = new Set<string>();
  const walk = (current: Node | undefined): void => {
    if (current === undefined) return;
    if (current.type === 'BinaryExpression') {
      const operator = field(current, 'operator');
      if (typeof operator === 'string') operators.add(operator);
      walk(asNode(field(current, 'left')));
      walk(asNode(field(current, 'right')));
      return;
    }
    if (current.type === 'ParenthesizedExpression') {
      walk(asNode(field(current, 'expression')));
      return;
    }
    /*
     * A call inside a computed value is part of it. `100 * Math.pow(2, attempt)` says the same thing as
     * `100 * 2 ** attempt`, and reading the multiplication while stepping over the call left the one
     * name that makes it exponential out of the fact.
     */
    if (current.type === 'CallExpression' || current.type === 'NewExpression') {
      const callee = asNode(field(current, 'callee'));
      if (callee !== undefined) for (const segment of calleePath(callee)) names.add(segment);
      for (const argument of nodeArray(field(current, 'arguments'))) walk(argument);
      return;
    }
    for (const segment of calleePath(current)) names.add(segment);
  };
  walk(node);
  return { operators: [...operators], names: [...names] };
};

const objectEntries = (node: Node, context: Context): readonly ObjectEntryFact[] => {
  const entries: ObjectEntryFact[] = [];
  for (const property of nodeArray(field(node, 'properties'))) {
    if (property.type !== 'Property' && property.type !== 'ObjectProperty') continue;
    const keyNode = asNode(field(property, 'key'));
    const key = identifierName(keyNode) ?? literalString(keyNode);
    const valueNode = asNode(field(property, 'value'));
    if (key === undefined || valueNode === undefined) continue;
    entries.push({
      key,
      value: argumentFact(valueNode, context),
      location: context.index.location(context.file, property.start, property.end),
    });
  }
  return entries;
};

const recordImports = (program: Node, context: Context, module: unknown): void => {
  const record = module as {
    staticImports?: readonly {
      moduleRequest: { value: string; start: number };
      entries: readonly {
        importName: { kind: string; name?: string };
        localName: { value: string; start: number };
        isType: boolean;
      }[];
    }[];
    staticExports?: readonly { entries: readonly { exportName: { name?: string } }[] }[];
  };
  for (const entry of record.staticImports ?? []) {
    const moduleName = entry.moduleRequest.value;
    for (const item of entry.entries) {
      const imported =
        item.importName.kind === 'NamespaceObject'
          ? '*'
          : (item.importName.name ?? (item.importName.kind === 'Default' ? 'default' : '*'));
      const fact: ImportFact = {
        module: moduleName,
        imported,
        local: item.localName.value,
        isType: item.isType,
        location: context.index.location(context.file, item.localName.start),
      };
      context.imports.push(fact);
      context.bindings.set(fact.local, {
        module: moduleName,
        imported,
        isType: item.isType,
      });
    }
  }
  for (const exported of record.staticExports ?? []) {
    for (const item of exported.entries) {
      if (item.exportName.name !== undefined) context.exportedNames.add(item.exportName.name);
    }
  }
  void program;
};

const originFor = (path: readonly string[], context: Context): CalleeOrigin | undefined => {
  const root = path[0];
  return root === undefined ? undefined : context.bindings.get(root);
};

const decoratorFacts = (node: Node, context: Context): readonly DecoratorFact[] => {
  const facts: DecoratorFact[] = [];
  for (const decorator of nodeArray(field(node, 'decorators'))) {
    const expression = asNode(field(decorator, 'expression'));
    if (expression === undefined) continue;
    if (expression.type === 'CallExpression') {
      const callee = asNode(field(expression, 'callee'));
      const path = callee === undefined ? [] : calleePath(callee);
      facts.push({
        path,
        origin: originFor(path, context),
        args: nodeArray(field(expression, 'arguments')).map((argument) =>
          argumentFact(argument, context),
        ),
      });
      continue;
    }
    const path = calleePath(expression);
    facts.push({ path, origin: originFor(path, context), args: [] });
  }
  return facts;
};

/**
 * Two names travel down the traversal because two questions have different answers.
 *
 * `name` is the nearest enclosing function, which is what a call belongs to. `declaredName` is the nearest enclosing
 * declaration, which is what a piece of text belongs to: the strings inside `const POLICY_DOCUMENTS = [...]` are that
 * constant, however deeply they are nested, while a call in the same function belongs to the function.
 */
type Frame = {
  readonly name: string | undefined;
  readonly declaredName: string | undefined;
  readonly exported: boolean;
};

const ENV_ROOTS = ['process', 'env'];

const isEnvironmentAccess = (path: readonly string[]): string | undefined => {
  if (path.length >= 3 && path[0] === 'process' && path[1] === 'env') return path[2];
  if (path.length === 2 && ENV_ROOTS.includes(path[0] ?? '') && path[0] === 'env') return path[1];
  return undefined;
};

const CONTROL_FLOW_TYPES: Readonly<Record<string, ControlFlowFact['kind']>> = {
  TryStatement: 'try_catch',
  ForStatement: 'loop',
  ForOfStatement: 'loop',
  ForInStatement: 'loop',
  WhileStatement: 'loop',
  DoWhileStatement: 'loop',
};

/**
 * What a loop's form says about whether its passes repeat work or walk a collection.
 *
 * `for...of` and `for...in` bind the next element on every pass, so no pass can be a re-attempt of the
 * one before it. The rest can be either, and are recorded as repeating the same work because that is the
 * shape a retry has to take.
 */
const LOOP_REPETITION: Readonly<Record<string, 'same_work' | 'each_item'>> = {
  ForStatement: 'same_work',
  WhileStatement: 'same_work',
  DoWhileStatement: 'same_work',
  ForOfStatement: 'each_item',
  ForInStatement: 'each_item',
};

/** Enough of a header to recognise a counter by the name its author gave it. */
const MAX_HEADER_NAMES = 8;

const collectIdentifiers = (node: Node | undefined, into: Set<string>, limit: number): void => {
  if (node === undefined || into.size >= limit) return;
  if (node.type === 'Identifier') {
    const name = field(node, 'name');
    if (typeof name === 'string') into.add(name);
    return;
  }
  for (const key of Object.keys(node as Record<string, unknown>)) {
    const value = field(node, key);
    if (Array.isArray(value)) {
      for (const entry of value) collectIdentifiers(asNode(entry), into, limit);
      continue;
    }
    collectIdentifiers(asNode(value), into, limit);
  }
};

/**
 * Names the loop writes to anywhere inside itself, which is how a counter advances and how a bound grows.
 *
 * Uncapped, unlike the header names, because this set is read for absence as well as presence. A name
 * missing from it because a cap was reached would report a bound that grows as one that holds still, and
 * that is the direction in which a wrong answer here costs the most.
 */
const collectAssignedNames = (node: Node | undefined, into: Set<string>): void => {
  if (node === undefined) return;
  if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') {
    const target = asNode(field(node, 'left')) ?? asNode(field(node, 'argument'));
    if (target?.type === 'Identifier') {
      const name = field(target, 'name');
      if (typeof name === 'string') into.add(name);
    }
  }
  for (const key of Object.keys(node as Record<string, unknown>)) {
    const value = field(node, key);
    if (Array.isArray(value)) {
      for (const entry of value) collectAssignedNames(asNode(entry), into);
      continue;
    }
    collectAssignedNames(asNode(value), into);
  }
};

/**
 * Operators that compare a value against a bound, as opposed to testing whether something has happened.
 *
 * This is the distinction between a loop that counts toward a limit and one that runs until a flag flips.
 * `while (!done)` and `while (running)` state no ceiling and never did; `while (attempt < maxAttempts)`
 * states exactly the ceiling a three part `for` states, in the other spelling.
 */
const COUNTING_OPERATORS = new Set(['<', '<=', '>', '>=']);

/**
 * Whether a comparison closes, given the names the loop writes to.
 *
 * A comparison against a bound is only a ceiling when the two sides move apart: one of them advances and
 * the other holds still. `while (attempt < maxAttempts)` with nothing incrementing `attempt` never ends,
 * and neither does the same head with `maxAttempts` growing every pass, and both were read as bounded on
 * the strength of the operator alone. An infinite retry around a POST reported as having an attempt limit
 * is the false positive that costs the most, because the rule that would have caught it declines.
 *
 * Exactly one side, so the orientation does not matter: `0 < remaining` counting down is the same
 * statement as `attempt < max` counting up. Two sides that both move is a refusal rather than a claim.
 * They may converge, and a reader would need to know which way each one goes, which is more than the
 * shape of the head settles.
 */
const comparisonCloses = (test: Node, advanced: ReadonlySet<string>): boolean => {
  const operator = field(test, 'operator');
  if (typeof operator !== 'string' || !COUNTING_OPERATORS.has(operator)) return false;
  const moves = (key: string): boolean => {
    const names = new Set<string>();
    collectIdentifiers(asNode(field(test, key)), names, Number.POSITIVE_INFINITY);
    return [...names].some((name) => advanced.has(name));
  };
  return moves('left') !== moves('right');
};

/**
 * Whether a test closes, following the way it is joined.
 *
 * `while (running && attempt < max)` is bounded by its second operand whatever the first one does, since
 * `&&` ends the loop as soon as any operand is false. `||` runs while any operand holds, so every one of
 * them has to close. A negation is refused rather than inverted, because what a reader would have to
 * work out is not what the head says.
 */
const testCloses = (test: Node, advanced: ReadonlySet<string>): boolean => {
  if (test.type === 'BinaryExpression') return comparisonCloses(test, advanced);
  if (test.type === 'ParenthesizedExpression') {
    const inner = asNode(field(test, 'expression'));
    return inner !== undefined && testCloses(inner, advanced);
  }
  if (test.type !== 'LogicalExpression') return false;
  const operator = field(test, 'operator');
  const left = asNode(field(test, 'left'));
  const right = asNode(field(test, 'right'));
  if (left === undefined || right === undefined) return false;
  return operator === '&&'
    ? testCloses(left, advanced) || testCloses(right, advanced)
    : operator === '||' && testCloses(left, advanced) && testCloses(right, advanced);
};

/**
 * Whether the loop's own form limits how many passes it makes.
 *
 * A `for...of` is bounded by the collection it walks. Every other loop is bounded when its head compares
 * a counter against a bound and the body moves one of them, which is one question rather than two: a
 * three part `for` and a `while` state a ceiling the same way, and `for (let attempt = 0; true;
 * attempt++)` states none despite having a test in the position where a ceiling would go.
 *
 * Reading every `while` as unbounded reported a retry that declares `const max = 3` and honours it as
 * having no attempt limit, which is the accusation this rule exists to avoid making. Reading a test as a
 * ceiling without asking whether it can ever be false made the opposite mistake, which is worse: the
 * reader was told an infinite retry was bounded.
 */
const passesBoundedIn = (node: Node): boolean => {
  if (node.type === 'ForOfStatement' || node.type === 'ForInStatement') return true;
  if (
    node.type !== 'ForStatement' &&
    node.type !== 'WhileStatement' &&
    node.type !== 'DoWhileStatement'
  ) {
    return false;
  }
  const test = asNode(field(node, 'test'));
  if (test === undefined) return false;
  const advanced = new Set<string>();
  collectAssignedNames(asNode(field(node, 'update')), advanced);
  collectAssignedNames(asNode(field(node, 'body')), advanced);
  return testCloses(test, advanced);
};

/**
 * Whether a statement here ends the enclosing work.
 *
 * A nested function is not descended into: `items.map(() => { return x })` returns from the callback and
 * says nothing about the block holding it, and counting it would make almost every block look like one
 * that exits.
 */
const endsTheWork = (node: Node | undefined): boolean => {
  if (node === undefined) return false;
  if (node.type === 'ReturnStatement' || node.type === 'BreakStatement') return true;
  if (FUNCTION_TYPES.has(node.type)) return false;
  for (const key of Object.keys(node as Record<string, unknown>)) {
    const value = field(node, key);
    if (Array.isArray(value)) {
      if (value.some((entry) => endsTheWork(asNode(entry)))) return true;
      continue;
    }
    if (endsTheWork(asNode(value))) return true;
  }
  return false;
};

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

/** Whether a pass succeeds out of this `try` and fails through it, which is one attempt of a retry. */
const exitsOnSuccessIn = (node: Node): boolean =>
  endsTheWork(asNode(field(node, 'block'))) && !endsTheWork(asNode(field(node, 'handler')));

/**
 * Ways a value is made to grow by a factor rather than by a step.
 *
 * A wait that doubles is a backoff and a wait that gains a hundred milliseconds is not, and this is the
 * whole of the difference in the syntax. The compound forms and the long form of the same statement,
 * because `delayMs *= 2` and `delayMs = delayMs * 2` are one thing written two ways.
 */
const GROWING_ASSIGNMENTS = new Set(['*=', '**=', '<<=']);
const GROWING_OPERATORS = new Set(['*', '**', '<<']);

const growsByFactor = (node: Node, target: string): boolean => {
  const operator = field(node, 'operator');
  if (typeof operator !== 'string') return false;
  if (GROWING_ASSIGNMENTS.has(operator)) return true;
  if (operator !== '=') return false;
  const right = asNode(field(node, 'right'));
  if (right === undefined || right.type !== 'BinaryExpression') return false;
  const parts = arithmeticParts(right);
  return (
    parts.operators.some((entry) => GROWING_OPERATORS.has(entry)) && parts.names.includes(target)
  );
};

/** Names the loop multiplies on each pass, which is a wait growing one statement away from its call. */
const collectGrowingNames = (node: Node | undefined, into: Set<string>): void => {
  if (node === undefined) return;
  if (node.type === 'AssignmentExpression') {
    const target = asNode(field(node, 'left'));
    const name = target?.type === 'Identifier' ? field(target, 'name') : undefined;
    if (typeof name === 'string' && growsByFactor(node, name)) into.add(name);
  }
  for (const key of Object.keys(node as Record<string, unknown>)) {
    const value = field(node, key);
    if (Array.isArray(value)) {
      for (const entry of value) collectGrowingNames(asNode(entry), into);
      continue;
    }
    collectGrowingNames(asNode(value), into);
  }
};

const growingNamesOf = (node: Node): readonly string[] => {
  const names = new Set<string>();
  collectGrowingNames(asNode(field(node, 'body')), names);
  return [...names];
};

/** The identifiers a loop names in its own header, which is where a retry counts its attempts. */
const headerNamesOf = (node: Node): readonly string[] => {
  const names = new Set<string>();
  for (const key of ['init', 'test', 'update']) {
    collectIdentifiers(asNode(field(node, key)), names, MAX_HEADER_NAMES);
  }
  return [...names];
};

/**
 * Single traversal. `enclosing` is the nearest named scope, `awaited` marks a call that the caller
 * waits for, and `collecting` accumulates callee paths for the control flow construct being visited.
 */
const traverse = (
  node: Node,
  context: Context,
  frame: Frame,
  awaited: boolean,
  collecting: (readonly string[])[][],
): void => {
  const kind = CONTROL_FLOW_TYPES[node.type];
  if (kind !== undefined) {
    const contains: (readonly string[])[] = [];
    collecting.push(contains);
    visitChildren(node, context, frame, false, collecting);
    collecting.pop();
    const repeats = LOOP_REPETITION[node.type];
    context.controlFlow.push({
      kind,
      location: context.index.location(context.file, node.start, node.end),
      enclosing: frame.name,
      contains,
      ...(repeats === undefined ? {} : { repeats, passesBounded: passesBoundedIn(node) }),
      ...(repeats === 'same_work'
        ? { headerNames: headerNamesOf(node), growingNames: growingNamesOf(node) }
        : {}),
      ...(kind === 'try_catch' ? { exitsOnSuccess: exitsOnSuccessIn(node) } : {}),
    });
    return;
  }

  switch (node.type) {
    case 'ImportDeclaration':
    case 'TSTypeAliasDeclaration':
    case 'TSInterfaceDeclaration':
      return;
    case 'CallExpression':
    case 'NewExpression': {
      recordCall(node, context, frame, awaited, collecting);
      return;
    }
    case 'AwaitExpression': {
      const argument = asNode(field(node, 'argument'));
      if (argument !== undefined) traverse(argument, context, frame, true, collecting);
      return;
    }
    case 'FunctionDeclaration':
    case 'TSDeclareFunction': {
      recordFunction(node, context, frame, collecting);
      return;
    }
    case 'ClassDeclaration': {
      recordClass(node, context, frame, collecting);
      return;
    }
    case 'VariableDeclaration': {
      recordVariables(node, context, frame, collecting);
      return;
    }
    case 'ExportNamedDeclaration':
    case 'ExportDefaultDeclaration': {
      const declaration = asNode(field(node, 'declaration'));
      if (declaration !== undefined) {
        traverse(declaration, context, { ...frame, exported: true }, awaited, collecting);
      }
      return;
    }
    case 'TemplateLiteral': {
      const template = templateValue(node);
      recordText(template.value, template.hasSubstitutions, node, context, frame);
      visitChildren(node, context, frame, awaited, collecting);
      return;
    }
    case 'Literal':
    case 'StringLiteral': {
      const value = literalString(node);
      if (value !== undefined) recordText(value, false, node, context, frame);
      return;
    }
    case 'MemberExpression':
    case 'StaticMemberExpression':
    case 'ComputedMemberExpression': {
      const path = memberPath(node);
      const envName = isEnvironmentAccess(path);
      if (envName !== undefined) {
        context.environmentRefs.push({
          name: envName,
          location: context.index.location(context.file, node.start, node.end),
          enclosing: frame.name,
        });
        return;
      }
      visitChildren(node, context, frame, awaited, collecting);
      return;
    }
    default:
      visitChildren(node, context, frame, awaited, collecting);
  }
};

const visitChildren = (
  node: Node,
  context: Context,
  frame: Frame,
  awaited: boolean,
  collecting: (readonly string[])[][],
): void => {
  for (const [key, value] of Object.entries(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'parent') continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        const child = asNode(item);
        if (child !== undefined) traverse(child, context, frame, awaited, collecting);
      }
      continue;
    }
    const child = asNode(value);
    if (child !== undefined) traverse(child, context, frame, awaited, collecting);
  }
};

const recordCall = (
  node: Node,
  context: Context,
  frame: Frame,
  awaited: boolean,
  collecting: (readonly string[])[][],
): void => {
  const callee = asNode(field(node, 'callee'));
  const path = callee === undefined ? [] : calleePath(callee);
  const args = nodeArray(field(node, 'arguments')).map((argument) =>
    argumentFact(argument, context),
  );
  const fact: CallFact = {
    kind: node.type === 'NewExpression' ? 'new' : 'call',
    calleePath: path,
    origin: originFor(path, context),
    args,
    location: context.index.location(context.file, node.start, node.end),
    offset: node.start,
    enclosing: frame.name,
    awaited,
  };
  context.calls.push(fact);
  const current = collecting[collecting.length - 1];
  if (current !== undefined && path.length > 0) current.push(path);
  for (const child of nodeArray(field(node, 'arguments'))) {
    traverse(child, context, frame, false, collecting);
  }
  if (callee !== undefined && callee.type !== 'Identifier') {
    visitChildren(callee, context, frame, false, collecting);
  }
};

const recordFunction = (
  node: Node,
  context: Context,
  frame: Frame,
  collecting: (readonly string[])[][],
): void => {
  const name = identifierName(asNode(field(node, 'id')));
  const definition: DefinitionFact = {
    kind: 'function',
    name: name ?? '(anonymous)',
    exported: frame.exported,
    async: field(node, 'async') === true,
    decorators: decoratorFacts(node, context),
    location: context.index.location(context.file, node.start, node.end),
    initializer: undefined,
    enclosing: frame.name,
  };
  context.definitions.push(definition);
  const body = asNode(field(node, 'body'));
  if (body !== undefined) {
    traverse(
      body,
      context,
      { name: name ?? frame.name, declaredName: undefined, exported: false },
      false,
      collecting,
    );
  }
};

const recordClass = (
  node: Node,
  context: Context,
  frame: Frame,
  collecting: (readonly string[])[][],
): void => {
  const name = identifierName(asNode(field(node, 'id')));
  context.definitions.push({
    kind: 'class',
    name: name ?? '(anonymous)',
    exported: frame.exported,
    async: false,
    decorators: decoratorFacts(node, context),
    location: context.index.location(context.file, node.start, node.end),
    initializer: undefined,
    enclosing: frame.name,
  });
  const body = asNode(field(node, 'body'));
  if (body === undefined) return;
  for (const member of nodeArray(field(body, 'body'))) {
    if (member.type === 'MethodDefinition') {
      const methodName = identifierName(asNode(field(member, 'key')));
      const value = asNode(field(member, 'value'));
      context.definitions.push({
        kind: 'method',
        name: methodName === undefined ? '(anonymous)' : `${name ?? ''}.${methodName}`,
        exported: frame.exported,
        async: value !== undefined && field(value, 'async') === true,
        decorators: decoratorFacts(member, context),
        location: context.index.location(context.file, member.start, member.end),
        initializer: undefined,
        enclosing: name ?? frame.name,
      });
      if (value !== undefined) {
        traverse(
          value,
          context,
          { name: `${name ?? ''}.${methodName ?? ''}`, declaredName: undefined, exported: false },
          false,
          collecting,
        );
      }
      continue;
    }
    traverse(
      member,
      context,
      { name: name ?? frame.name, declaredName: undefined, exported: false },
      false,
      collecting,
    );
  }
};

/**
 * Initializer types whose declared variable names what is inside it.
 *
 * A function held by a variable is named by that variable, and so is a piece of text: `const SYSTEM_PROMPT = '...'`
 * gives the prompt its name. A call or a constructor does not, which is the distinction that matters here.
 */
const NAMING_INITIALIZERS = new Set([
  'ArrowFunctionExpression',
  'FunctionExpression',
  'ClassExpression',
  'Literal',
  'StringLiteral',
  'TemplateLiteral',
  'TaggedTemplateExpression',
]);

/**
 * The names an initialiser takes its value from, following the operators that offer a choice of one.
 *
 * `??`, `||` and a ternary are how a default is written, and the default is the name that matters:
 * `opts.fetchImpl ?? fetch` says the value is a network client whichever branch is taken. A call is not
 * followed, because a value a function returned is not that function.
 */
const aliasedNames = (init: Node): readonly (readonly string[])[] => {
  const direct = calleePath(init);
  if (direct.length > 0) return [direct];
  if (init.type === 'LogicalExpression' || init.type === 'BinaryExpression') {
    const left = asNode(field(init, 'left'));
    const right = asNode(field(init, 'right'));
    return [
      ...(left === undefined ? [] : aliasedNames(left)),
      ...(right === undefined ? [] : aliasedNames(right)),
    ];
  }
  if (init.type === 'ConditionalExpression') {
    const consequent = asNode(field(init, 'consequent'));
    const alternate = asNode(field(init, 'alternate'));
    return [
      ...(consequent === undefined ? [] : aliasedNames(consequent)),
      ...(alternate === undefined ? [] : aliasedNames(alternate)),
    ];
  }
  if (init.type === 'TSNonNullExpression' || init.type === 'TSAsExpression') {
    const inner = asNode(field(init, 'expression'));
    return inner === undefined ? [] : aliasedNames(inner);
  }
  return [];
};

const recordVariables = (
  node: Node,
  context: Context,
  frame: Frame,
  collecting: (readonly string[])[][],
): void => {
  for (const declarator of nodeArray(field(node, 'declarations'))) {
    const name = identifierName(asNode(field(declarator, 'id')));
    const init = asNode(field(declarator, 'init'));
    let initializer: readonly string[] | undefined;
    if (init !== undefined && (init.type === 'CallExpression' || init.type === 'NewExpression')) {
      const callee = asNode(field(init, 'callee'));
      initializer = callee === undefined ? undefined : calleePath(callee);
    }
    const aliasedFrom = init === undefined ? [] : aliasedNames(init);
    if (name !== undefined) {
      context.definitions.push({
        kind: 'variable',
        name,
        exported: frame.exported,
        async: false,
        decorators: [],
        location: context.index.location(context.file, declarator.start, declarator.end),
        initializer,
        ...(aliasedFrom.length === 0 ? {} : { aliasedFrom }),
        enclosing: frame.name,
      });
    }
    if (init !== undefined) {
      // `const opened = new DatabaseSync()` must not rename the scope: doing so attributes every later call in the
      // function to whatever variable happened to be declared last, which is how a database handle became an entry
      // point named `opened`.
      const scopeName =
        name !== undefined && NAMING_INITIALIZERS.has(init.type) ? name : frame.name;
      traverse(
        init,
        context,
        { name: scopeName, declaredName: name ?? frame.declaredName, exported: frame.exported },
        false,
        collecting,
      );
    }
  }
};

const recordText = (
  value: string,
  hasSubstitutions: boolean,
  node: Node,
  context: Context,
  frame: Frame,
): void => {
  if (value.length < TEXT_FACT_MIN_LENGTH) return;
  context.texts.push({
    value,
    approximateTokens: approximateTokens(value),
    hasSubstitutions,
    location: context.index.location(context.file, node.start, node.end),
    enclosing: frame.declaredName ?? frame.name,
  });
};

export const analyzeJavaScript = (input: {
  readonly file: string;
  readonly text: string;
  readonly contentHash: string;
  readonly language: Language;
}): ModuleFacts => {
  const index = buildLineIndex(input.text);
  const context: Context = {
    file: input.file,
    index,
    bindings: new Map(),
    imports: [],
    calls: [],
    definitions: [],
    environmentRefs: [],
    texts: [],
    controlFlow: [],
    exportedNames: new Set(),
  };

  const result = parseSync(input.file, input.text);
  const program = result.program as unknown as Node;
  recordImports(program, context, result.module);
  traverse(
    program,
    context,
    { name: undefined, declaredName: undefined, exported: false },
    false,
    [],
  );

  const parseErrors = result.errors.map((error) => {
    const message = (error as { message?: string }).message;
    return message ?? 'parse error';
  });

  return {
    file: input.file,
    language: input.language,
    contentHash: input.contentHash,
    imports: context.imports,
    exportedNames: [...context.exportedNames],
    calls: context.calls,
    definitions: context.definitions,
    environmentRefs: context.environmentRefs,
    texts: context.texts,
    controlFlow: context.controlFlow,
    parseErrors,
  };
};
