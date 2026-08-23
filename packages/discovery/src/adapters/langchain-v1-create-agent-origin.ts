import type { CallFact, ImportFact, ModuleFacts } from '@orchescope/source-analysis';
import type { AdapterApplicability, DiscoveryContext } from '../adapter.ts';
import { localModules, namesLocalModule } from '../local-modules.ts';
import { hasLocalBinding } from '../matching.ts';

/** The one runtime export this adapter is authorised to interpret. */
export const LANGCHAIN_CREATE_AGENT_ADAPTER_ID = 'adapter:langchain-v1-create-agent';
export const LANGCHAIN_CREATE_AGENT_MODULE = 'langchain.agents';
export const LANGCHAIN_CREATE_AGENT_EXPORT = 'create_agent';
export const LANGCHAIN_CREATE_AGENT_PACKAGES = ['langchain'];

export type ExactCreateAgentImport = {
  readonly entry: ImportFact;
  readonly form: 'direct' | 'namespace';
};

/** Direct aliases and namespace imports that can resolve to `langchain.agents.create_agent`. */
export const exactCreateAgentImports = (
  context: DiscoveryContext,
  module: ModuleFacts,
): readonly ExactCreateAgentImport[] => {
  if (module.language !== 'python') return [];
  const local = localModules(context.modules);
  return module.imports.flatMap((entry): readonly ExactCreateAgentImport[] => {
    if (entry.isType || namesLocalModule(local, module, entry.module)) return [];
    if (
      entry.module === LANGCHAIN_CREATE_AGENT_MODULE &&
      entry.imported === LANGCHAIN_CREATE_AGENT_EXPORT
    ) {
      return [{ entry, form: 'direct' }];
    }
    if (entry.module === LANGCHAIN_CREATE_AGENT_MODULE && entry.imported === '*') {
      return [{ entry, form: 'namespace' }];
    }
    if (entry.module === 'langchain' && entry.imported === 'agents') {
      return [{ entry, form: 'namespace' }];
    }
    return [];
  });
};

export const createAgentApplicability = (context: DiscoveryContext): AdapterApplicability =>
  context.modules.flatMap((module) =>
    exactCreateAgentImports(context, module).map(({ entry, form }) => ({
      module: LANGCHAIN_CREATE_AGENT_MODULE,
      imported: form === 'direct' ? LANGCHAIN_CREATE_AGENT_EXPORT : '*',
      location: entry.location,
    })),
  );

const shadowsImportedRoot = (module: ModuleFacts, call: CallFact): boolean => {
  const root = call.calleePath[0];
  if (root === undefined) return true;
  return (
    hasLocalBinding(module, call.enclosing, root) ||
    module.definitions.some(
      (definition) =>
        (definition.name === root || definition.name.endsWith(`.${root}`)) &&
        (definition.enclosing === undefined || definition.enclosing === call.enclosing),
    ) ||
    module.assignments.some(
      (assignment) =>
        assignment.target.length === 1 &&
        assignment.target[0] === root &&
        (assignment.enclosing === undefined || assignment.enclosing === call.enclosing),
    )
  );
};

export const createAgentCandidateImport = (
  exact: readonly ExactCreateAgentImport[],
  call: CallFact,
): ExactCreateAgentImport | undefined => {
  const root = call.calleePath[0];
  const last = call.calleePath.at(-1);
  if (root === undefined) return undefined;
  const candidates = exact.filter(({ entry, form }) => {
    if (entry.local !== root) return false;
    if (form === 'direct') return call.calleePath.length === 1;
    return call.calleePath.length >= 2 && last === LANGCHAIN_CREATE_AGENT_EXPORT;
  });
  return candidates.length === 1 ? candidates[0] : undefined;
};

/** Resolves a candidate call back to the exact unshadowed runtime import that authorises it. */
export const exactCreateAgentRuntimeCall = (
  module: ModuleFacts,
  exact: readonly ExactCreateAgentImport[],
  call: CallFact,
): ExactCreateAgentImport | undefined => {
  if (call.kind !== 'call' || call.origin?.isType === true || shadowsImportedRoot(module, call)) {
    return undefined;
  }
  const imported = createAgentCandidateImport(exact, call);
  if (imported === undefined) return undefined;
  if (imported.form === 'direct') {
    return call.origin?.module === LANGCHAIN_CREATE_AGENT_MODULE &&
      call.origin.imported === LANGCHAIN_CREATE_AGENT_EXPORT
      ? imported
      : undefined;
  }
  if (imported.entry.module === LANGCHAIN_CREATE_AGENT_MODULE) {
    return call.origin?.module === LANGCHAIN_CREATE_AGENT_MODULE && call.origin.imported === '*'
      ? imported
      : undefined;
  }
  return call.origin?.module === 'langchain' && call.origin.imported === 'agents'
    ? imported
    : undefined;
};
