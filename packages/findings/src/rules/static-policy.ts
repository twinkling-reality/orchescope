import { absenceEvidence, CONFIDENCE_BANDS, derivedEvidence } from '@orchescope/domain';
import {
  controlFlowCycles,
  degrees,
  isControlFlowKind,
  unreachableComponents,
} from '@orchescope/graph';
import type { Component, Edge, EvidenceId, SideEffectClass } from '@orchescope/schema';
import { clear, type FindingDraft, fired, notApplicable, type Rule } from '../rule.ts';

/**
 * Rules that read the declared model only.
 *
 * These fire without any runtime evidence, which is what makes `orchescope audit` useful on a repository
 * nobody has run yet. Each one names the declaration it read, and none of them claim runtime behaviour.
 */

const PRODUCER = 'rule:static-policy';

const RETRY_UNSAFE_EFFECTS: readonly SideEffectClass[] = [
  'non_idempotent_write',
  'financial',
  'destructive',
  'external_notification',
  'unknown',
];

const targetOf = (
  context: { graph: { component: (id: string) => Component | undefined } },
  edge: Edge,
) => context.graph.component(edge.to);

export const unsafeRetryRule: Rule = {
  id: 'retry-around-non-idempotent-operation',
  category: 'reliability',
  summary: 'A retry wrapped around an operation whose idempotency was not established.',
  evaluate: (context) => {
    const drafts: FindingDraft[] = [];
    for (const edge of context.graph.graph.edges) {
      const retry = edge.policy?.retry;
      if (retry === undefined) continue;
      const target = targetOf(context, edge);
      if (target === undefined) continue;
      const effect = target.sideEffect ?? 'unknown';
      if (!RETRY_UNSAFE_EFFECTS.includes(effect)) continue;
      if (retry.idempotency === 'declared') continue;

      const source = context.graph.component(edge.from);
      const record = derivedEvidence({
        producer: PRODUCER,
        rule: 'retry-around-non-idempotent-operation',
        inputs: edge.evidence as EvidenceId[],
        note: `retry ${retry.bounded ? `bounded at ${retry.maxAttempts ?? 'unknown'} attempts` : 'with no attempt ceiling'} around an operation classified ${effect} with idempotency ${retry.idempotency}`,
      });
      drafts.push({
        ruleId: 'retry-around-non-idempotent-operation',
        category: 'reliability',
        polarity: 'risk',
        severity: effect === 'unknown' ? 'medium' : 'high',
        confidence:
          effect === 'unknown' ? CONFIDENCE_BANDS.structural : CONFIDENCE_BANDS.strongStructural,
        basis: 'discovered',
        title: `Retry around ${target.displayName} can repeat an effect that is not known to be idempotent`,
        explanation: `${source?.displayName ?? edge.from} retries ${target.displayName}, whose effect class is ${effect}, and no idempotency key was found on the operation. Retrying an operation that is not idempotent produces the effect twice whenever the first attempt fails after the effect has already happened, which is exactly the case a timeout cannot distinguish.`,
        impact:
          'Under a transient failure the external effect happens more than once. Nothing downstream can collapse the duplicates without a key.',
        components: [target.id, ...(source === undefined ? [] : [source.id])],
        edges: [edge.id],
        newEvidence: [record],
        evidence: edge.evidence as EvidenceId[],
        taxonomy: ['owasp-asi:ASI06'],
        recommendation: {
          summary: `Attach an idempotency key to ${target.displayName}, or remove the retry.`,
          steps: [
            'Derive a key from the request fields that define the operation, not from a timestamp.',
            'Send the key on every attempt including the first.',
            'Run the chaos scenario that injects a tool timeout and confirm a single effect.',
          ],
          effort: 'small',
          risk: 'medium',
        },
        suggestedExperiment: {
          description:
            'Inject a tool timeout on the first attempt and count the resulting effects.',
          command: ['orchescope', 'chaos', '--scenario', 'scenarios/support-desk.yaml'],
          expectedSignal: 'one effect instead of two, with task success unchanged',
        },
        goalEligible: true,
        goalReason:
          'The change is local to one call site and is verified by a deterministic chaos run.',
        tags: ['retry', 'idempotency'],
      });
    }
    return fired(
      drafts,
      drafts.length === 0 ? 'every retried operation declared an idempotency key' : undefined,
    );
  },
};

