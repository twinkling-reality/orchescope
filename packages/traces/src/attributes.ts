import type { AgentOperation, ComponentKind, MetadataValue } from '@orchescope/schema';

/**
 * Attribute vocabulary.
 *
 * Orchescope reads the OpenTelemetry generative AI conventions as its primary dialect and OpenInference
 * as a second one. Every attribute in the generative AI registry is at development stability, so the
 * mapping is versioned here in one place, deprecated names are accepted for reading and never emitted,
 * and an attribute that is absent produces an absent value rather than a default.
 */

export const GEN_AI = {
  operationName: 'gen_ai.operation.name',
  providerName: 'gen_ai.provider.name',
  legacySystem: 'gen_ai.system',
  requestModel: 'gen_ai.request.model',
  responseModel: 'gen_ai.response.model',
  inputTokens: 'gen_ai.usage.input_tokens',
  outputTokens: 'gen_ai.usage.output_tokens',
  legacyPromptTokens: 'gen_ai.usage.prompt_tokens',
  legacyCompletionTokens: 'gen_ai.usage.completion_tokens',
  cacheReadTokens: 'gen_ai.usage.cache_read.input_tokens',
  agentName: 'gen_ai.agent.name',
  agentId: 'gen_ai.agent.id',
  toolName: 'gen_ai.tool.name',
  toolType: 'gen_ai.tool.type',
  toolCallId: 'gen_ai.tool.call.id',
  conversationId: 'gen_ai.conversation.id',
  dataSourceId: 'gen_ai.data_source.id',
  timeToFirstChunk: 'gen_ai.response.time_to_first_chunk',
  workflowName: 'gen_ai.workflow.name',
} as const;

export const OPEN_INFERENCE = {
  spanKind: 'openinference.span.kind',
  modelName: 'llm.model_name',
  provider: 'llm.provider',
  promptTokens: 'llm.token_count.prompt',
  completionTokens: 'llm.token_count.completion',
  toolName: 'tool.name',
  graphNodeId: 'graph.node.id',
  graphNodeParentId: 'graph.node.parent_id',
} as const;

export const CODE = {
  filePath: 'code.file.path',
  functionName: 'code.function.name',
  lineNumber: 'code.line.number',
  legacyFilePath: 'code.filepath',
  legacyFunction: 'code.function',
  legacyLineNumber: 'code.lineno',
} as const;

export const VCS = {
  revision: 'vcs.repository.ref.revision',
  headRevision: 'vcs.ref.head.revision',
  repositoryName: 'vcs.repository.name',
  refName: 'vcs.ref.head.name',
} as const;

export const MCP = {
  methodName: 'mcp.method.name',
  serverName: 'mcp.server.name',
  toolName: 'mcp.tool.name',
} as const;

/**
 * Orchescope's own attributes. Namespaced outside `gen_ai.*` on purpose, so a future upstream convention
 * cannot collide with them.
 */
export const ORCHESCOPE = {
  component: 'orchescope.component',
  retryAttempt: 'orchescope.retry.attempt',
  taskSuccess: 'orchescope.task.success',
  taskOutput: 'orchescope.task.output',
  userIntervention: 'orchescope.user_intervention',
  policyViolation: 'orchescope.policy_violation',
  approvalGranted: 'orchescope.approval.granted',
  faultInjected: 'orchescope.fault.injected',
  sideEffectEvent: 'orchescope.side_effect',
  sideEffectKind: 'orchescope.side_effect.kind',
  sideEffectTarget: 'orchescope.side_effect.target',
  sideEffectKey: 'orchescope.side_effect.idempotency_key',
  sideEffectOutcome: 'orchescope.side_effect.outcome',
  queueWaitMs: 'orchescope.queue.wait_ms',
} as const;

export type Attributes = Readonly<Record<string, MetadataValue>>;

