import type { SourceLocation } from '@orchescope/schema';
import type { DefinitionFact, LexicalScopeFact, ModuleFacts } from '@orchescope/source-analysis';

import type { DiscoveryContext } from './adapter.ts';
import { hasBindingAt } from './matching.ts';

const startsBefore = (left: SourceLocation, right: SourceLocation): boolean =>
  left.startLine < right.startLine ||
  (left.startLine === right.startLine &&
    (left.startColumn ?? 0) <= (right.startColumn ?? Number.MAX_SAFE_INTEGER));

const endsAfter = (left: SourceLocation, right: SourceLocation): boolean =>
  (left.endLine ?? left.startLine) > (right.endLine ?? right.startLine) ||
  ((left.endLine ?? left.startLine) === (right.endLine ?? right.startLine) &&
    (left.endColumn ?? Number.MAX_SAFE_INTEGER) >= (right.endColumn ?? 0));

const contains = (container: SourceLocation, nested: SourceLocation): boolean =>
  startsBefore(container, nested) && endsAfter(container, nested);

const lexicalScopeAt = (
  module: ModuleFacts,
  location: SourceLocation,
): DefinitionFact | undefined => {
  const candidates = module.definitions
    .filter(
      (definition) =>
        (definition.kind === 'function' || definition.kind === 'method') &&
        contains(definition.location, location),
    )
    .sort((left, right) => {
      const lineSpan =
        (left.location.endLine ?? left.location.startLine) -
        left.location.startLine -
        ((right.location.endLine ?? right.location.startLine) - right.location.startLine);
      if (lineSpan !== 0) return lineSpan;
      return (
        (left.location.endColumn ?? Number.MAX_SAFE_INTEGER) -
        (left.location.startColumn ?? 0) -
        ((right.location.endColumn ?? Number.MAX_SAFE_INTEGER) - (right.location.startColumn ?? 0))
      );
    });
  const first = candidates[0];
  const second = candidates[1];
  if (first === undefined) return undefined;
  return second !== undefined &&
    first.location.startLine === second.location.startLine &&
    first.location.startColumn === second.location.startColumn &&
    first.location.endLine === second.location.endLine &&
    first.location.endColumn === second.location.endColumn
    ? undefined
    : first;
};

const sameRange = (left: SourceLocation, right: SourceLocation): boolean =>
  left.startLine === right.startLine &&
  left.startColumn === right.startColumn &&
  left.endLine === right.endLine &&
  left.endColumn === right.endColumn;

const exactLexicalDefinition = (
  module: ModuleFacts,
  name: string,
  scopes: readonly LexicalScopeFact[],
  before: SourceLocation,
): { readonly definition?: DefinitionFact; readonly blocked: boolean } => {
  for (const scope of [...scopes].reverse()) {
    const candidates = module.definitions.filter(
      (definition) =>
        definition.kind === 'variable' &&
        definition.name === name &&
        definition.enclosingLocation !== undefined &&
        sameRange(definition.enclosingLocation, scope.location) &&
        beforeUse(definition, before),
    );
    if (candidates.length > 1) return { blocked: true };
    const candidate = candidates[0];
    if (candidate !== undefined) {
      const changed = module.assignments.some(
        (assignment) =>
          assignment.target.length === 1 &&
          assignment.target[0] === name &&
          assignment.enclosingLocation !== undefined &&
          sameRange(assignment.enclosingLocation, scope.location),
      );
      return changed ? { blocked: true } : { definition: candidate, blocked: false };
    }
    if (scope.bindings.includes(name)) return { blocked: true };
  }
  return { blocked: false };
};

export const lexicalPromptOwner = (
  module: ModuleFacts,
  location: SourceLocation,
): string | undefined => {
  const scopes = module.definitions
    .filter(
      (definition) =>
        (definition.kind === 'function' ||
          definition.kind === 'method' ||
          definition.kind === 'class') &&
        contains(definition.location, location),
    )
    .sort((left, right) => {
      if (left.location.startLine !== right.location.startLine) {
        return left.location.startLine - right.location.startLine;
      }
      if ((left.location.startColumn ?? 0) !== (right.location.startColumn ?? 0)) {
        return (left.location.startColumn ?? 0) - (right.location.startColumn ?? 0);
      }
      if (
        (left.location.endLine ?? left.location.startLine) !==
        (right.location.endLine ?? right.location.startLine)
      ) {
        return (
          (right.location.endLine ?? right.location.startLine) -
          (left.location.endLine ?? left.location.startLine)
        );
      }
      return (
        (right.location.endColumn ?? Number.MAX_SAFE_INTEGER) -
        (left.location.endColumn ?? Number.MAX_SAFE_INTEGER)
      );
    });
  if (scopes.length === 0) return undefined;
  if (
    scopes.some((scope, index) => {
      const next = scopes[index + 1];
      return next !== undefined && sameRange(scope.location, next.location);
    })
  ) {
    return undefined;
  }
  return scopes
    .map((scope) => scope.name.split('.').at(-1))
    .filter((name): name is string => name !== undefined && name.length > 0)
    .join('.');
};