export const unboundedRetryRule: Rule = {
  id: 'unbounded-retry',
  category: 'reliability',
  summary: 'A retry with no attempt ceiling.',
  evaluate: (context) => {
    const drafts: FindingDraft[] = [];
    for (const edge of context.graph.graph.edges) {
      const retry = edge.policy?.retry;
      if (retry === undefined || retry.bounded) continue;
      const target = context.graph.component(edge.to);
      const source = context.graph.component(edge.from);
      drafts.push({
        ruleId: 'unbounded-retry',
        category: 'reliability',
        polarity: 'risk',
        severity: 'medium',
        confidence: CONFIDENCE_BANDS.structural,
        basis: 'discovered',
        title: `Retry of ${target?.displayName ?? edge.to} has no attempt ceiling`,
        explanation: `The retry around ${target?.displayName ?? edge.to} was discovered as a loop with a catch and no attempt limit could be established from the source. An unbounded retry converts a persistent downstream failure into unbounded cost and an unbounded wait.`,
        impact:
          'A failing dependency can consume the whole budget of a run and never surface an error.',
        components: [
          ...(target === undefined ? [] : [target.id]),
          ...(source === undefined ? [] : [source.id]),
        ],
        edges: [edge.id],
        evidence: edge.evidence as EvidenceId[],
        recommendation: {
          summary: 'Give the retry an explicit maximum attempt count and a backoff.',
          steps: [
            'Set a maximum attempt count at the call site.',
            'Add a bounded backoff so repeated failures do not hammer the dependency.',
          ],
          effort: 'small',
          risk: 'low',
        },
        goalEligible: true,
        goalReason: 'A bounded change at one call site with a static check.',
        tags: ['retry'],
      });
    }
    return fired(
      drafts,
      drafts.length === 0 ? 'every discovered retry had an attempt ceiling' : undefined,
    );
  },
};

export const missingTimeoutRule: Rule = {
  id: 'model-call-without-timeout',
  category: 'reliability',
  summary: 'A model invocation with no timeout in the declared configuration.',
  evaluate: (context) => {
    const modelEdges = context.graph.edgesOfKind('invokes_model');
    if (modelEdges.length === 0) return notApplicable('no model invocation was discovered');
    const missing = modelEdges.filter((edge) => edge.policy?.timeoutMs === undefined);
    if (missing.length === 0) {
      const evidence = modelEdges.flatMap((edge) => edge.evidence.slice(0, 1)) as EvidenceId[];
      return fired([
        {
          ruleId: 'model-call-without-timeout',
          category: 'reliability',
          polarity: 'strength',
          severity: 'info',
          confidence: CONFIDENCE_BANDS.strongStructural,
          basis: 'discovered',
          title: 'Every discovered model invocation declares a timeout',
          explanation: `All ${modelEdges.length} model invocation relations carry an explicit timeout, so a hung provider cannot stall a run indefinitely.`,
          impact:
            'A slow or hanging provider fails fast instead of consuming the whole run budget.',
          components: modelEdges.map((edge) => edge.from),
          edges: modelEdges.map((edge) => edge.id),
          evidence,
          goalEligible: false,
          goalReason: 'Nothing to change.',
          tags: ['positive', 'timeout'],
        },
      ]);
    }
    // Grouped by the model rather than reported per relation: five callers of one untimed model is one problem with
    // five call sites, and five findings would bury the rest of the report.
    const byModel = new Map<string, typeof missing>();
    for (const edge of missing) {
      const bucket = byModel.get(edge.to);
      if (bucket === undefined) byModel.set(edge.to, [edge]);
      else bucket.push(edge);
    }

    const drafts: FindingDraft[] = [...byModel].map(([modelId, edges]) => {
      const target = context.graph.component(modelId);
      const callers = [...new Set(edges.map((edge) => edge.from))];
      return {
        ruleId: 'model-call-without-timeout',
        category: 'reliability' as const,
        polarity: 'risk' as const,
        severity: 'medium' as const,
        confidence: CONFIDENCE_BANDS.structural,
        basis: 'discovered' as const,
        title: `Model call to ${target?.displayName ?? modelId} declares no timeout`,
        explanation: `No timeout was found in the configuration of ${edges.length} invocation relation(s) reaching this model, from ${callers.length} caller(s). A provider that stops responding will hold the request until something else gives up, and nothing in the declared configuration says when that is.`,
        impact: 'One unresponsive provider call can consume an entire run.',
        components: [...callers, ...(target === undefined ? [] : [target.id])],
        edges: edges.map((edge) => edge.id),
        evidence: edges.flatMap((edge) => edge.evidence.slice(0, 2)) as EvidenceId[],
        recommendation: {
          summary: 'Set an explicit request timeout on the model client or the call site.',
          steps: [
            'Choose a timeout from the observed p95 latency plus headroom.',
            'Set it at the client.',
          ],
          effort: 'small' as const,
          risk: 'low' as const,
        },
        goalEligible: true,
        goalReason: 'One configuration value with a static check.',
        tags: ['timeout'],
      };
    });
    return fired(drafts);
  },
};

