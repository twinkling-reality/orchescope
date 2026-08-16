import {
  absenceEvidence,
  CONFIDENCE_BANDS,
  derivedEvidence,
  formatCount,
  partOfAuditedSystem,
} from '@orchescope/domain';
import {
  controlFlowCycles,
  degrees,
  type IndexedGraph,
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

/**
 * Whether this retry sits in front of an operation whose repeat cannot be ruled out.
 *
 * Shared by the two retry rules so that one cannot start reporting a call site the other has stopped
 * reporting. In all three repositories where both fired across a thirty six repository sweep, their
 * components and source locations were byte identical: from the outside it read as one problem counted
 * twice, and it doubled the medium severity count wherever it happened.
 */
const retryIsUnsafe = (
  context: { graph: { component: (id: string) => Component | undefined } },
  edge: Edge,
): boolean => {
  const retry = edge.policy?.retry;
  if (retry === undefined || retry.idempotency === 'declared') return false;
  if (edge.metadata['deduplicatesAtSink'] !== undefined) return false;
  const target = targetOf(context, edge);
  /*
   * A component with no effect class was never classified, which is not the same as one classified
   * `unknown`. `unknown` is the answer discovery gives when it read a write shaped operation and could not
   * tell; absent is the answer it gives when nothing asked. Reading the second as the first reported a
   * polled HTTP read as an operation that might not be safe to repeat, because the enclosing function it
   * named was an inferred entry point that no classifier had ever looked at.
   */
  if (target?.sideEffect === undefined) return false;
  return RETRY_UNSAFE_EFFECTS.includes(target.sideEffect);
};

/**
 * What discovery saw one frame into the operation, when it saw anything.
 *
 * Both retry rules assert an absence: no key, no ceiling. An assertion of absence is only worth making by
 * something that looked, and until now neither did. Where the sink shows a deduplicating statement or a
 * declared attempt bound, the rule says nothing rather than saying the opposite: the evidence is not proof
 * that the retry honours either one, and a rule that cannot tell must not pick the accusing answer.
 */
const sinkShowed = (
  edge: Edge,
  key: 'deduplicatesAtSink' | 'attemptCeiling',
): string | undefined => {
  const value = edge.metadata[key];
  return typeof value === 'string' ? value : undefined;
};

export const unsafeRetryRule: Rule = {
  id: 'retry-around-non-idempotent-operation',
  category: 'reliability',
  summary: 'A retry wrapped around an operation whose idempotency was not established.',
  evaluate: (context) => {
    const drafts: FindingDraft[] = [];
    const unassertable: string[] = [];
    for (const edge of context.graph.graph.edges) {
      const retry = edge.policy?.retry;
      if (retry === undefined) continue;
      const deduplicates = sinkShowed(edge, 'deduplicatesAtSink');
      if (deduplicates !== undefined) {
        unassertable.push(deduplicates);
        continue;
      }
      if (!retryIsUnsafe(context, edge)) continue;
      const target = targetOf(context, edge);
      if (target === undefined) continue;
      const effect = target.sideEffect ?? 'unknown';

      const source = context.graph.component(edge.from);
      const record = derivedEvidence({
        producer: PRODUCER,
        rule: 'retry-around-non-idempotent-operation',
        inputs: edge.evidence as EvidenceId[],
        note: `retry ${retry.bounded ? `bounded at ${retry.maxAttempts ?? 'unknown'} attempts` : 'with no attempt ceiling'} around an operation classified ${effect} with idempotency ${retry.idempotency}`,
      });
      drafts.push({
        ruleId: 'retry-around-non-idempotent-operation',
        occurrence: {
          key: 'unsafe-retry',
          groupedTitle: '{count} operations are retried and nothing makes them safe to repeat',
        },
        category: 'reliability',
        polarity: 'risk',
        severity: effect === 'unknown' ? 'medium' : 'high',
        confidence:
          effect === 'unknown' ? CONFIDENCE_BANDS.structural : CONFIDENCE_BANDS.strongStructural,
        basis: 'discovered',
        /*
         * "Idempotent" is the precise word and it is a word a reader has to already know. The
         * remediation this rule writes has always said "safe to repeat", so the title says it too and
         * the finding speaks one language to the person who reads it and the agent that acts on it.
         */
        title: `${target.displayName} is retried and nothing makes it safe to repeat`,
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
      unassertable.length === 0
        ? drafts.length === 0
          ? 'no retry was found in front of an operation whose repeat could not be ruled out'
          : undefined
        : `${formatCount(unassertable.length, 'retry')} was left unreported because the operation it calls deduplicates its own effect: ${[...new Set(unassertable)].join(', ')}`,
    );
  },
};

export const unboundedRetryRule: Rule = {
  id: 'unbounded-retry',
  category: 'reliability',
  summary: 'A retry with no attempt ceiling.',
  evaluate: (context) => {
    const drafts: FindingDraft[] = [];
    const unassertable: string[] = [];
    let leftToTheOtherRule = 0;
    for (const edge of context.graph.graph.edges) {
      const retry = edge.policy?.retry;
      if (retry === undefined || retry.bounded) continue;
      /*
       * One call site, one finding. `retry-around-non-idempotent-operation` already reports this edge, at a
       * higher severity, and its remediation covers the ceiling as well: attach a key or remove the retry.
       * Reporting the same location twice with two titles reads as two problems and is one.
       */
      if (retryIsUnsafe(context, edge)) {
        leftToTheOtherRule += 1;
        continue;
      }
      const bounded = sinkShowed(edge, 'attemptCeiling');
      if (bounded !== undefined) {
        unassertable.push(bounded);
        continue;
      }
      const target = context.graph.component(edge.to);
      const source = context.graph.component(edge.from);
      drafts.push({
        ruleId: 'unbounded-retry',
        occurrence: {
          key: 'unbounded-retry',
          groupedTitle: '{count} retries have no attempt ceiling',
        },
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
    const notes = [
      leftToTheOtherRule === 0
        ? undefined
        : `${formatCount(leftToTheOtherRule, 'unbounded retry')} sits in front of an operation whose repeat cannot be ruled out, which retry-around-non-idempotent-operation reports instead`,
      unassertable.length === 0
        ? undefined
        : `${formatCount(unassertable.length, 'retry')} was left unreported because the operation it calls declares its own ceiling: ${[...new Set(unassertable)].join(', ')}`,
      drafts.length === 0 && leftToTheOtherRule === 0 && unassertable.length === 0
        ? 'every discovered retry had an attempt ceiling'
        : undefined,
    ].filter((note): note is string => note !== undefined);
    return fired(drafts, notes.length === 0 ? undefined : notes.join('; '));
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
          explanation: `All ${formatCount(modelEdges.length, 'model call')} carry an explicit timeout, so a hung provider cannot stall a run indefinitely.`,
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
        occurrence: {
          key: 'no-timeout',
          groupedTitle: '{count} models are called with no timeout declared',
        },
        category: 'reliability' as const,
        polarity: 'risk' as const,
        severity: 'medium' as const,
        confidence: CONFIDENCE_BANDS.structural,
        basis: 'discovered' as const,
        title: `Model call to ${target?.displayName ?? modelId} declares no timeout`,
        explanation: `No timeout was found in the configuration of ${formatCount(edges.length, 'call')} reaching this model, from ${formatCount(callers.length, 'caller')}. A provider that stops responding will hold the request until something else gives up, and nothing in the declared configuration says when that is.`,
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
          occurrence: {
            key: 'approved',
            groupedTitle: '{count} consequential operations are behind an approval boundary',
          },
          severity: 'info',
          confidence: CONFIDENCE_BANDS.strongStructural,
          basis: 'discovered',
          title: `${component.displayName} is behind an approval boundary`,
          explanation: `${component.displayName} has effect class ${component.sideEffect} and is guarded: ${guarded ? 'an approval gate was discovered' : requiresApproval ? 'the tool declares that approval is required' : 'the calling policy declares that approval is required'}.`,
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
        searched: `an approval gate or approval requirement on ${component.id}`,
        scope: 'the declared graph',
        inspectedCount: incoming.length,
      });
      drafts.push({
        ruleId: 'side-effect-approval-boundary',
        category: 'security',
        polarity: 'risk',
        occurrence: {
          key: 'unapproved',
          groupedTitle: '{count} consequential operations have no approval boundary',
        },
        severity: component.sideEffect === 'financial' ? 'high' : 'medium',
        confidence: CONFIDENCE_BANDS.structural,
        basis: 'discovered',
        title: `${component.displayName} performs a ${component.sideEffect} effect with no approval boundary`,
        explanation: `${component.displayName} was classified ${component.sideEffect} and no approval gate, tool approval requirement or calling policy requiring approval was found. A model deciding on its own to invoke this operation is the whole risk.`,
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
      occurrence: {
        key: 'interpolated-prompt',
        groupedTitle: '{count} prompts interpolate run time content',
      },
      category: 'security' as const,
      polarity: 'risk' as const,
      severity: 'medium' as const,
      confidence: CONFIDENCE_BANDS.heuristic,
      basis: 'inferred' as const,
      title: `${prompt.displayName} interpolates run time content into a prompt`,
      explanation: `This prompt contains substitution points, and the system also reads content from ${formatCount(untrustedSources.length, 'source')} that Orchescope cannot vouch for: retrieval results, tool results and MCP server output. Whether a substituted value comes from one of those sources cannot be established from syntax alone, so this is a boundary to review rather than a proven vulnerability.`,
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

/**
 * Components that participate in the declared control flow of the system under audit.
 *
 * Two exclusions, for two different reasons. A prompt, a model or a provider is reached by being
 * referenced rather than by being called, so listing them would be noise that buries the finding a reader
 * needs. And a server named only in a developer's own editor configuration is not part of this system at
 * all: nothing in the repository reaches it, that is correct, and reporting it as a defect files a
 * finding against the wrong party.
 */
const REACHABILITY_KINDS: ReadonlySet<string> = new Set([
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

const participatesInTopology = (component: Component): boolean =>
  component.presence.static &&
  REACHABILITY_KINDS.has(component.kind) &&
  partOfAuditedSystem(component);

const unreachableDrafts = (graph: IndexedGraph): readonly FindingDraft[] => {
  const candidates = graph.graph.components.filter(participatesInTopology);
  const unreachable = unreachableComponents(graph).filter(participatesInTopology);
  return unreachable.map((component) => ({
    ruleId: 'topology-shape',
    category: 'architecture',
    polarity: 'risk',
    severity: 'low',
    confidence: CONFIDENCE_BANDS.structural,
    occurrence: {
      key: 'unreachable',
      groupedTitle: '{count} components cannot be reached from any declared entry point',
    },
    basis: 'discovered',
    title: `${component.displayName} cannot be reached from any entry point`,
    explanation: `No entry point declared in this repository reaches ${component.id} through control flow. That has three causes and this rule cannot tell them apart: the wiring is missing, the component is left over, or the entry point is outside this repository, which is what a library looks like. ${unreachable.length} of the ${candidates.length} components that participate in control flow are in this state.`,
    impact:
      'A component the declared graph cannot reach is one a reader cannot follow, and it is where dead configuration hides.',
    components: [component.id],
    metrics: [
      {
        name: 'unreachableComponents',
        value: unreachable.length,
        unit: 'component',
        sampleSize: candidates.length,
        basis: 'discovered' as const,
      },
    ],
    evidence: component.evidence.slice(0, 2) as EvidenceId[],
    goalEligible: false,
    goalReason: 'Deleting or wiring a component is a decision for the owner.',
    tags: ['unreachable'],
  }));
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
        occurrence: {
          key: 'wide-fan-out',
          groupedTitle: '{count} agents each coordinate eight or more downstream operations',
        },
        polarity: 'risk',
        severity: 'low',
        confidence: CONFIDENCE_BANDS.deterministic,
        basis: 'discovered',
        title: `${component.displayName} coordinates ${entry.controlFlowOutDegree} downstream operations`,
        explanation: `This agent has ${formatCount(entry.controlFlowOutDegree, 'outgoing control flow path')}. Wide coordination is not wrong on its own, and it does make the agent's prompt, its failure handling and its token cost harder to reason about.`,
        impact: 'Every added branch multiplies the paths that have to be tested.',
        components: [component.id],
        evidence: component.evidence.slice(0, 2) as EvidenceId[],
        goalEligible: false,
        goalReason: 'Splitting an orchestrator is a design decision, not a bounded edit.',
        tags: ['complexity'],
      });
    }

    drafts.push(...unreachableDrafts(context.graph));

    const cycles = controlFlowCycles(context.graph);
    for (const cycle of cycles.slice(0, 5)) {
      drafts.push({
        ruleId: 'topology-shape',
        category: 'architecture',
        polarity: 'risk',
        severity: 'low',
        confidence: CONFIDENCE_BANDS.deterministic,
        occurrence: {
          key: 'cycle',
          groupedTitle: '{count} cycles were found in the declared control flow',
        },
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

    /**
     * A strength has to be about something.
     *
     * "Reachable, acyclic and narrow" is true of a graph with no relations in it, and of a repository where the
     * only components are the databases and services some code happens to touch. Reporting it there reads as an
     * endorsement of an agent system that was never found, so the claim requires an agent and a relation between
     * components before it is made.
     */
    const hasAgent = context.graph.graph.components.some(
      (component) => component.kind === 'agent' || component.kind === 'agent_group',
    );
    if (drafts.length === 0 && hasAgent && context.graph.graph.edges.length > 0) {
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
    if (context.observedRuns.length === 0) {
      return {
        status: 'insufficient_evidence',
        detail:
          'permission breadth is only meaningful against observed use, and no run has been recorded',
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
        scope: formatCount(context.observedRuns.length, 'observed run'),
        inspectedCount: context.observedRuns.length,
      });
      drafts.push({
        ruleId: 'permissions-broader-than-observed-use',
        occurrence: {
          key: 'unused-write',
          groupedTitle: '{count} components hold write access they were not observed using',
        },
        category: 'permissions',
        polarity: 'risk',
        severity: 'low',
        confidence: CONFIDENCE_BANDS.structural,
        basis: 'inferred',
        title: `${component.displayName} holds write access it was not observed using`,
        explanation: `${component.displayName} declares ${formatCount(writePermissions.length, 'write permission')} on ${writePermissions.map((permission) => permission.scope).join(', ')}, ran in ${formatCount(context.observedRuns.length, 'observed run')}, and performed no recorded side effect. Observed use is not proof that write access is unnecessary, and it is the evidence available.`,
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
      occurrence: {
        key: 'no-caller',
        groupedTitle: '{count} tools are defined and nothing in this repository calls them',
      },
      category: 'maintainability' as const,
      polarity: 'risk' as const,
      severity: 'low' as const,
      confidence: CONFIDENCE_BANDS.structural,
      basis: 'discovered' as const,
      title: `${tool.displayName} is defined and nothing calls it`,
      explanation: `${tool.displayName} was discovered as a tool and no agent, group or server in this repository points at it. That has three causes and this rule cannot tell them apart: the wiring is missing, the tool is left over from a change, or the caller is somewhere Orchescope did not read, which is what a tool list assembled at run time and a library exporting tools for an application elsewhere both look like. ${orphans.length} of the ${tools.length} discovered tools are in this state.`,
      impact: 'A tool nobody calls still has to be maintained, and it may still hold credentials.',
      components: [tool.id],
      metrics: [
        {
          name: 'toolsWithoutCaller',
          value: orphans.length,
          unit: 'tool',
          sampleSize: tools.length,
          basis: 'discovered' as const,
        },
      ],
      evidence: tool.evidence.slice(0, 2) as EvidenceId[],
      goalEligible: false,
      goalReason: 'Wiring or deleting a tool is a decision for the owner.',
      tags: ['dead-configuration'],
    }));
    return fired(drafts);
  },
};

/**
 * The opposite shape of `retry-around-non-idempotent-operation`, reported for the same reason.
 *
 * A bounded retry with a declared idempotency key is what a correct retry looks like. Reporting it matters because a reader
 * who has just been shown the unsafe case needs to see the intended pattern, in their own repository, with the location of
 * the relation that already gets it right.
 */
export const safeRetryRule: Rule = {
  id: 'bounded-retry-with-declared-idempotency',
  category: 'reliability',
  summary: 'A retry that is bounded and whose operation declares an idempotency key.',
  evaluate: (context) => {
    const safe = context.graph.graph.edges.filter((edge) => {
      const retry = edge.policy?.retry;
      return retry?.bounded === true && retry.idempotency === 'declared';
    });
    if (safe.length === 0) {
      return context.graph.graph.edges.some((edge) => edge.policy?.retry !== undefined)
        ? clear('no retry declares both a ceiling and an idempotency key')
        : notApplicable('no retry policy was discovered');
    }

    return fired(
      safe.map((edge) => {
        const target = context.graph.component(edge.to);
        const source = context.graph.component(edge.from);
        const retry = edge.policy?.retry;
        return {
          ruleId: 'bounded-retry-with-declared-idempotency',
          occurrence: {
            key: 'safe-retry',
            groupedTitle: '{count} retries are bounded and safe to repeat',
          },
          category: 'reliability' as const,
          polarity: 'strength' as const,
          severity: 'info' as const,
          confidence: CONFIDENCE_BANDS.strongStructural,
          basis: 'discovered' as const,
          /* The risk this rule is the mirror of says "safe to repeat", so the strength says it too. */
          title: `${target?.displayName ?? edge.to} is retried a bounded number of times and is safe to repeat`,
          explanation: `${source?.displayName ?? edge.from} retries ${target?.displayName ?? edge.to} at most ${retry?.maxAttempts ?? 'a declared number of'} times with ${retry?.backoff ?? 'unknown'} backoff, and the operation declares an idempotency key. A repeat of the same attempt cannot produce the effect twice.`,
          impact:
            'This retry recovers from a transient failure without the risk that makes an unkeyed retry dangerous.',
          components: [edge.to, edge.from],
          edges: [edge.id],
          evidence: edge.evidence.slice(0, 3) as EvidenceId[],
          goalEligible: false,
          goalReason: 'Nothing to change.',
          tags: ['positive', 'retry', 'idempotency'],
        };
      }),
    );
  },
};

export const STATIC_RULES: readonly Rule[] = [
  unsafeRetryRule,
  safeRetryRule,
  unboundedRetryRule,
  missingTimeoutRule,
  approvalBoundaryRule,
  promptInjectionBoundaryRule,
  architectureShapeRule,
  broadPermissionRule,
  unusedConfiguredToolRule,
];
