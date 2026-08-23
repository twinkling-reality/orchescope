import type {
  AgentOperation,
  ComponentKind,
  MetadataValue,
  ObservedValueProvenance,
} from '@orchescope/schema';

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
  system: 'llm.system',
  promptTokens: 'llm.token_count.prompt',
  completionTokens: 'llm.token_count.completion',
  toolName: 'tool.name',
  agentName: 'agent.name',
  graphNodeId: 'graph.node.id',
  metadata: 'metadata',
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
  repositoryUrl: 'vcs.repository.url.full',
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
  repositoryPath: 'orchescope.code.repository.path',
  sourceCapture: 'orchescope.source.capture',
} as const;

export type Attributes = Readonly<Record<string, MetadataValue>>;

export type AttributeReading<T> = {
  readonly value: T;
  readonly attribute: string;
};

export const noAttributeProvenance = (
  spanField: ObservedValueProvenance['spanFields'][number],
): ObservedValueProvenance => ({ attributes: [], spanFields: [spanField] });

export const attributeProvenance = (...attributes: readonly string[]): ObservedValueProvenance => ({
  attributes: [...new Set(attributes)],
  spanFields: [],
});

export const readStringAttribute = (
  attributes: Attributes,
  ...keys: readonly string[]
): AttributeReading<string> | undefined => {
  for (const key of keys) {
    const value = attributes[key];
    if (typeof value === 'string' && value.length > 0) return { value, attribute: key };
  }
  return undefined;
};

export const readString = (
  attributes: Attributes,
  ...keys: readonly string[]
): string | undefined => readStringAttribute(attributes, ...keys)?.value;

export const readNumberAttribute = (
  attributes: Attributes,
  ...keys: readonly string[]
): AttributeReading<number> | undefined => {
  for (const key of keys) {
    const value = attributes[key];
    if (typeof value === 'number' && Number.isFinite(value)) return { value, attribute: key };
    if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) {
      return { value: Number(value), attribute: key };
    }
  }
  return undefined;
};

export const readNumber = (
  attributes: Attributes,
  ...keys: readonly string[]
): number | undefined => readNumberAttribute(attributes, ...keys)?.value;

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

/**
 * The provider a span names, in the order one convention supersedes the last.
 *
 * `gen_ai.provider.name` is the current generative AI attribute and `gen_ai.system` the deprecated name it
 * replaced. OpenInference carries two: `llm.provider` names who hosts the model and `llm.system` names the
 * API it speaks, and an instrumentor may write either or both. Only the first was read, and the OpenAI
 * Agents instrumentor writes only the second, so a model that run reported was named `gpt-5.2-2025-12-11`
 * while every model declared beside it carried the provider serving it. Two models of the same name from
 * two providers were one component.
 */
export const providerNamed = (attributes: Attributes): string | undefined =>
  providerReading(attributes)?.value;

const providerReading = (attributes: Attributes): AttributeReading<string> | undefined =>
  readStringAttribute(
    attributes,
    GEN_AI.providerName,
    GEN_AI.legacySystem,
    OPEN_INFERENCE.provider,
    OPEN_INFERENCE.system,
  );

/** The model a span names. Spelled once here because three call sites spelled it three ways. */
export const modelNamed = (attributes: Attributes): string | undefined =>
  modelReading(attributes)?.value;

const modelReading = (attributes: Attributes): AttributeReading<string> | undefined =>
  readStringAttribute(
    attributes,
    GEN_AI.requestModel,
    GEN_AI.responseModel,
    OPEN_INFERENCE.modelName,
  );

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
  ['mcp_request', 'mcp_request'],
  ['outbound_request', 'outbound_request'],
];