export const approvalBoundaryRule: Rule = {
  id: 'side-effect-approval-boundary',
  category: 'security',
  summary: 'Whether an operation with an external effect is guarded by an approval boundary.',
  evaluate: (context) => {
    const risky = context.graph.graph.components.filter(
      (component) =>
        component.sideEffect === 'financial' ||
        component.sideEffect === 'destructive' ||
        component.sideEffect === 'non_idempotent_write',
    );
    if (risky.length === 0)
      return notApplicable('no operation with a risky effect class was discovered');

    const drafts: FindingDraft[] = [];
    for (const component of risky) {
      const guarded = context.graph
        .outgoing(component.id)
        .some((edge) => edge.kind === 'guarded_by');
      const requiresApproval =
        component.details?.for === 'tool' && component.details.approvalRequired === true;
      const incoming = context.graph.incoming(component.id);
      const guardedByPolicy = incoming.some((edge) => edge.policy?.requiresApproval === true);

      if (guarded || requiresApproval || guardedByPolicy) {
        drafts.push({
          ruleId: 'side-effect-approval-boundary',
          category: 'security',
          polarity: 'strength',
          severity: 'info',
          confidence: CONFIDENCE_BANDS.strongStructural,
          basis: 'discovered',
          title: `${component.displayName} is behind an approval boundary`,
          explanation: `${component.displayName} has effect class ${component.sideEffect} and is guarded: ${guarded ? 'an approval relation was discovered' : requiresApproval ? 'the tool declares that approval is required' : 'the calling relation declares that approval is required'}.`,
          impact:
            'The risky operation cannot run without an explicit decision, which is the correct shape.',
          components: [component.id],
          evidence: component.evidence.slice(0, 3) as EvidenceId[],
          goalEligible: false,
          goalReason: 'Nothing to change.',
          tags: ['positive', 'approval'],
        });
        continue;
      }

      const record = absenceEvidence({
        producer: PRODUCER,
        searched: `an approval relation or approval requirement on ${component.id}`,
        scope: 'the declared graph',
        inspectedCount: incoming.length,
      });
      drafts.push({
        ruleId: 'side-effect-approval-boundary',
        category: 'security',
        polarity: 'risk',
        severity: component.sideEffect === 'financial' ? 'high' : 'medium',
        confidence: CONFIDENCE_BANDS.structural,
        basis: 'discovered',
        title: `${component.displayName} performs a ${component.sideEffect} effect with no approval boundary`,
        explanation: `${component.displayName} was classified ${component.sideEffect} and no approval relation, tool approval requirement or calling policy requiring approval was found. A model deciding on its own to invoke this operation is the whole risk.`,
        impact:
          'An agent can perform a consequential external action without a human or a policy deciding that it should.',
        components: [component.id],
        newEvidence: [record],
        evidence: component.evidence.slice(0, 3) as EvidenceId[],
        taxonomy: ['owasp-llm:LLM06', 'owasp-asi:ASI04'],
        recommendation: {
          summary: `Require an explicit approval before ${component.displayName} executes.`,
          steps: [
            'Add an approval check at the call site, or mark the tool as needing approval in the framework.',
            'Record the approval decision on the span so the boundary is observable.',
          ],
          effort: 'medium',
          risk: 'low',
        },
        goalEligible: true,
        goalReason:
          'The scope is one call site plus a scenario that asserts the approval happened.',
        requiresHumanReview: true,
        tags: ['approval', 'side-effect'],
      });
    }
    return fired(drafts);
  },
};

