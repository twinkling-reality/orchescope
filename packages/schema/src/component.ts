import { type Static, type TProperties, Type } from '@sinclair/typebox';
import { ClaimBasis, ConfigLocation, EvidenceId, SourceLocation } from './evidence.ts';
import { ComponentAlias, ComponentId, ComponentIdentity } from './identity.ts';
import {
  Confidence,
  literals,
  Metadata,
  NonEmptyString,
  NonNegativeInt,
  Sha256Hex,
} from './primitives.ts';

/**
 * The component vocabulary of an agentic system. A component is anything that can be pointed at
 * in a review conversation: an agent, the model behind it, the tool it calls, the store it reads.
 */
/**
 * Every kind something in this build can produce, and nothing else.
 *
 * `project`, `worker` and `guardrail` were here and no adapter, no trace and no manifest ever wrote one.
 * A kind in that position is not harmless vocabulary waiting for a producer: `worker` and `guardrail` sat
 * in the set that decides which components an exercise rate is computed over, and `project` in the guard
 * that keeps a component out of the unreachable population, so three sets claimed a coverage this build
 * did not have and no reader could tell, because a filter that never matches looks exactly like a filter
 * with nothing to match.
 *
 * A worker is already in the model, as an agent whose `details.role` is `worker`, which is what CrewAI,
 * LangGraph, the OpenAI Agents SDK and the Vercel AI SDK all write. The other two named nothing at all.
 *
 * `tests/e2e/rule-input-producers.test.ts` asks this list against what a scan and a run can produce, so
 * adding a kind here means writing the producer or failing that check.
 */
export const COMPONENT_KINDS = [
  'entrypoint',
  'agent',
  'agent_group',
  'model',
  'provider',
  'prompt',
  'tool',
  'mcp_server',
  'memory',
  'retrieval',
  'queue',
  'database',
  'external_service',
  'approval_boundary',
  'side_effect',
  'evaluator',
] as const;

export const ComponentKind = literals(COMPONENT_KINDS, {
  description: 'Kind of component in the unified agent system model.',
});
export type ComponentKind = Static<typeof ComponentKind>;

/**
 * Effect classification. Drives retry safety findings, chaos safety gates and approval analysis.
 * `unknown` is a first class answer: Orchescope must not guess that an operation is safe to retry.
 */
export const SIDE_EFFECT_CLASSES = [
  'read_only',
  'idempotent_write',
  'non_idempotent_write',
  'external_notification',
  'financial',
  'destructive',
  'unknown',
] as const;

export const SideEffectClass = literals(SIDE_EFFECT_CLASSES);
export type SideEffectClass = Static<typeof SideEffectClass>;

export const PermissionKind = literals([
  'filesystem',
  'network',
  'process',
  'model',
  'secret',
  'database',
  'queue',
  'mcp',
] as const);

export const Permission = Type.Object(
  {
    kind: PermissionKind,
    scope: NonEmptyString({
      description: 'Resource the permission applies to, for example a host or path.',
    }),
    mode: literals(['read', 'write', 'execute'] as const),
    declaredIn: Type.Optional(Type.Union([SourceLocation, ConfigLocation])),
  },
  { additionalProperties: false },
);
export type Permission = Static<typeof Permission>;

const detail = <const K extends string, T extends TProperties>(forKind: K, properties: T) =>
  Type.Object({ for: Type.Literal(forKind), ...properties }, { additionalProperties: false });

export const AgentDetails = detail('agent', {
  instructionsRef: Type.Optional(
    NonEmptyString({ description: 'Prompt component id or artifact digest.' }),
  ),
  toolCount: Type.Optional(NonNegativeInt),
  maxTurns: Type.Optional(NonNegativeInt),
  framework: Type.Optional(NonEmptyString()),
  role: Type.Optional(
    literals(['orchestrator', 'worker', 'router', 'evaluator', 'unspecified'] as const),
  ),
});

export const ModelDetails = detail('model', {
  provider: Type.Optional(NonEmptyString()),
  modelId: Type.Optional(NonEmptyString()),
  temperature: Type.Optional(Type.Number()),
  maxOutputTokens: Type.Optional(NonNegativeInt),
  streaming: Type.Optional(Type.Boolean()),
  timeoutMs: Type.Optional(NonNegativeInt),
  structuredOutput: Type.Optional(Type.Boolean()),
});

export const ToolDetails = detail('tool', {
  parameterCount: Type.Optional(NonNegativeInt),
  /** MCP tool annotations, when the tool is declared by an MCP server that supplies them. */
  readOnlyHint: Type.Optional(Type.Boolean()),
  destructiveHint: Type.Optional(Type.Boolean()),
  idempotentHint: Type.Optional(Type.Boolean()),
  openWorldHint: Type.Optional(Type.Boolean()),
  timeoutMs: Type.Optional(NonNegativeInt),
  approvalRequired: Type.Optional(Type.Boolean()),
});

