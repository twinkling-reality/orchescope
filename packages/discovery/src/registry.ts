import type { AgentSystemAdapter } from './adapter.ts';
import { browserUseAgentAdapter } from './adapters/browser-use-agent.ts';
import { crewAiAdapter } from './adapters/crewai.ts';
import { effectsAdapter } from './adapters/effects.ts';
import { implementationReachAdapter } from './adapters/implementation-reach.ts';
import { langChainLegacyAgentAdapter } from './adapters/langchain-legacy-agent.ts';
import { langChainV1CreateAgentAdapter } from './adapters/langchain-v1-create-agent.ts';
import { langGraphAdapter } from './adapters/langgraph.ts';
import { manifestAdapter } from './adapters/manifest.ts';
import { mcpAdapter } from './adapters/mcp.ts';
import { modelSdkAdapter } from './adapters/model-sdk.ts';
import { openAiAgentsAdapter } from './adapters/openai-agents.ts';
import { promptsAdapter } from './adapters/prompts.ts';
import { pydanticAiAdapter } from './adapters/pydantic-ai.ts';
import { searchIndexAdapter } from './adapters/search-index.ts';
import { vercelAiSdkAdapter } from './adapters/vercel-ai-sdk.ts';
import { workersBindingsAdapter } from './adapters/workers-bindings.ts';

/**
 * Adapter order.
 *
 * Adapters that declare components run before adapters that reference them, because a relation can only
 * be drawn once both endpoints exist in the binding registry. Configuration adapters run first because
 * configuration is the most reliable evidence available, then framework adapters, then the cross cutting
 * adapters that attach effects and prompts to whatever was found.
 *
 * `implementation-reach` is last for the same reason, one level up: it joins a declared component to
 * the operations its body reaches, and the operation at the far end of that join is usually a component
 * `effects` mints while attributing a write to the function performing it.
 */
export const DEFAULT_ADAPTERS: readonly AgentSystemAdapter[] = [
  mcpAdapter,
  manifestAdapter,
  workersBindingsAdapter,
  openAiAgentsAdapter,
  langChainV1CreateAgentAdapter,
  langGraphAdapter,
  crewAiAdapter,
  pydanticAiAdapter,
  vercelAiSdkAdapter,
  modelSdkAdapter,
  browserUseAgentAdapter,
  langChainLegacyAgentAdapter,
  searchIndexAdapter,
  effectsAdapter,
  promptsAdapter,
  implementationReachAdapter,
];

export const adapterById = (id: string): AgentSystemAdapter | undefined =>
  DEFAULT_ADAPTERS.find((adapter) => adapter.id === id);