export const promptInjectionBoundaryRule: Rule = {
  id: 'prompt-injection-boundary',
  category: 'security',
  summary: 'Places where content Orchescope cannot vouch for reaches a prompt.',
  evaluate: (context) => {
    const prompts = context.graph
      .componentsOfKind('prompt')
      .filter(
        (component) =>
          component.details?.for === 'prompt' &&
          component.details.interpolatesUntrustedInput === true,
      );
    if (prompts.length === 0) {
      return clear('no prompt was discovered that interpolates a value at run time');
    }

    const untrustedSources = [
      ...context.graph.componentsOfKind('retrieval'),
      ...context.graph.componentsOfKind('tool'),
      ...context.graph.componentsOfKind('mcp_server'),
    ];
    if (untrustedSources.length === 0) {
      return clear(
        'prompts interpolate values, and no retrieval or tool output was discovered as a source',
      );
    }

    const drafts: FindingDraft[] = prompts.map((prompt) => ({
      ruleId: 'prompt-injection-boundary',
      category: 'security' as const,
      polarity: 'risk' as const,
      severity: 'medium' as const,
      confidence: CONFIDENCE_BANDS.heuristic,
      basis: 'inferred' as const,
      title: `${prompt.displayName} interpolates run time content into a prompt`,
      explanation: `This prompt contains substitution points, and the system also reads content from ${untrustedSources.length} source(s) that Orchescope cannot vouch for: retrieval results, tool results and MCP server output. Whether a substituted value comes from one of those sources cannot be established from syntax alone, so this is a boundary to review rather than a proven vulnerability.`,
      impact:
        'If retrieved or tool provided text reaches this prompt, instructions inside that text are indistinguishable from the system prompt.',
      components: [prompt.id, ...untrustedSources.slice(0, 5).map((component) => component.id)],
      evidence: prompt.evidence.slice(0, 3) as EvidenceId[],
      taxonomy: ['owasp-llm:LLM01', 'owasp-asi:ASI01'],
      recommendation: {
        summary:
          'Separate untrusted content from instructions and constrain what the model may do with it.',
        steps: [
          'Pass retrieved or tool provided text as data in a clearly delimited section, never concatenated into the instruction.',
          'Restrict the tools available while untrusted content is in context.',
          'Add a scenario that injects an instruction into retrieved content and asserts the system does not follow it.',
        ],
        effort: 'medium',
        risk: 'medium',
      },
      suggestedExperiment: {
        description:
          'Inject an instruction into retrieved content and assert the system ignores it.',
        command: ['orchescope', 'chaos', '--scenario', 'scenarios/support-desk.yaml'],
        expectedSignal:
          'no policy violation and no prohibited effect while the injected content is present',
      },
      goalEligible: true,
      goalReason: 'The change is local to prompt assembly and is checked by an injection scenario.',
      requiresHumanReview: true,
      tags: ['prompt-injection'],
    }));
    return fired(drafts);
  },
};

