import type { AgentSystemAdapter } from './adapter.ts';
import { crewAiAdapter } from './adapters/crewai.ts';
import { effectsAdapter } from './adapters/effects.ts';
import { langGraphAdapter } from './adapters/langgraph.ts';
import { manifestAdapter } from './adapters/manifest.ts';
import { mcpAdapter } from './adapters/mcp.ts';
import { modelSdkAdapter } from './adapters/model-sdk.ts';
import { openAiAgentsAdapter } from './adapters/openai-agents.ts';
import { promptsAdapter } from './adapters/prompts.ts';
import { vercelAiSdkAdapter } from './adapters/vercel-ai-sdk.ts';

/**
 * Adapter order.
 *
 * Adapters that declare components run before adapters that reference them, because a relation can only
 * be drawn once both endpoints exist in the binding registry. Configuration adapters run first because
 * configuration is the most reliable evidence available, then framework adapters, then the cross cutting
 * adapters that attach effects and prompts to whatever was found.
 */
export const DEFAULT_ADAPTERS: readonly AgentSystemAdapter[] = [
  mcpAdapter,
  manifestAdapter,
  openAiAgentsAdapter,
  langGraphAdapter,
  crewAiAdapter,
  vercelAiSdkAdapter,
  modelSdkAdapter,
  effectsAdapter,
  promptsAdapter,
];

export const adapterById = (id: string): AgentSystemAdapter | undefined =>
  DEFAULT_ADAPTERS.find((adapter) => adapter.id === id);
