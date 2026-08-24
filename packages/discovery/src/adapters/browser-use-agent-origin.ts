import type { ImportFact, ModuleFacts } from '@orchescope/source-analysis';
import type { AdapterApplicability, DiscoveryContext } from '../adapter.ts';
import { localModules, namesLocalModule } from '../local-modules.ts';

export const BROWSER_USE_AGENT_ADAPTER_ID = 'adapter:browser-use-agent';
export const BROWSER_USE_MODULE = 'browser_use';
export const BROWSER_USE_AGENT_EXPORT = 'Agent';
export const BROWSER_USE_PACKAGES = ['browser-use', 'browser_use'];

const isAgentImport = (entry: ImportFact): boolean =>
  entry.module === BROWSER_USE_MODULE &&
  (entry.imported === BROWSER_USE_AGENT_EXPORT || entry.imported === '*');

/** Exact runtime imports that can authorize a browser-use Agent construction. */
export const browserUseAgentImports = (
  context: DiscoveryContext,
  module: ModuleFacts,
): readonly ImportFact[] => {
  if (module.language !== 'python') return [];
  const local = localModules(context.modules);
  return module.imports.filter(
    (entry) =>
      !entry.isType && isAgentImport(entry) && !namesLocalModule(local, module, entry.module),
  );
};

export const browserUseAgentApplicability = (context: DiscoveryContext): AdapterApplicability =>
  context.modules.flatMap((module) =>
    browserUseAgentImports(context, module).map((entry) => ({
      module: BROWSER_USE_MODULE,
      imported: entry.imported === '*' ? '*' : BROWSER_USE_AGENT_EXPORT,
      location: entry.location,
    })),
  );