export const architectureShapeRule: Rule = {
  id: 'topology-shape',
  category: 'architecture',
  summary: 'Fan out, reachability and cycles in the declared control flow.',
  evaluate: (context) => {
    const drafts: FindingDraft[] = [];
    const stats = degrees(context.graph);
    const highFanOut = stats.filter((entry) => entry.controlFlowOutDegree >= 8);
    for (const entry of highFanOut) {
      const component = context.graph.component(entry.componentId);
      if (component === undefined || component.kind !== 'agent') continue;
      drafts.push({
        ruleId: 'topology-shape',
        category: 'agent_complexity',
        polarity: 'risk',
        severity: 'low',
        confidence: CONFIDENCE_BANDS.deterministic,
        basis: 'discovered',
        title: `${component.displayName} coordinates ${entry.controlFlowOutDegree} downstream operations`,
        explanation: `This agent has ${entry.controlFlowOutDegree} outgoing control flow relations. Wide coordination is not wrong on its own, and it does make the agent's prompt, its failure handling and its token cost harder to reason about.`,
        impact: 'Every added branch multiplies the paths that have to be tested.',
        components: [component.id],
        evidence: component.evidence.slice(0, 2) as EvidenceId[],
        goalEligible: false,
        goalReason: 'Splitting an orchestrator is a design decision, not a bounded edit.',
        tags: ['complexity'],
      });
    }

    // Reachability is only meaningful for components that participate in control flow. A prompt, a model or a
    // provider is reached by being referenced, not by being called, so listing them here would be noise that buries
    // the finding a reader needs.
    const reachabilityKinds = new Set([
      'agent',
      'tool',
      'mcp_server',
      'worker',
      'queue',
      'retrieval',
      'memory',
      'database',
      'external_service',
    ]);
    const unreachable = unreachableComponents(context.graph).filter(
      (component) => component.presence.static && reachabilityKinds.has(component.kind),
    );
    for (const component of unreachable) {
      drafts.push({
        ruleId: 'topology-shape',
        category: 'architecture',
        polarity: 'risk',
        severity: 'low',
        confidence: CONFIDENCE_BANDS.structural,
        basis: 'discovered',
        title: `${component.displayName} cannot be reached from any entry point`,
        explanation: `No declared entry point reaches ${component.id} through control flow relations. Either the wiring is missing, or the component is left over.`,
        impact: 'Dead configuration is misleading to every future reader.',
        components: [component.id],
        evidence: component.evidence.slice(0, 2) as EvidenceId[],
        goalEligible: false,
        goalReason: 'Deleting or wiring a component is a decision for the owner.',
        tags: ['unreachable'],
      });
    }

    const cycles = controlFlowCycles(context.graph);
    for (const cycle of cycles.slice(0, 5)) {
      drafts.push({
        ruleId: 'topology-shape',
        category: 'architecture',
        polarity: 'risk',
        severity: 'low',
        confidence: CONFIDENCE_BANDS.deterministic,
        basis: 'discovered',
        title: `Control flow cycle: ${cycle.join(' to ')}`,
        explanation:
          'These components form a cycle in the declared control flow. A cycle is a legitimate pattern for a plan and act loop, and it is also where an unbounded loop lives, so it is worth an explicit iteration ceiling.',
        impact: 'Without a ceiling, a cycle can consume the whole budget of a run.',
        components: [...new Set(cycle)],
        evidence: (context.graph.component(cycle[0] ?? '')?.evidence.slice(0, 1) ??
          []) as EvidenceId[],
        goalEligible: false,
        goalReason: 'Whether the cycle is intended is a question for the owner.',
        tags: ['cycle'],
      });
    }

    if (drafts.length === 0 && context.graph.componentCount > 0) {
      return fired([
        {
          ruleId: 'topology-shape',
          category: 'architecture',
          polarity: 'strength',
          severity: 'info',
          confidence: CONFIDENCE_BANDS.deterministic,
          basis: 'discovered',
          title: 'The declared topology is reachable, acyclic and narrow',
          explanation: `Every declared component is reachable from an entry point, the control flow contains no cycle, and no agent coordinates more than eight downstream operations.`,
          impact: 'The system can be reasoned about one path at a time.',
          components: context.graph.graph.components.slice(0, 5).map((component) => component.id),
          evidence: context.graph.graph.components
            .slice(0, 3)
            .flatMap((component) => component.evidence.slice(0, 1)) as EvidenceId[],
          goalEligible: false,
          goalReason: 'Nothing to change.',
          tags: ['positive', 'topology'],
        },
      ]);
    }
    return fired(drafts);
  },
};

