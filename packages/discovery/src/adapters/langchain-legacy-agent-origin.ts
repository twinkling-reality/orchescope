import type { CallFact, ImportFact, ModuleFacts } from '@orchescope/source-analysis';
import type { AdapterApplicability, DiscoveryContext } from '../adapter.ts';
import { localModules, namesLocalModule } from '../local-modules.ts';
import { matchRuntimeSymbol } from '../matching.ts';

export const LANGCHAIN_LEGACY_AGENT_ADAPTER_ID = 'adapter:langchain-legacy-agent';
export const LANGCHAIN_LEGACY_AGENT_MODULE = 'langchain.agents';
export const LANGCHAIN_LEGACY_AGENT_PACKAGES = ['langchain'] as const;
export const LANGCHAIN_LEGACY_FACTORY_EXPORT = 'create_openai_tools_agent';
export const LANGCHAIN_LEGACY_EXECUTOR_EXPORT = 'AgentExecutor';

const LEGACY_EXPORTS = [LANGCHAIN_LEGACY_FACTORY_EXPORT, LANGCHAIN_LEGACY_EXECUTOR_EXPORT] as const;

/** Exact imports that make the legacy LangChain agent reader applicable. */
export const legacyAgentImports = (
  context: DiscoveryContext,
  module: ModuleFacts,
): readonly ImportFact[] => {
  if (module.language !== 'python') return [];
  const local = localModules(context.modules);
  return module.imports.filter(
    (entry) =>
      !entry.isType &&
      entry.module === LANGCHAIN_LEGACY_AGENT_MODULE &&
      !namesLocalModule(local, module, entry.module) &&
      (LEGACY_EXPORTS.includes(entry.imported as (typeof LEGACY_EXPORTS)[number]) ||
        entry.imported === '*'),
  );
};

export const legacyAgentApplicability = (context: DiscoveryContext): AdapterApplicability =>
  context.modules.flatMap((module) =>
    legacyAgentImports(context, module).map((entry) => ({
      module: LANGCHAIN_LEGACY_AGENT_MODULE,
      imported: entry.imported,
      location: entry.location,
    })),
  );

/** Proves that a call still resolves to one exact legacy `langchain.agents` runtime export. */
export const exactLegacyAgentCall = (
  context: DiscoveryContext,
  module: ModuleFacts,
  call: CallFact,
  name: typeof LANGCHAIN_LEGACY_FACTORY_EXPORT | typeof LANGCHAIN_LEGACY_EXECUTOR_EXPORT,
): boolean =>
  matchRuntimeSymbol(
    context.modules,
    module,
    {
      path: call.calleePath,
      origin: call.origin,
      enclosing: call.enclosing,
      location: call.location,
    },
    { names: [name], packages: [LANGCHAIN_LEGACY_AGENT_MODULE] },
  ) !== undefined;

/** A spelling tied to a retained import, even when a shadow prevents exact runtime settlement. */
export const legacyAgentCandidateCall = (
  imports: readonly ImportFact[],
  call: CallFact,
  name: typeof LANGCHAIN_LEGACY_FACTORY_EXPORT | typeof LANGCHAIN_LEGACY_EXECUTOR_EXPORT,
): boolean => {
  const root = call.calleePath[0];
  if (root === undefined) return false;
  return imports.some((entry) => {
    if (entry.imported === name) return entry.local === root && call.calleePath.length === 1;
    return (
      entry.imported === '*' &&
      entry.local === root &&
      call.calleePath.length === 2 &&
      call.calleePath[1] === name
    );
  });
};
