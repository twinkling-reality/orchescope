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
import type { Language } from '../file-set.ts';
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

const templateValue = (node: Node): { value: string; hasSubstitutions: boolean } => {
  const quasis = nodeArray(field(node, 'quasis'));
  const expressions = nodeArray(field(node, 'expressions'));
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
  // biome-ignore lint/suspicious/noTemplateCurlyInString: this is the marker recorded in place of a substitution
  return { value: parts.join('${...}'), hasSubstitutions: expressions.length > 0 };
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
        args: nodeArray(field(node, 'arguments')).map((argument) => argumentFact(argument, context)),
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
    default:
      return { kind: 'unknown', nodeType: node.type };
  }
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
    context.controlFlow.push({
      kind,
      location: context.index.location(context.file, node.start, node.end),
      enclosing: frame.name,
      contains,
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
    if (name !== undefined) {
      context.definitions.push({
        kind: 'variable',
        name,
        exported: frame.exported,
        async: false,
        decorators: [],
        location: context.index.location(context.file, declarator.start, declarator.end),
        initializer,
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