export const operationWithProvenance = (
  name: string,
  attributes: Attributes,
): { readonly operation: AgentOperation; readonly provenance: ObservedValueProvenance } => {
  const declared = readStringAttribute(attributes, GEN_AI.operationName);
  if (declared !== undefined) {
    const mapped = OPERATION_BY_GEN_AI[declared.value];
    if (mapped !== undefined) {
      return { operation: mapped, provenance: attributeProvenance(declared.attribute) };
    }
  }
  const openInference = readStringAttribute(attributes, OPEN_INFERENCE.spanKind);
  if (openInference !== undefined) {
    const mapped = OPERATION_BY_OPEN_INFERENCE[openInference.value.toUpperCase()];
    if (mapped !== undefined) {
      return { operation: mapped, provenance: attributeProvenance(openInference.attribute) };
    }
  }
  const lowered = name.toLowerCase();
  for (const [prefix, operation] of OPERATION_BY_NAME_PREFIX) {
    if (lowered.startsWith(prefix)) {
      return { operation, provenance: noAttributeProvenance('name') };
    }
  }
  const tool = readStringAttribute(attributes, GEN_AI.toolName, OPEN_INFERENCE.toolName);
  if (tool !== undefined) {
    return { operation: 'execute_tool', provenance: attributeProvenance(tool.attribute) };
  }
  const model = readStringAttribute(attributes, GEN_AI.requestModel, OPEN_INFERENCE.modelName);
  if (model !== undefined) {
    return { operation: 'chat', provenance: attributeProvenance(model.attribute) };
  }
  return { operation: 'unclassified', provenance: noAttributeProvenance('name') };
};

export const classifyOperation = (name: string, attributes: Attributes): AgentOperation =>
  operationWithProvenance(name, attributes).operation;

const KIND_BY_OPERATION: Readonly<Record<AgentOperation, ComponentKind | undefined>> = {
  invoke_agent: 'agent',
  create_agent: 'agent',
  invoke_workflow: 'workflow',
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
  mcp_request: 'mcp_server',
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
export const observedNameWithProvenance = (
  operation: AgentOperation,
  name: string,
  attributes: Attributes,
): { readonly name: string; readonly provenance: ObservedValueProvenance } => {
  const explicit = readStringAttribute(attributes, ORCHESCOPE.component);
  if (explicit !== undefined) {
    return { name: explicit.value, provenance: attributeProvenance(explicit.attribute) };
  }
  const named = (...keys: readonly string[]) => readStringAttribute(attributes, ...keys);
  const fromAttribute = (reading: AttributeReading<string>) => ({
    name: reading.value,
    provenance: attributeProvenance(reading.attribute),
  });
  const fromSpanName = () => ({
    name: stripPrefix(name),
    provenance: noAttributeProvenance('name'),
  });
  switch (operation) {
    case 'invoke_agent':
    case 'create_agent':
    case 'plan':
    case 'handoff': {
      const reading = named(
        GEN_AI.agentName,
        GEN_AI.agentId,
        OPEN_INFERENCE.agentName,
        OPEN_INFERENCE.graphNodeId,
      );
      return reading === undefined ? fromSpanName() : fromAttribute(reading);
    }
    case 'invoke_workflow': {
      const reading = named(GEN_AI.workflowName);
      return reading === undefined ? fromSpanName() : fromAttribute(reading);
    }
    case 'chat':
    case 'text_completion':
    case 'embeddings': {
      const model = modelReading(attributes);
      const provider = providerReading(attributes);
      if (model === undefined) return fromSpanName();
      return {
        name: provider === undefined ? model.value : `${provider.value}/${model.value}`,
        provenance: attributeProvenance(
          model.attribute,
          ...(provider === undefined ? [] : [provider.attribute]),
        ),
      };
    }
    case 'execute_tool': {
      const reading = named(GEN_AI.toolName, OPEN_INFERENCE.toolName, MCP.toolName);
      return reading === undefined ? fromSpanName() : fromAttribute(reading);
    }
    case 'retrieval': {
      const reading = named(GEN_AI.dataSourceId);
      return reading === undefined ? fromSpanName() : fromAttribute(reading);
    }
    default:
      return fromSpanName();
  }
};

export const observedNameFor = (
  operation: AgentOperation,
  name: string,
  attributes: Attributes,
): string => observedNameWithProvenance(operation, name, attributes).name;

const stripPrefix = (name: string): string => {
  const space = name.indexOf(' ');
  if (space <= 0) return name;
  const prefix = name.slice(0, space).toLowerCase();
  return OPERATION_BY_NAME_PREFIX.some(([candidate]) => candidate === prefix)
    ? name.slice(space + 1)
    : name;
};