export const McpServerDetails = detail('mcp_server', {
  transport: Type.Optional(literals(['stdio', 'http', 'sse', 'unknown'] as const)),
  command: Type.Optional(NonEmptyString()),
  argsCount: Type.Optional(NonNegativeInt),
  url: Type.Optional(NonEmptyString()),
  envKeys: Type.Optional(Type.Array(NonEmptyString())),
  /**
   * What this repository has to do with the server.
   *
   * `implemented` is a server this repository's source constructs. `consumed` is one its source connects
   * to as a client. `developer_tooling` is one whose only declaration is a file that configures a coding
   * agent or an editor, which is a fact about whoever works on the repository rather than about the
   * system in it. The three are not interchangeable: a `.mcp.json` listing one server was enough to
   * report a 220 component application as a detected agent system containing no agent, tool or model,
   * and then to raise a finding against the repository for the contradiction.
   */
  role: Type.Optional(literals(['implemented', 'consumed', 'developer_tooling'] as const)),
});

export const PromptDetails = detail('prompt', {
  /** Digest of the template text. The text itself is stored as a redacted artifact. */
  textHash: Type.Optional(Sha256Hex),
  variableCount: Type.Optional(NonNegativeInt),
  approximateTokens: Type.Optional(NonNegativeInt),
  interpolatesUntrustedInput: Type.Optional(Type.Boolean()),
});

export const RetrievalDetails = detail('retrieval', {
  store: Type.Optional(NonEmptyString()),
  embeddingModel: Type.Optional(NonEmptyString()),
  topK: Type.Optional(NonNegativeInt),
  contentIsUntrusted: Type.Optional(Type.Boolean()),
});

export const QueueDetails = detail('queue', {
  bounded: Type.Optional(Type.Boolean()),
  capacity: Type.Optional(NonNegativeInt),
  workerCount: Type.Optional(NonNegativeInt),
});

export const ServiceDetails = detail('external_service', {
  host: Type.Optional(NonEmptyString()),
  protocol: Type.Optional(NonEmptyString()),
  authKind: Type.Optional(literals(['none', 'api_key', 'oauth', 'unknown'] as const)),
});

export const ApprovalDetails = detail('approval_boundary', {
  mechanism: Type.Optional(literals(['interactive', 'policy', 'human_review', 'unknown'] as const)),
  guardsSideEffect: Type.Optional(Type.Boolean()),
});

export type AgentDetails = Static<typeof AgentDetails>;
export type ModelDetails = Static<typeof ModelDetails>;
export type ToolDetails = Static<typeof ToolDetails>;
export type McpServerDetails = Static<typeof McpServerDetails>;
export type PromptDetails = Static<typeof PromptDetails>;
export type RetrievalDetails = Static<typeof RetrievalDetails>;
export type QueueDetails = Static<typeof QueueDetails>;
export type ServiceDetails = Static<typeof ServiceDetails>;
export type ApprovalDetails = Static<typeof ApprovalDetails>;

export const ComponentDetails = Type.Union([
  AgentDetails,
  ModelDetails,
  ToolDetails,
  McpServerDetails,
  PromptDetails,
  RetrievalDetails,
  QueueDetails,
  ServiceDetails,
  ApprovalDetails,
]);
export type ComponentDetails = Static<typeof ComponentDetails>;

/** Where a component was seen. A component may be present statically, at runtime, or both. */
export const Presence = Type.Object(
  {
    static: Type.Boolean({ description: 'Discovered by source or configuration analysis.' }),
    runtime: Type.Boolean({ description: 'Observed in at least one ingested trace.' }),
    manifest: Type.Boolean({ description: 'Declared in a .orchescope manifest.' }),
  },
  { additionalProperties: false },
);
export type Presence = Static<typeof Presence>;

export const Component = Type.Object(
  {
    id: ComponentId,
    identity: ComponentIdentity,
    /** Digest of the canonical identity, used to match components across scans and machines. */
    fingerprint: Sha256Hex,
    kind: ComponentKind,
    displayName: NonEmptyString(),
    description: Type.Optional(Type.String({ maxLength: 1000 })),
    presence: Presence,
    basis: ClaimBasis,
    confidence: Confidence,
    /** Adapter identifiers that contributed this component, in discovery order. */
    discoveredBy: Type.Array(NonEmptyString(), { minItems: 1 }),
    sourceLocations: Type.Array(SourceLocation),
    configLocations: Type.Array(ConfigLocation),
    /**
     * True when every source location that declares this component is a test file.
     *
     * A developer's tooling is not the system under audit, which is an invariant this repository already
     * held and honoured in four adapters out of thirteen. On the frameworks it reads, most of the graph is
     * the framework's own test suite: 835 of 903 pydantic-ai components, 662 of 899 openai-agents ones,
     * and on one application built with pydantic-ai, ten of the sixteen agents it reported were named in
     * `tests/`, three of them copies of one `_make_test_agent` helper.
     *
     * Marked rather than dropped, because a test that declares an agent really does declare one and a
     * count that silently omits it answers a question nobody asked. What a scan read stays in the graph
     * and says what it is, and the rules whose population is the system under audit exclude it.
     *
     * Every location and not the first, because a component declared in a test and in the source it tests
     * is part of the system. Absent rather than false where it does not apply, so a component with no
     * source location at all, which is what a manifest and a trace both produce, states nothing.
     */
    declaredInTest: Type.Optional(Type.Literal(true)),
    evidence: Type.Array(EvidenceId),
    details: Type.Optional(ComponentDetails),
    sideEffect: Type.Optional(SideEffectClass),
    permissions: Type.Array(Permission),
    aliases: Type.Array(ComponentAlias),
    tags: Type.Array(NonEmptyString()),
    metadata: Metadata,
  },
  { additionalProperties: false },
);
export type Component = Static<typeof Component>;