export const readString = (
  attributes: Attributes,
  ...keys: readonly string[]
): string | undefined => {
  for (const key of keys) {
    const value = attributes[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
};

export const readNumber = (
  attributes: Attributes,
  ...keys: readonly string[]
): number | undefined => {
  for (const key of keys) {
    const value = attributes[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  }
  return undefined;
};

export const readBoolean = (
  attributes: Attributes,
  ...keys: readonly string[]
): boolean | undefined => {
  for (const key of keys) {
    const value = attributes[key];
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return undefined;
};

const OPERATION_BY_GEN_AI: Readonly<Record<string, AgentOperation>> = {
  chat: 'chat',
  generate_content: 'chat',
  text_completion: 'text_completion',
  embeddings: 'embeddings',
  execute_tool: 'execute_tool',
  invoke_agent: 'invoke_agent',
  create_agent: 'create_agent',
  invoke_workflow: 'invoke_workflow',
  plan: 'plan',
  retrieval: 'retrieval',
  search_memory: 'memory_read',
  create_memory: 'memory_write',
  update_memory: 'memory_write',
  upsert_memory: 'memory_write',
  delete_memory: 'memory_write',
  create_memory_store: 'memory_write',
  delete_memory_store: 'memory_write',
};

const OPERATION_BY_OPEN_INFERENCE: Readonly<Record<string, AgentOperation>> = {
  LLM: 'chat',
  EMBEDDING: 'embeddings',
  TOOL: 'execute_tool',
  AGENT: 'invoke_agent',
  CHAIN: 'invoke_workflow',
  RETRIEVER: 'retrieval',
  RERANKER: 'retrieval',
  GUARDRAIL: 'evaluation',
  EVALUATOR: 'evaluation',
};

/** Span name prefixes used by instrumentations that do not set an operation attribute. */
const OPERATION_BY_NAME_PREFIX: readonly (readonly [string, AgentOperation])[] = [
  ['invoke_agent', 'invoke_agent'],
  ['execute_tool', 'execute_tool'],
  ['create_agent', 'create_agent'],
  ['invoke_workflow', 'invoke_workflow'],
  ['chat', 'chat'],
  ['text_completion', 'text_completion'],
  ['embeddings', 'embeddings'],
  ['retrieval', 'retrieval'],
  ['handoff', 'handoff'],
  ['approval', 'approval'],
  ['queue_wait', 'queue_wait'],
  ['side_effect', 'side_effect'],
  ['evaluation', 'evaluation'],
  ['outbound_request', 'outbound_request'],
];

export const classifyOperation = (name: string, attributes: Attributes): AgentOperation => {
  const declared = readString(attributes, GEN_AI.operationName);
  if (declared !== undefined) {
    const mapped = OPERATION_BY_GEN_AI[declared];
    if (mapped !== undefined) return mapped;
  }
  const openInference = readString(attributes, OPEN_INFERENCE.spanKind);
  if (openInference !== undefined) {
    const mapped = OPERATION_BY_OPEN_INFERENCE[openInference.toUpperCase()];
    if (mapped !== undefined) return mapped;
  }
  const lowered = name.toLowerCase();
  for (const [prefix, operation] of OPERATION_BY_NAME_PREFIX) {
    if (lowered.startsWith(prefix)) return operation;
  }
  if (readString(attributes, GEN_AI.toolName, OPEN_INFERENCE.toolName) !== undefined) {
    return 'execute_tool';
  }
  if (readString(attributes, GEN_AI.requestModel, OPEN_INFERENCE.modelName) !== undefined) {
    return 'chat';
  }
  return 'unclassified';
};

const KIND_BY_OPERATION: Readonly<Record<AgentOperation, ComponentKind | undefined>> = {
  invoke_agent: 'agent',
  create_agent: 'agent',
  invoke_workflow: 'agent_group',
  plan: 'agent',
  handoff: 'agent',
  chat: 'model',
  text_completion: 'model',
  embeddings: 'model',
  execute_tool: 'tool',
  retrieval: 'retrieval',
  memory_read: 'memory',
  memory_write: 'memory',
  queue_wait: 'queue',
  side_effect: 'side_effect',
  approval: 'approval_boundary',
  evaluation: 'evaluator',
  outbound_request: 'external_service',
  unclassified: undefined,
};

export const componentKindFor = (operation: AgentOperation): ComponentKind | undefined =>
  KIND_BY_OPERATION[operation];

/**
 * The name the running system reports for the component a span belongs to. An explicit
 * `orchescope.component` attribute wins, then the convention attributes, then the span name with its
 * operation prefix removed.
 */
export const observedNameFor = (
  operation: AgentOperation,
  name: string,
  attributes: Attributes,
): string => {
  const explicit = readString(attributes, ORCHESCOPE.component);
  if (explicit !== undefined) return explicit;
  switch (operation) {
    case 'invoke_agent':
    case 'create_agent':
    case 'plan':
    case 'handoff':
      return readString(attributes, GEN_AI.agentName, GEN_AI.agentId) ?? stripPrefix(name);
    case 'invoke_workflow':
      return readString(attributes, GEN_AI.workflowName) ?? stripPrefix(name);
    case 'chat':
    case 'text_completion':
    case 'embeddings': {
      const model = readString(
        attributes,
        GEN_AI.requestModel,
        GEN_AI.responseModel,
        OPEN_INFERENCE.modelName,
      );
      const provider = readString(
        attributes,
        GEN_AI.providerName,
        GEN_AI.legacySystem,
        OPEN_INFERENCE.provider,
      );
      if (model === undefined) return stripPrefix(name);
      return provider === undefined ? model : `${provider}/${model}`;
    }
    case 'execute_tool':
      return (
        readString(attributes, GEN_AI.toolName, OPEN_INFERENCE.toolName, MCP.toolName) ??
        stripPrefix(name)
      );
    case 'retrieval':
      return readString(attributes, GEN_AI.dataSourceId) ?? stripPrefix(name);
    default:
      return stripPrefix(name);
  }
};

const stripPrefix = (name: string): string => {
  const space = name.indexOf(' ');
  if (space <= 0) return name;
  const prefix = name.slice(0, space).toLowerCase();
  return OPERATION_BY_NAME_PREFIX.some(([candidate]) => candidate === prefix)
    ? name.slice(space + 1)
    : name;
};
