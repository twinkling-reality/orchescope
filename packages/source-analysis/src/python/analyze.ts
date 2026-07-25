import type { SourceLocation } from '@orchescope/schema';
import type { Node } from 'web-tree-sitter';
import {
  type ArgumentFact,
  type CallFact,
  type CalleeOrigin,
  type ControlFlowFact,
  type DecoratorFact,
  type DefinitionFact,
  type EnvironmentFact,
  type ImportFact,
  type ModuleFacts,
  type ObjectEntryFact,
  TEXT_FACT_MIN_LENGTH,
  type TextFact,
  approximateTokens,
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

const namedChildren = (node: Node): readonly Node[] => {
  const children: Node[] = [];
  for (let index = 0; index < node.namedChildCount; index += 1) {
    const child = node.namedChild(index);
    if (child !== null) children.push(child);
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
    else if (child.type === 'interpolation') parts.push('${...}');
  }
  if (parts.length > 0) return parts.join('');
  const raw = node.text;
  const match = /^[a-zA-Z]*('''|"""|'|")([\s\S]*)\1$/.exec(raw);
  return match?.[2] ?? undefined;
};

const hasInterpolation = (node: Node): boolean =>
  namedChildren(node).some((child) => child.type === 'interpolation');

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
        ? { kind: 'template', value, hasSubstitutions: true }
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
      return path.length === 0 ? { kind: 'unknown', nodeType: node.type } : { kind: 'member', path };
    }
    case 'call': {
      const callee = childField(node, 'function');
      return { kind: 'call', path: callee === undefined ? [] : attributePath(callee) };
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
      return inner === undefined ? { kind: 'unknown', nodeType: node.type } : argumentFact(inner, context);
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

const environmentName = (path: readonly string[], args: readonly ArgumentFact[]): string | undefined => {
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
        args: keywords.length === 0 ? positional : [...positional, { kind: 'object', entries: keywords }],
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

const splitArguments = (
  call: Node,
  context: Context,
): { positional: ArgumentFact[]; keywords: ObjectEntryFact[] } => {
  const positional: ArgumentFact[] = [];
  const keywords: ObjectEntryFact[] = [];
  const list = childField(call, 'arguments');
  if (list === undefined) return { positional, keywords };
  for (const child of namedChildren(list)) {
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
    context.controlFlow.push({
      kind: controlKind,
      location: location(context.file, node),
      enclosing: frame.name,
      contains,
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
  const args = keywords.length === 0 ? positional : [...positional, { kind: 'object' as const, entries: keywords }];

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

const recordAssignment = (
  node: Node,
  context: Context,
  frame: Frame,
  collecting: (readonly string[])[][],
): void => {
  const left = childField(node, 'left');
  const right = childField(node, 'right');
  const name = left === undefined ? undefined : attributePath(left).join('.');
  if (name !== undefined && name.length > 0) {
    const initializer =
      right !== undefined && right.type === 'call'
        ? attributePath(childField(right, 'function') ?? right)
        : undefined;
    context.definitions.push({
      kind: 'variable',
      name,
      exported: !name.startsWith('_'),
      async: false,
      decorators: [],
      location: location(context.file, node),
      initializer: initializer !== undefined && initializer.length > 0 ? initializer : undefined,
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
      controlFlow: context.controlFlow,
      parseErrors: root.hasError ? ['the file contains at least one syntax error'] : [],
    };
  } finally {
    // The tree lives in WebAssembly memory and is not reclaimed by the JavaScript collector.
    tree.delete();
  }
};
