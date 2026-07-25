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
export const ComponentKind = literals(
  [
    'project',
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
    'worker',
    'database',
    'external_service',
    'approval_boundary',
    'side_effect',
    'guardrail',
    'evaluator',
  ] as const,
  { description: 'Kind of component in the unified agent system model.' },
);
export type ComponentKind = Static<typeof ComponentKind>;

/**
 * Effect classification. Drives retry safety findings, chaos safety gates and approval analysis.
 * `unknown` is a first class answer: Orchescope must not guess that an operation is safe to retry.
 */
export const SideEffectClass = literals([
  'read_only',
  'idempotent_write',
  'non_idempotent_write',
  'external_notification',
  'financial',
  'destructive',
  'unknown',
] as const);
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
