import type { CallFact, ImportFact, ModuleFacts } from '@orchescope/source-analysis';
import type { AdapterApplicability, DiscoveryContext } from '../adapter.ts';
import { localModules, namesLocalModule } from '../local-modules.ts';
import { hasContainingCallableBinding, matchRuntimeSymbol } from '../matching.ts';

export const LANGCHAIN_OPENAI_MODULE = 'langchain_openai';
export const LANGCHAIN_OPENAI_EXPORT = 'ChatOpenAI';
export const LANGCHAIN_OPENAI_PACKAGES = [LANGCHAIN_OPENAI_MODULE] as const;

export type ExactChatOpenAiImport = {
  readonly entry: ImportFact;
  readonly form: 'direct' | 'namespace' | 'wildcard';
};

/** Direct aliases and namespace imports authorised by the exact Python package export. */
export const exactChatOpenAiImports = (
  context: DiscoveryContext,
  module: ModuleFacts,
): readonly ExactChatOpenAiImport[] => {
  if (module.language !== 'python') return [];
  const local = localModules(context.modules);
  return module.imports.flatMap((entry): readonly ExactChatOpenAiImport[] => {
    if (
      entry.isType ||
      entry.module !== LANGCHAIN_OPENAI_MODULE ||
      namesLocalModule(local, module, entry.module)
    ) {
      return [];
    }
    if (entry.imported === LANGCHAIN_OPENAI_EXPORT) return [{ entry, form: 'direct' }];
    if (entry.imported !== '*') return [];
    return [{ entry, form: entry.local === '*' ? 'wildcard' : 'namespace' }];
  });
};

export const chatOpenAiApplicability = (context: DiscoveryContext): AdapterApplicability =>
  context.modules.flatMap((module) =>
    exactChatOpenAiImports(context, module).map(({ entry, form }) => ({
      module: LANGCHAIN_OPENAI_MODULE,
      imported: form === 'direct' ? LANGCHAIN_OPENAI_EXPORT : '*',
      location: entry.location,
    })),
  );

/** A call whose written root and shape could refer to one exact retained import. */
const chatOpenAiCandidateImports = (
  exact: readonly ExactChatOpenAiImport[],
  call: CallFact,
): readonly ExactChatOpenAiImport[] => {
  const root = call.calleePath[0];
  if (root === undefined) return [];
  return exact.filter(({ entry, form }) => {
    if (entry.local !== root) return false;
    if (form === 'wildcard') return false;
    return form === 'direct'
      ? call.calleePath.length === 1
      : call.calleePath.length === 2 && call.calleePath[1] === LANGCHAIN_OPENAI_EXPORT;
  });
};

/** Whether at least one relevant exact import makes this written call part of the inspected population. */
export const isChatOpenAiCandidateCall = (
  exact: readonly ExactChatOpenAiImport[],
  call: CallFact,
): boolean => chatOpenAiCandidateImports(exact, call).length > 0;

export const chatOpenAiCandidateImport = (
  exact: readonly ExactChatOpenAiImport[],
  call: CallFact,
): ExactChatOpenAiImport | undefined => {
  const matches = chatOpenAiCandidateImports(exact, call);
  return matches.length === 1 ? matches[0] : undefined;
};

const MAX_ALIAS_HOPS = 4;

type AliasReach = 'bounded' | 'exceeded' | undefined;

const pathsEqual = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((segment, index) => segment === right[index]);

const aliasSources = (
  module: ModuleFacts,
  name: string,
): readonly (readonly string[])[] | undefined => {
  const definitions = module.definitions.filter(
    (definition) => definition.kind === 'variable' && definition.name === name,
  );
  if (definitions.length === 0) return undefined;
  return definitions.flatMap((definition) => definition.aliasedFrom ?? []);
};

