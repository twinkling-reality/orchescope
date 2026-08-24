import type { ImportFact, ModuleFacts } from '@orchescope/source-analysis';
import type { AdapterApplicability, DiscoveryContext } from '../adapter.ts';
import { localModules, namesLocalModule } from '../local-modules.ts';

export const AGENTFLOW_ADAPTER_ID = 'adapter:agentflow';
export const AGENTFLOW_PACKAGES = ['agentflow'];
export const AGENTFLOW_CORE_PACKAGES = ['agentflow.core'];
export const AGENTFLOW_RUNTIME_EXPORTS = ['Agent', 'StateGraph', 'ToolNode'];

const isRuntimeImport = (entry: ImportFact): boolean =>
  entry.module === 'agentflow.core' &&
  (AGENTFLOW_RUNTIME_EXPORTS.includes(entry.imported) || entry.imported === '*');

/** Exact external runtime imports that can authorize AgentFlow graph discovery. */
export const agentflowImports = (
  context: DiscoveryContext,
  module: ModuleFacts,
): readonly ImportFact[] => {
  if (module.language !== 'python') return [];
  const local = localModules(context.modules);
  return module.imports.filter(
    (entry) =>
      !entry.isType && isRuntimeImport(entry) && !namesLocalModule(local, module, entry.module),
  );
};

export const agentflowApplicability = (context: DiscoveryContext): AdapterApplicability =>
  context.modules.flatMap((module) =>
    agentflowImports(context, module).map((entry) => ({
      module: 'agentflow.core',
      imported: entry.imported,
      location: entry.location,
    })),
  );