export const broadPermissionRule: Rule = {
  id: 'permissions-broader-than-observed-use',
  category: 'permissions',
  summary: 'A declared permission that observed behaviour did not need.',
  evaluate: (context) => {
    if (context.runs.length === 0) {
      return {
        status: 'insufficient_evidence',
        detail:
          'permission breadth is only meaningful against observed use, and no run has been ingested',
        drafts: [],
      };
    }
    const drafts: FindingDraft[] = [];
    for (const component of context.graph.graph.components) {
      const writePermissions = component.permissions.filter(
        (permission) => permission.mode === 'write',
      );
      if (writePermissions.length === 0) continue;
      if (component.presence.runtime && component.metadata['observedSideEffect'] === true) continue;
      if (!component.presence.runtime) continue;

      const record = absenceEvidence({
        producer: PRODUCER,
        searched: `a side effect performed by ${component.id}`,
        scope: `${context.runs.length} observed run(s)`,
        inspectedCount: context.runs.length,
      });
      drafts.push({
        ruleId: 'permissions-broader-than-observed-use',
        category: 'permissions',
        polarity: 'risk',
        severity: 'low',
        confidence: CONFIDENCE_BANDS.structural,
        basis: 'inferred',
        title: `${component.displayName} holds write access it was not observed using`,
        explanation: `${component.displayName} declares ${writePermissions.length} write permission(s) on ${writePermissions.map((permission) => permission.scope).join(', ')}, ran in ${context.runs.length} observed run(s), and performed no recorded side effect. Observed use is not proof that write access is unnecessary, and it is the evidence available.`,
        impact:
          'Broader access than a component needs widens the blast radius of a prompt injection or a bug.',
        components: [component.id],
        newEvidence: [record],
        evidence: component.evidence.slice(0, 2) as EvidenceId[],
        taxonomy: ['owasp-llm:LLM06'],
        recommendation: {
          summary:
            'Narrow the permission to what the observed paths need, or record why the wider access is required.',
          steps: [
            'Check whether any path needs write access to this scope.',
            'Narrow the credential or the configuration if not.',
          ],
          effort: 'small',
          risk: 'medium',
        },
        goalEligible: false,
        goalReason:
          'Narrowing a permission needs a human to confirm no unobserved path depends on it.',
        requiresHumanReview: true,
        tags: ['permissions', 'least-privilege'],
      });
    }
    return fired(
      drafts,
      drafts.length === 0 ? 'every write permission was matched by observed use' : undefined,
    );
  },
};

export const unusedConfiguredToolRule: Rule = {
  id: 'configured-tool-has-no-caller',
  category: 'maintainability',
  summary: 'A tool that exists in the declared model with nothing calling it.',
  evaluate: (context) => {
    const tools = context.graph.componentsOfKind('tool');
    if (tools.length === 0) return notApplicable('no tool was discovered');
    const orphans = tools.filter(
      (tool) =>
        !context.graph
          .incoming(tool.id)
          .some((edge) => isControlFlowKind(edge.kind) || edge.kind === 'provides_tool'),
    );
    if (orphans.length === 0) return clear('every discovered tool has at least one caller');

    const drafts: FindingDraft[] = orphans.map((tool) => ({
      ruleId: 'configured-tool-has-no-caller',
      category: 'maintainability' as const,
      polarity: 'risk' as const,
      severity: 'low' as const,
      confidence: CONFIDENCE_BANDS.structural,
      basis: 'discovered' as const,
      title: `${tool.displayName} is defined and nothing calls it`,
      explanation: `${tool.displayName} was discovered as a tool and no agent, group or server relation points at it. Either the wiring is missing, or the tool is left over from a change.`,
      impact: 'A tool nobody calls still has to be maintained, and it may still hold credentials.',
      components: [tool.id],
      evidence: tool.evidence.slice(0, 2) as EvidenceId[],
      goalEligible: false,
      goalReason: 'Wiring or deleting a tool is a decision for the owner.',
      tags: ['dead-configuration'],
    }));
    return fired(drafts);
  },
};

export const STATIC_RULES: readonly Rule[] = [
  unsafeRetryRule,
  unboundedRetryRule,
  missingTimeoutRule,
  approvalBoundaryRule,
  promptInjectionBoundaryRule,
  architectureShapeRule,
  broadPermissionRule,
  unusedConfiguredToolRule,
];
