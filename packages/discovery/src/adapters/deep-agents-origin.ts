import type { SourceLocation } from '@orchescope/schema';
import type {
  CallFact,
  DefinitionFact,
  ImportFact,
  ModuleFacts,
} from '@orchescope/source-analysis';
import { calleeName, findEntry, stringValue } from '@orchescope/source-analysis';
import type { AdapterApplicability, DiscoveryContext } from '../adapter.ts';
import { localModules, namesLocalModule } from '../local-modules.ts';
import { matchRuntimeSymbol } from '../matching.ts';

/** Exact imports, runtime calls and identities for the Deep Agents factory contract. */

export const DEEP_AGENTS_MODULE = 'deepagents';
export const DEEP_AGENTS_FACTORY = 'create_deep_agent';
export const DEEP_AGENTS_PACKAGES = ['deepagents'];

export type ExactDeepAgentImport = {
  readonly entry: ImportFact;
  readonly form: 'direct' | 'namespace';
};

export type DeepAgentIdentity = {
  readonly name: string;
  readonly declaredName?: string;
  readonly basis: SourceLocation;
  readonly implementation: SourceLocation;
  readonly bindings: readonly string[];
};

export const exactDeepAgentImports = (
  context: DiscoveryContext,
  module: ModuleFacts,
): readonly ExactDeepAgentImport[] => {
  if (module.language !== 'python') return [];
  const local = localModules(context.modules);
  return module.imports.flatMap((entry): readonly ExactDeepAgentImport[] => {
    if (
      entry.isType ||
      namesLocalModule(local, module, entry.module) ||
      entry.module !== DEEP_AGENTS_MODULE
    ) {
      return [];
    }
    if (entry.imported === DEEP_AGENTS_FACTORY) return [{ entry, form: 'direct' }];
    if (entry.imported === '*') return [{ entry, form: 'namespace' }];
    return [];
  });
};

export const deepAgentApplicability = (context: DiscoveryContext): AdapterApplicability =>
  context.modules.flatMap((module) =>
    exactDeepAgentImports(context, module).map(({ entry, form }) => ({
      module: DEEP_AGENTS_MODULE,
      imported: form === 'direct' ? DEEP_AGENTS_FACTORY : '*',
      location: entry.location,
    })),
  );

export const deepAgentCandidateImport = (
  exact: readonly ExactDeepAgentImport[],
  call: CallFact,
): ExactDeepAgentImport | undefined => {
  const root = call.calleePath[0];
  if (root === undefined) return undefined;
  const candidates = exact.filter(({ entry, form }) =>
    form === 'direct'
      ? entry.local === root && call.calleePath.length === 1
      : entry.local === root &&
        call.calleePath.length === 2 &&
        calleeName(call) === DEEP_AGENTS_FACTORY,
  );
  return candidates.length === 1 ? candidates[0] : undefined;
};

export const exactDeepAgentRuntimeCall = (
  context: DiscoveryContext,
  module: ModuleFacts,
  exact: readonly ExactDeepAgentImport[],
  call: CallFact,
): ExactDeepAgentImport | undefined => {
  const imported = deepAgentCandidateImport(exact, call);
  if (imported === undefined) return undefined;
  const matched = matchRuntimeSymbol(
    context.modules,
    module,
    {
      path: call.calleePath,
      origin: call.origin,
      enclosing: call.enclosing,
      location: call.location,
    },
    { names: [DEEP_AGENTS_FACTORY], packages: DEEP_AGENTS_PACKAGES },
  );
  return matched?.resolved === true ? imported : undefined;
};

const keywordEntries = (call: CallFact) => {
  for (let index = call.args.length - 1; index >= 0; index -= 1) {
    const argument = call.args[index];
    if (argument?.kind === 'object' && argument.role === 'keywords') return argument.entries;
  }
  return [];
};

const containsLine = (definition: DefinitionFact, call: CallFact): boolean =>
  definition.location.startLine <= call.location.startLine &&
  (definition.location.endLine ?? definition.location.startLine) >= call.location.startLine;

const stableAssignedVariable = (
  module: ModuleFacts,
  call: CallFact,
): DefinitionFact | undefined => {
  const containing = module.definitions.filter(
    (definition) => definition.kind === 'variable' && containsLine(definition, call),
  );
  if (containing.length !== 1) return undefined;
  const candidate = containing[0];
  if (candidate === undefined) return undefined;
  const definitions = module.definitions.filter(
    (definition) =>
      definition.kind === 'variable' &&
      definition.name === candidate.name &&
      definition.enclosing === candidate.enclosing,
  );
  const assigned = module.assignments.some(
    (assignment) =>
      assignment.target.length === 1 &&
      assignment.target[0] === candidate.name &&
      assignment.enclosing === candidate.enclosing,
  );
  return definitions.length === 1 && !assigned ? candidate : undefined;
};

const callableOwner = (module: ModuleFacts, call: CallFact): DefinitionFact | undefined => {
  if (call.enclosing === undefined) return undefined;
  const candidates = module.definitions.filter(
    (definition) =>
      (definition.kind === 'function' || definition.kind === 'method') &&
      (definition.name === call.enclosing || definition.name.endsWith(`.${call.enclosing}`)) &&
      containsLine(definition, call),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
};

export const deepAgentIdentity = (
  module: ModuleFacts,
  call: CallFact,
  acceptedCalls: readonly CallFact[],
): DeepAgentIdentity | undefined => {
  const entries = keywordEntries(call);
  const declaredEntry = findEntry(entries, 'name');
  const declaredName = stringValue(declaredEntry?.value);
  const variable = stableAssignedVariable(module, call);
  const owner = callableOwner(module, call);
  const implementation = owner?.location ?? variable?.location ?? call.location;
  const ownerCalls =
    owner === undefined ? [] : acceptedCalls.filter((candidate) => containsLine(owner, candidate));
  const ownerBindings =
    owner === undefined || ownerCalls.length !== 1
      ? []
      : [owner.name, owner.name.split('.').at(-1) ?? owner.name];

  if (declaredName !== undefined && declaredName.trim().length > 0 && declaredEntry !== undefined) {
    return {
      name: declaredName,
      declaredName,
      basis: declaredEntry.location,
      implementation,
      bindings: [
        declaredName,
        ...(variable === undefined ? [] : [variable.name]),
        ...ownerBindings,
      ],
    };
  }
  if (variable !== undefined) {
    const name =
      variable.enclosing === undefined ? variable.name : `${variable.enclosing}.${variable.name}`;
    return {
      name,
      basis: variable.location,
      implementation,
      bindings: [variable.name, ...ownerBindings],
    };
  }
  if (owner !== undefined && ownerCalls.length === 1) {
    const name = owner.name.split('.').at(-1) ?? owner.name;
    return { name, basis: owner.location, implementation: owner.location, bindings: ownerBindings };
  }
  return undefined;
};