const aliasReach = (input: {
  readonly module: ModuleFacts;
  readonly name: string;
  readonly depth: number;
  readonly seen: ReadonlySet<string>;
  readonly targets: readonly (readonly string[])[];
}): AliasReach => {
  if (input.seen.has(input.name)) return undefined;
  const sources = aliasSources(input.module, input.name);
  if (sources === undefined) return undefined;
  const nextSeen = new Set([...input.seen, input.name]);
  let exceeded = false;
  for (const path of sources) {
    if (input.targets.some((target) => pathsEqual(path, target))) {
      return input.depth + 1 <= MAX_ALIAS_HOPS ? 'bounded' : 'exceeded';
    }
    const next = path.length === 1 ? path[0] : undefined;
    if (next === undefined) continue;
    if (input.depth + 1 >= MAX_ALIAS_HOPS) {
      exceeded = true;
      continue;
    }
    const status = aliasReach({
      ...input,
      name: next,
      depth: input.depth + 1,
      seen: nextSeen,
    });
    if (status === 'bounded') return status;
    if (status === 'exceeded') exceeded = true;
  }
  return exceeded ? 'exceeded' : undefined;
};

export type IndirectChatOpenAiCall = {
  readonly call: CallFact;
  readonly bounded: boolean;
};

/** Calls reached through assignment aliases are visible but intentionally outside exact runtime settlement. */
export const indirectChatOpenAiCalls = (
  module: ModuleFacts,
  exact: readonly ExactChatOpenAiImport[],
): readonly IndirectChatOpenAiCall[] => {
  return module.calls.flatMap((call): readonly IndirectChatOpenAiCall[] => {
    const bare = call.calleePath.length === 1;
    const namespaceMember =
      call.calleePath.length === 2 && call.calleePath[1] === LANGCHAIN_OPENAI_EXPORT;
    const root = bare || namespaceMember ? call.calleePath[0] : undefined;
    if (root === undefined) return [];
    const targets = exact.flatMap(({ entry, form }): readonly (readonly string[])[] => {
      if (form === 'wildcard') return [];
      if (bare && form === 'direct') return [[entry.local]];
      if (bare && form === 'namespace') return [[entry.local, LANGCHAIN_OPENAI_EXPORT]];
      return namespaceMember && form === 'namespace' ? [[entry.local]] : [];
    });
    const status = aliasReach({ module, name: root, depth: 0, seen: new Set(), targets });
    return status === undefined ? [] : [{ call, bounded: status === 'bounded' }];
  });
};

/** Proves that a candidate still reaches the unshadowed runtime package export. */
export const exactChatOpenAiRuntimeCall = (
  context: DiscoveryContext,
  module: ModuleFacts,
  exact: readonly ExactChatOpenAiImport[],
  call: CallFact,
): ExactChatOpenAiImport | undefined => {
  if (call.kind !== 'call') return undefined;
  const imported = chatOpenAiCandidateImport(exact, call);
  if (imported === undefined) return undefined;
  if (
    call.origin?.module !== imported.entry.module ||
    call.origin.isType ||
    imported.form === 'wildcard' ||
    call.origin.imported !== (imported.form === 'direct' ? LANGCHAIN_OPENAI_EXPORT : '*') ||
    call.calleePath[0] === undefined ||
    hasContainingCallableBinding(module, call.location, call.calleePath[0])
  ) {
    return undefined;
  }
  if (
    module.assignments.some(
      (assignment) =>
        assignment.target.length === call.calleePath.length &&
        assignment.target.every((segment, index) => segment === call.calleePath[index]) &&
        (assignment.enclosing === undefined || assignment.enclosing === call.enclosing) &&
        (assignment.location.startLine < call.location.startLine ||
          (assignment.location.startLine === call.location.startLine &&
            (assignment.location.endColumn ?? Number.MAX_SAFE_INTEGER) <=
              (call.location.startColumn ?? 0))),
    )
  ) {
    return undefined;
  }
  return matchRuntimeSymbol(
    context.modules,
    module,
    {
      path: call.calleePath,
      origin: call.origin,
      enclosing: call.enclosing,
      location: call.location,
    },
    { names: [LANGCHAIN_OPENAI_EXPORT], packages: LANGCHAIN_OPENAI_PACKAGES },
  ) === undefined
    ? undefined
    : imported;
};