const withinScope = (scope: DefinitionFact | undefined, location: SourceLocation): boolean =>
  scope === undefined || contains(scope.location, location);

const hasScopedLocalBinding = (
  module: ModuleFacts,
  scope: DefinitionFact | undefined,
  enclosing: string | undefined,
  name: string,
  use: SourceLocation,
): boolean => {
  if (scope === undefined) return hasBindingAt(module, enclosing, name, use);
  return (
    scope.parameters?.some((parameter) => parameter.name === name) === true ||
    module.definitions.some(
      (definition) =>
        definition.kind === 'variable' &&
        definition.name === name &&
        definition.enclosing === enclosing &&
        withinScope(scope, definition.location),
    ) ||
    module.assignments.some(
      (assignment) =>
        assignment.target.length === 1 &&
        assignment.target[0] === name &&
        assignment.enclosing === enclosing &&
        withinScope(scope, assignment.location),
    )
  );
};

const beforeUse = (definition: DefinitionFact, location: SourceLocation): boolean =>
  (definition.location.endLine ?? definition.location.startLine) < location.startLine ||
  ((definition.location.endLine ?? definition.location.startLine) === location.startLine &&
    definition.location.endColumn !== undefined &&
    location.startColumn !== undefined &&
    definition.location.endColumn <= location.startColumn);

const stableDefinition = (
  module: ModuleFacts,
  name: string,
  enclosing: string | undefined,
  before: SourceLocation,
): DefinitionFact | undefined => {
  const scope = enclosing === undefined ? undefined : lexicalScopeAt(module, before);
  const candidates = module.definitions.filter(
    (definition) =>
      definition.kind === 'variable' &&
      definition.name === name &&
      definition.enclosing === enclosing &&
      (enclosing !== undefined || definition.enclosingLocation === undefined) &&
      withinScope(scope, definition.location) &&
      beforeUse(definition, before),
  );
  if (candidates.length !== 1) return undefined;
  const changed = module.assignments.some(
    (assignment) =>
      assignment.target.length === 1 &&
      assignment.target[0] === name &&
      assignment.enclosing === enclosing &&
      (enclosing !== undefined || assignment.enclosingLocation === undefined) &&
      withinScope(scope, assignment.location),
  );
  return changed ? undefined : candidates[0];
};

export const resolvePromptDefinition = (
  context: DiscoveryContext,
  module: ModuleFacts,
  name: string,
  enclosing: string | undefined,
  before: SourceLocation,
  lexicalScopes: readonly LexicalScopeFact[] = [],
  lexicalShadows: readonly string[] = [],
): { readonly module: ModuleFacts; readonly definition: DefinitionFact } | undefined => {
  const lexical = exactLexicalDefinition(module, name, lexicalScopes, before);
  if (lexical.definition !== undefined) return { module, definition: lexical.definition };
  if (lexical.blocked) return undefined;
  if (lexicalShadows.includes(name)) return undefined;
  const scoped = stableDefinition(module, name, enclosing, before);
  if (scoped !== undefined) return { module, definition: scoped };
  const scope = lexicalScopeAt(module, before);
  if (enclosing !== undefined && hasScopedLocalBinding(module, scope, enclosing, name, before)) {
    return undefined;
  }
  const global = stableDefinition(module, name, undefined, before);
  if (global !== undefined) return { module, definition: global };
  const imports = module.imports.filter((entry) => entry.local === name && !entry.isType);
  if (imports.length !== 1) return undefined;
  const resolved = context.symbols.resolve(module.file, name);
  if (resolved?.definition?.kind !== 'variable') return undefined;
  const target = context.symbols.moduleOf(resolved.file);
  if (target === undefined) return undefined;
  const exact = target.definitions.filter(
    (definition) =>
      definition.kind === 'variable' &&
      definition.name === resolved.definition?.name &&
      definition.enclosing === resolved.definition?.enclosing &&
      definition.enclosingLocation === undefined,
  );
  const changed = target.assignments.some(
    (assignment) =>
      assignment.target.length === 1 &&
      assignment.target[0] === resolved.definition?.name &&
      assignment.enclosing === resolved.definition?.enclosing,
  );
  return exact.length !== 1 || changed || exact[0] === undefined
    ? undefined
    : { module: target, definition: exact[0] };
};
