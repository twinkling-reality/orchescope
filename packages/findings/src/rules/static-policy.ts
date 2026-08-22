import {
  absenceEvidence,
  agree,
  CONFIDENCE_BANDS,
  derivedEvidence,
  formatCount,
  partOfAuditedSystem,
} from '@orchescope/domain';
import {
  controlFlowCycleEdges,
  controlFlowCycles,
  declaredCallersOf,
  degrees,
  type IndexedGraph,
  isControlFlowKind,
  operationsPerformedBy,
  reachableFrom,
  topologyRequirements,
  unreachableComponents,
} from '@orchescope/graph';
import type { Component, ComponentId, Edge, EvidenceId, SideEffectClass } from '@orchescope/schema';
import {
  auditedComponents,
  auditedComponentsOfKind,
  auditedEdges,
  auditedEdgesOfKind,
  declaredInTestCount,
  narrowedAway,
} from './audited-population.ts';
import type { RemediationVariants } from './remediation-variant.ts';
import {
  examined,
  type FindingDraft,
  fired,
  insufficient,
  notApplicable,
  nothingObserved,
  type Rule,
  type RuleContext,
} from '../rule.ts';

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

/**
 * The operation a retry is actually wrapped around.
 *
 * A retry relation ends where the author wrote it, which is often a helper rather than the request the
 * helper makes. That helper is a frame discovery invented to hold the effect, so the graph is asked what
 * the frame performs and the answer is the operation. Both retry rules and the finding they write use
 * this, so a reader is told the POST that repeats rather than the name of the function around it.
 */
const retriedOperationOf = (context: RuleContext, edge: Edge): Component | undefined => {
  const operations = operationsPerformedBy(context.graph, edge.to);
  return (
    operations.find(
      (operation) =>
        operation.sideEffect !== undefined && RETRY_UNSAFE_EFFECTS.includes(operation.sideEffect),
    ) ?? operations[0]
  );
};

/**
 * The class of the operation this retry repeats.
 *
 * The relation is asked before the component, because a component can stand for more than one call. A
 * function that posts a job and then polls its status builds both addresses at run time, so both
 * requests are one component named for that function; asking that component whether the polled read is
 * safe to repeat answers with the class of the POST, and the finding names a write the loop never makes.
 * Discovery knows which call the loop re-attempts, so where the relation says, the relation wins.
 */
const retriedEffectOf = (context: RuleContext, edge: Edge): SideEffectClass | undefined => {
  const stated = edge.metadata['retriedEffect'];
  if (typeof stated === 'string') return stated as SideEffectClass;
  return retriedOperationOf(context, edge)?.sideEffect;
};

/**
 * Whether this retry sits in front of an operation whose repeat cannot be ruled out.
 *
 * Shared by the two retry rules so that one cannot start reporting a call site the other has stopped
 * reporting. In all three repositories where both fired across a thirty six repository sweep, their
 * components and source locations were byte identical: from the outside it read as one problem counted
 * twice, and it doubled the medium severity count wherever it happened.
 */
const retryIsUnsafe = (context: RuleContext, edge: Edge): boolean => {
  const retry = edge.policy?.retry;
  if (retry === undefined || retry.idempotency === 'declared') return false;
  if (edge.metadata['deduplicatesAtSink'] !== undefined) return false;
  const effect = retriedEffectOf(context, edge);
  /*
   * A component with no effect class was never classified, which is not the same as one classified
   * `unknown`. `unknown` is the answer discovery gives when it read a write shaped operation and could not
   * tell; absent is the answer it gives when nothing asked. Reading the second as the first reported a
   * polled HTTP read as an operation that might not be safe to repeat, because the enclosing function it
   * named was an inferred entry point that no classifier had ever looked at.
   *
   * The guard stands and the question in front of it changed. Asked about the frame it was answered
   * `undefined` every time, so it refused on every input a field run ever gave it, and the write one hop
   * further was classified all along.
   */
  if (effect === undefined) return false;
  return RETRY_UNSAFE_EFFECTS.includes(effect);
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

/** What makes an operation safe to repeat, which is the only thing that makes the retry in front of it safe. */
export const UNSAFE_RETRY_REMEDIATIONS = {
  'no-idempotency-key': (subject: string) => ({
    summary: `Attach an idempotency key to ${subject}, or remove the retry.`,
    steps: [
      'Derive a key from the request fields that define the operation, not from a timestamp.',
      'Send the key on every attempt including the first.',
      'Run the chaos scenario that injects a tool timeout and confirm a single effect.',
    ],
    effort: 'small' as const,
    risk: 'medium' as const,
  }),
} satisfies RemediationVariants;

export const unsafeRetryRule: Rule = {
  id: 'retry-around-non-idempotent-operation',
  remediations: UNSAFE_RETRY_REMEDIATIONS,
  category: 'reliability',
  summary: 'A retry wrapped around an operation whose idempotency was not established.',
  evaluate: (context) => {
    const drafts: FindingDraft[] = [];
    const unassertable: string[] = [];
    let retries = 0;
    for (const edge of auditedEdges(context.graph)) {
      const retry = edge.policy?.retry;
      if (retry === undefined) continue;
      retries += 1;
      const deduplicates = sinkShowed(edge, 'deduplicatesAtSink');
      if (deduplicates !== undefined) {
        unassertable.push(deduplicates);
        continue;
      }
      if (!retryIsUnsafe(context, edge)) continue;
      const target = retriedOperationOf(context, edge);
      if (target === undefined) continue;
      // The class the rule judged on, so the sentence a reader checks is the one that decided.
      const effect = retriedEffectOf(context, edge) ?? 'unknown';

      const source = context.graph.component(edge.from);
      const record = derivedEvidence({
        producer: PRODUCER,
        rule: 'retry-around-non-idempotent-operation',
        inputs: edge.evidence as EvidenceId[],
        note: `retry ${retry.bounded ? `bounded at ${retry.maxAttempts ?? 'unknown'} attempts` : 'with no attempt ceiling'} around an operation classified ${effect} with idempotency ${retry.idempotency}`,
      });
      drafts.push({
        ruleId: 'retry-around-non-idempotent-operation',
        situation: effect === 'unknown' ? 'retry-with-unknown-repeat-safety' : 'unsafe-retry',
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
        recommendation: UNSAFE_RETRY_REMEDIATIONS['no-idempotency-key'](target.displayName),
        remediationVariant: 'no-idempotency-key',
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
    return examined(
      drafts,
      { count: retries, singular: 'retry', plural: 'retries' },
      unassertable.length === 0
        ? drafts.length === 0
          ? 'no retry was found in front of an operation whose repeat could not be ruled out'
          : undefined
        : `${formatCount(unassertable.length, 'retry', 'retries')} ${agree(unassertable.length, 'was', 'were')} left unreported because the operation it calls deduplicates its own effect: ${[...new Set(unassertable)].join(', ')}`,
    );
  },
};

/**
 * How this retry was recognised, in the words of what was read.
 *
 * The sentence said "a loop with a catch" whatever the relation came from. That was already untrue of an
 * explicit retry helper, which has no loop, and it became untrue of a loop that reads the response
 * rather than catching. A reader who goes to the line and finds no catch has been told something they
 * can check and that is wrong, in the one place the tool is asking to be trusted.
 */
const retryWasReadAs = (edge: Edge): string => {
  /*
   * A retry a library declares says what it is outright, and neither of the other two sentences fits it:
   * a decorated function has no loop and no helper call, and describing one as "a loop where" would send
   * a reader to a line that holds neither.
   */
  const declaration = edge.metadata['retryDeclaration'];
  if (typeof declaration === 'string') return declaration;
  const helper = edge.metadata['retryHelper'];
  if (typeof helper === 'string') return `a call to ${helper}`;
  const evidence = edge.metadata['reattemptEvidence'];
  return typeof evidence === 'string' ? `a loop where ${evidence}` : 'a retry';
};

/** The ceiling and the pause between attempts, which are one change at the call site that wrote the loop. */
export const UNBOUNDED_RETRY_REMEDIATIONS = {
  'no-attempt-ceiling': () => ({
    summary: 'Give the retry an explicit maximum attempt count and a backoff.',
    steps: [
      'Set a maximum attempt count at the call site.',
      'Add a bounded backoff so repeated failures do not hammer the dependency.',
    ],
    effort: 'small' as const,
    risk: 'low' as const,
  }),
} satisfies RemediationVariants;

export const unboundedRetryRule: Rule = {
  id: 'unbounded-retry',
  remediations: UNBOUNDED_RETRY_REMEDIATIONS,
  category: 'reliability',
  summary: 'A retry with no attempt ceiling.',
  evaluate: (context) => {
    const drafts: FindingDraft[] = [];
    const unassertable: string[] = [];
    let leftToTheOtherRule = 0;
    /*
     * Every discovered retry, not only the ones with no ceiling. The population is what the rule looked
     * at, and a bounded retry is a retry this rule read and passed.
     */
    let retries = 0;
    for (const edge of auditedEdges(context.graph)) {
      const retry = edge.policy?.retry;
      if (retry === undefined) continue;
      retries += 1;
      if (retry.bounded) continue;
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
      const target = retriedOperationOf(context, edge) ?? context.graph.component(edge.to);
      const source = context.graph.component(edge.from);
      drafts.push({
        ruleId: 'unbounded-retry',
        situation: 'retry-without-attempt-ceiling',
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
        explanation: `The retry around ${target?.displayName ?? edge.to} was discovered as ${retryWasReadAs(edge)}, and no attempt limit could be established from the source. An unbounded retry converts a persistent downstream failure into unbounded cost and an unbounded wait.`,
        impact:
          'A failing dependency can consume the whole budget of a run and never surface an error.',
        components: [
          ...(target === undefined ? [] : [target.id]),
          ...(source === undefined ? [] : [source.id]),
        ],
        edges: [edge.id],
        evidence: edge.evidence as EvidenceId[],
        recommendation: UNBOUNDED_RETRY_REMEDIATIONS['no-attempt-ceiling'](),
        remediationVariant: 'no-attempt-ceiling',
        goalEligible: true,
        goalReason: 'A bounded change at one call site with a static check.',
        tags: ['retry'],
      });
    }
    const notes = [
      leftToTheOtherRule === 0
        ? undefined
        : `${formatCount(leftToTheOtherRule, 'unbounded retry', 'unbounded retries')} ${agree(leftToTheOtherRule, 'sits', 'sit')} in front of an operation whose repeat cannot be ruled out, which retry-around-non-idempotent-operation reports instead`,
      unassertable.length === 0
        ? undefined
        : `${formatCount(unassertable.length, 'retry', 'retries')} ${agree(unassertable.length, 'was', 'were')} left unreported because the operation it calls declares its own ceiling: ${[...new Set(unassertable)].join(', ')}`,
      retries > 0 && drafts.length === 0 && leftToTheOtherRule === 0 && unassertable.length === 0
        ? 'every discovered retry had an attempt ceiling'
        : undefined,
    ].filter((note): note is string => note !== undefined);
    return examined(
      drafts,
      { count: retries, singular: 'retry', plural: 'retries' },
      notes.length === 0 ? undefined : notes.join('; '),
    );
  },
};

/**
 * Where the deadlines a set of relations carry were written.
 *
 * The two cover different populations and a reader acting on this needs to know which they have: a
 * timeout on the client governs every call made through it, so one line covers work nobody has written
 * yet, while a timeout on a call governs that call and leaves its neighbours undefended. Absent where
 * the relation came from a manifest, which states the number and not where the code says it.
 */
const deadlineOrigins = (edges: readonly Edge[]): string | undefined => {
  const declaredAt = (place: string): number =>
    edges.filter((edge) => edge.metadata['timeoutDeclaredAt'] === place).length;
  const parts = [
    { count: declaredAt('call site'), where: 'at the call site' },
    { count: declaredAt('client'), where: 'at the client' },
    { count: declaredAt('request'), where: 'on the request' },
  ]
    .filter((part) => part.count > 0)
    .map((part) => `${part.count} ${part.where}`);
  return parts.length === 0 ? undefined : parts.join(' and ');
};

/**
 * Whether a relation declares a deadline, which is a different question from whether its number was read.
 *
 * `AbortSignal.timeout(REQUEST_TIMEOUT_MS)` states a deadline and settles no number, and a rule filtering
 * on the number alone reports that repository as declaring none. That is an accusation resting on the
 * author having named a constant. The number is what reconciliation needs to contradict an observation;
 * the declaration is what this rule is about, and they are read separately.
 */
const declaresDeadline = (edge: Edge): boolean =>
  edge.policy?.timeoutMs !== undefined || edge.metadata['timeoutDeclaredAt'] !== undefined;

/**
 * The remediation has to name something the reader has, in the language they are writing.
 *
 * A model behind a published package is configured at its client, and one reached by a plain request has
 * no client at all. Telling the second reader to set a timeout at the client names a thing that does not
 * exist in the file the finding points at, and the goal cut from it asks an agent to change something it
 * cannot find inside the only scope it is allowed to touch.
 *
 * The two requests then divide again, because the ecosystems do not share a spelling. `fetch` takes no
 * timeout argument at all and states its deadline as a signal that expires; Python's clients take a
 * `timeout` keyword and have no signal to pass. One sentence covering both told a Python repository to
 * reach for an abort signal, which is not a thing it can do.
 *
 * How the model was reached and what language reached it are both recorded at discovery, so the answer is
 * read rather than assumed. A scan that carries no language falls to the signal, since every client this
 * build reads a request through other than Python's is one that takes one.
 */
export const TIMEOUT_REMEDIATIONS = {
  client: () => ({
    summary: 'Set an explicit request timeout on the model client or the call site.',
    steps: [
      'Choose a timeout from the observed p95 latency plus headroom.',
      'Set it at the client.',
    ],
    effort: 'small' as const,
    risk: 'low' as const,
  }),
  'request-abort-signal': () => ({
    summary: 'Give the request a deadline, since there is no client to configure.',
    steps: [
      'Choose a timeout from the observed p95 latency plus headroom.',
      'Pass an abort signal that expires after it, built with AbortSignal.timeout so the deadline is stated where the request is.',
    ],
    effort: 'small' as const,
    risk: 'low' as const,
  }),
  'request-timeout-argument': () => ({
    summary: 'Give the request a deadline, since there is no client to configure.',
    steps: [
      'Choose a timeout from the observed p95 latency plus headroom.',
      'Pass it as the timeout argument of the request itself, which is where this ecosystem states a deadline.',
    ],
    effort: 'small' as const,
    risk: 'low' as const,
  }),
} satisfies RemediationVariants;

const timeoutVariantFor = (target: Component | undefined): keyof typeof TIMEOUT_REMEDIATIONS => {
  if (target?.metadata['reachedOver'] !== 'http') return 'client';
  return target.metadata['language'] === 'python'
    ? 'request-timeout-argument'
    : 'request-abort-signal';
};

export const missingTimeoutRule: Rule = {
  id: 'model-call-without-timeout',
  remediations: TIMEOUT_REMEDIATIONS,
  category: 'reliability',
  summary: 'A model invocation with no timeout in the declared configuration.',
  evaluate: (context) => {
    const discovered = context.graph.edgesOfKind('invokes_model');
    const modelEdges = auditedEdgesOfKind(context.graph, 'invokes_model');
    if (modelEdges.length === 0) {
      const narrowed = narrowedAway(discovered, 'model invocation');
      return notApplicable(
        narrowed === undefined
          ? 'no model invocation was discovered'
          : `${narrowed}, so nothing was examined`,
      );
    }
    const missing = modelEdges.filter((edge) => !declaresDeadline(edge));
    if (missing.length === 0) {
      const evidence = modelEdges.flatMap((edge) => edge.evidence.slice(0, 1)) as EvidenceId[];
      const origins = deadlineOrigins(modelEdges);
      return fired([
        {
          ruleId: 'model-call-without-timeout',
          situation: 'all-model-calls-declare-timeout',
          wholeSystemSubject: 'all-model-invocations',
          category: 'reliability',
          polarity: 'strength',
          severity: 'info',
          confidence: CONFIDENCE_BANDS.strongStructural,
          basis: 'discovered',
          title: 'Every discovered model invocation declares a timeout',
          explanation: `All ${formatCount(modelEdges.length, 'model call')} ${agree(modelEdges.length, 'carries', 'carry')} an explicit timeout${origins === undefined ? '' : `, ${origins}`}, so a hung provider cannot stall a run indefinitely.`,
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
        situation: 'model-call-without-timeout',
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
        recommendation: TIMEOUT_REMEDIATIONS[timeoutVariantFor(target)](),
        remediationVariant: timeoutVariantFor(target),
        goalEligible: true,
        goalReason: 'One configuration value with a static check.',
        tags: ['timeout'],
      };
    });
    return examined(drafts, { count: modelEdges.length, singular: 'model invocation' });
  },
};

/**
 * Components a model can reach, which is the population this rule is about.
 *
 * The risk it names is a model deciding on its own to invoke a consequential operation. An operation no
 * model can reach is not that risk, however consequential it is, and reporting it as one files a finding
 * against the wrong thing: across the pinned corpus the operations this used to raise included four React
 * components issuing `DELETE` behind a user's click, a continuous integration script posting to GitHub,
 * and a sandbox event sink. Each is a real write and none of them is an agent doing anything.
 *
 * An agent, an agent group and an MCP server are roots because a model drives them. A tool is a root in
 * its own right: a tool exists to be called by a model, whether or not this repository has wired one to
 * it yet, and a declared tool nobody has connected is the subject of a different rule.
 */
/**
 * Whether every declared caller that reaches this operation has to be approved first.
 *
 * The remediation this rule prints says to mark the tool as needing approval, and the operation the
 * finding names is usually not the tool: it is the write the tool performs, one frame further in. Asked
 * of the write alone, an approval declared on the tool answers nothing, so an operator who did exactly
 * what the finding asked got the same finding back on the next scan, which is the loop failure this
 * product exists to close.
 *
 * Every caller rather than any, because the risk is a model reaching this operation without a decision.
 * A second tool that reaches the same write and declares no approval is that risk in full, whatever the
 * first one declares. Nothing declared reaching it is not an approval either.
 */
const approvedCallersOf = (context: RuleContext, component: Component): boolean => {
  const callers = declaredCallersOf(context.graph, component.id);
  return (
    callers.length > 0 &&
    callers.every(
      (caller) => caller.details?.for === 'tool' && caller.details.approvalRequired === true,
    )
  );
};

const MODEL_DRIVEN_KINDS: readonly string[] = ['agent', 'agent_group', 'mcp_server', 'tool'];

const modelReachable = (graph: IndexedGraph): ReadonlySet<string> =>
  reachableFrom(
    graph,
    auditedComponents(graph)
      .filter((component) => MODEL_DRIVEN_KINDS.includes(component.kind))
      .map((component) => component.id),
  );

/**
 * The decision that has to happen before a consequential operation runs.
 *
 * It names the operation rather than the tool, because the tool is one frame away from the write and an
 * operator who marked the tool got the finding back. Either route closes it: the graph asks whether every
 * declared caller that reaches the operation requires approval.
 */
export const APPROVAL_REMEDIATIONS = {
  'no-approval-boundary': (subject: string) => ({
    summary: `Require an explicit approval before ${subject} executes.`,
    steps: [
      'Add an approval check at the call site, or mark the tool as needing approval in the framework.',
      'Record the approval decision on the span so the boundary is observable.',
    ],
    effort: 'medium' as const,
    risk: 'low' as const,
  }),
} satisfies RemediationVariants;

export const approvalBoundaryRule: Rule = {
  id: 'side-effect-approval-boundary',
  remediations: APPROVAL_REMEDIATIONS,
  category: 'security',
  summary: 'Whether an operation with an external effect is guarded by an approval boundary.',
  evaluate: (context) => {
    const consequential = auditedComponents(context.graph).filter(
      (component) =>
        component.sideEffect === 'financial' ||
        component.sideEffect === 'destructive' ||
        component.sideEffect === 'non_idempotent_write',
    );
    if (consequential.length === 0)
      return notApplicable('no operation with a risky effect class was discovered');

    const reachable = modelReachable(context.graph);
    const risky = consequential.filter((component) => reachable.has(component.id));
    const unreached = consequential.length - risky.length;
    /*
     * Named rather than dropped. An operation this declines to report is one it looked at and decided was
     * out of scope, and a reader who cannot see that has been told less than was known.
     *
     * What it declines over is the graph, not the repository. Reachability is computed across what this
     * scan discovered, so on a repository whose agent runtime no adapter here claims, the sentence said
     * that nothing in the repository reaches these operations while the repository wired tool calls, an
     * approval step and a registry that all do. The count is true of the graph and the sentence has to be
     * about the same thing.
     */
    const declined =
      unreached === 0
        ? undefined
        : `${formatCount(unreached, 'consequential operation')} ${agree(unreached, 'was', 'were')} left unreported because nothing this scan discovered as an agent, tool or MCP server reaches ${agree(unreached, 'it', 'them')}`;
    if (risky.length === 0) return notApplicable(declined ?? 'nothing reachable was consequential');

    const drafts: FindingDraft[] = [];
    for (const component of risky) {
      const guarded = context.graph
        .outgoing(component.id)
        .some((edge) => edge.kind === 'guarded_by');
      const requiresApproval =
        component.details?.for === 'tool' && component.details.approvalRequired === true;
      const incoming = context.graph.incoming(component.id);
      const guardedByPolicy = incoming.some((edge) => edge.policy?.requiresApproval === true);
      const behindApprovedCallers = approvedCallersOf(context, component);

      if (guarded || requiresApproval || guardedByPolicy || behindApprovedCallers) {
        drafts.push({
          ruleId: 'side-effect-approval-boundary',
          situation: 'consequential-operation-with-approval',
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
          explanation: `${component.displayName} has effect class ${component.sideEffect} and is guarded: ${guarded ? 'an approval gate was discovered' : requiresApproval ? 'the tool declares that approval is required' : guardedByPolicy ? 'the calling policy declares that approval is required' : 'every tool that reaches it declares that approval is required'}.`,
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
        situation: 'consequential-operation-without-approval',
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
        recommendation: APPROVAL_REMEDIATIONS['no-approval-boundary'](component.displayName),
        remediationVariant: 'no-approval-boundary',
        goalEligible: true,
        goalReason:
          'The scope is one call site plus a scenario that asserts the approval happened.',
        requiresHumanReview: true,
        tags: ['approval', 'side-effect'],
      });
    }
    return fired(drafts, declined);
  },
};

/** Keeping untrusted text out of the instruction, which is the only place the boundary can be drawn. */
export const PROMPT_INJECTION_REMEDIATIONS = {
  'interpolated-prompt': () => ({
    summary:
      'Separate untrusted content from instructions and constrain what the model may do with it.',
    steps: [
      'Pass retrieved or tool provided text as data in a clearly delimited section, never concatenated into the instruction.',
      'Restrict the tools available while untrusted content is in context.',
      'Add a scenario that injects an instruction into retrieved content and asserts the system does not follow it.',
    ],
    effort: 'medium' as const,
    risk: 'medium' as const,
  }),
} satisfies RemediationVariants;

export const promptInjectionBoundaryRule: Rule = {
  id: 'prompt-injection-boundary',
  remediations: PROMPT_INJECTION_REMEDIATIONS,
  category: 'security',
  summary: 'Places where content Orchescope cannot vouch for reaches a prompt.',
  evaluate: (context) => {
    const prompts = auditedComponentsOfKind(context.graph, 'prompt').filter(
      (component) =>
        component.details?.for === 'prompt' &&
        component.details.interpolatesUntrustedInput === true,
    );
    /*
     * Nothing to look at is not the same answer as nothing wrong. This said `clear` on a repository
     * where the adapter had built no prompt component at all, which reads as checked and fine, and the
     * limit that produced it is this build's rather than the repository's: a prompt assembled at a raw
     * SDK call site is not one this reads.
     */
    if (prompts.length === 0) {
      return notApplicable('no prompt was discovered that interpolates a value at run time');
    }

    const discoveredSources = [
      ...context.graph.componentsOfKind('retrieval'),
      ...context.graph.componentsOfKind('tool'),
      ...context.graph.componentsOfKind('mcp_server'),
    ];
    const untrustedSources = [
      ...auditedComponentsOfKind(context.graph, 'retrieval'),
      ...auditedComponentsOfKind(context.graph, 'tool'),
      ...auditedComponentsOfKind(context.graph, 'mcp_server'),
    ];
    /*
     * The second population, and the same defect the first one had.
     *
     * This rule joins two sets and it was reporting an all clear having looked in one of them. `clear`
     * says this was checked and was fine, and said over a source set nobody could look in, it answers a
     * security question that was never asked. A retrieval client no adapter in this build claims
     * produces exactly this emptiness: a retrieval application whose search results reach its prompt
     * four lines from where the prompt is built reads here as a repository that retrieves nothing.
     *
     * There is no `clear` left in this rule, which is right. Either both populations exist and every
     * interpolated prompt is a boundary to review, or one of them is empty and this looked at nothing.
     */
    if (untrustedSources.length === 0) {
      /*
       * The emptiness has two causes and they are not the same answer. A scope limit is this build not
       * claiming the client, and the sentence has said so since 0.5.0. A source set that exists and is
       * entirely fixtures is the repository saying something, and reporting it as nothing discovered would
       * be false: on `langgraph` all three sources are test fixtures, and this rule was firing on them.
       */
      const inTests = declaredInTestCount(discoveredSources);
      const only = `the only ${formatCount(discoveredSources.length, 'source')} discovered for one to carry`;
      const emptiness =
        discoveredSources.length === 0
          ? 'no retrieval, tool or server output was discovered for one to carry, so nothing was examined as a source; a retrieval client this build has no adapter for looks the same here as a repository that retrieves nothing'
          : inTests === discoveredSources.length
            ? `${only} ${agree(discoveredSources.length, 'is', 'are')} declared in a test file, so nothing the system itself reads was examined as a source`
            : `${only} ${agree(discoveredSources.length, 'does', 'do')} not belong to the system under audit, so nothing the system itself reads was examined as a source`;
      return notApplicable(
        `${formatCount(prompts.length, 'prompt')} ${agree(prompts.length, 'interpolates', 'interpolate')} a value and ${emptiness}`,
      );
    }

    const drafts: FindingDraft[] = prompts.map((prompt) => ({
      ruleId: 'prompt-injection-boundary',
      situation: 'runtime-content-interpolated-into-prompt',
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
      recommendation: PROMPT_INJECTION_REMEDIATIONS['interpolated-prompt'](),
      remediationVariant: 'interpolated-prompt',
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
    return examined(drafts, { count: prompts.length, singular: 'interpolated prompt' });
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

const unreachableDrafts = (
  graph: IndexedGraph,
  inspectedTopologyInputs: number,
  entryComponentIds: readonly ComponentId[],
): readonly FindingDraft[] => {
  const candidates = graph.graph.components.filter(participatesInTopology);
  const unreachable = unreachableComponents(graph, entryComponentIds).filter(
    participatesInTopology,
  );
  return unreachable.map((component) => {
    const population = absenceEvidence({
      producer: PRODUCER,
      searched: `a declared control-flow path from an accounted entry boundary to ${component.id}`,
      scope: 'the complete declared topology evidence population',
      inspectedCount: inspectedTopologyInputs,
    });
    return {
      ruleId: 'topology-shape',
      situation: 'component-unreachable-from-entrypoint',
      category: 'architecture',
      polarity: 'risk',
      severity: 'low',
      confidence: CONFIDENCE_BANDS.structural,
      occurrence: {
        key: 'unreachable',
        groupedTitle:
          '{count} components cannot be reached from an accounted declared entry boundary',
      },
      basis: 'discovered',
      title: `${component.displayName} cannot be reached from an accounted declared entry boundary`,
      explanation: `No accounted entry boundary reaches ${component.id} through the complete declared control-flow population. That has three repository causes and this rule cannot tell them apart: the wiring is missing, the component is left over, or the entry point is outside this repository, which is what a library looks like. ${unreachable.length} of the ${candidates.length} components that participate in control flow are in this state, over ${inspectedTopologyInputs} inspected topology inputs.`,
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
      newEvidence: [population],
      evidence: component.evidence.slice(0, 2) as EvidenceId[],
      goalEligible: false,
      goalReason: 'Deleting or wiring a component is a decision for the owner.',
      tags: ['unreachable'],
    };
  });
};

const cycleDrafts = (graph: IndexedGraph): readonly FindingDraft[] =>
  controlFlowCycles(graph)
    .slice(0, 5)
    .map((cycle) => {
      const cycleEdges = controlFlowCycleEdges(graph, cycle);
      const bound = cycleEdges
        .map((edge) => {
          const name = edge.metadata['conditionalBoundName'];
          const defaultValue = edge.metadata['conditionalBoundDefault'];
          const operator = edge.metadata['conditionalBoundOperator'];
          return typeof name === 'string' && typeof defaultValue === 'number'
            ? {
                name,
                defaultValue,
                operator: typeof operator === 'string' ? operator : undefined,
              }
            : undefined;
        })
        .find((entry) => entry !== undefined);
      return {
        ruleId: 'topology-shape',
        situation: 'declared-control-flow-cycle',
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
          bound === undefined
            ? 'These components form a cycle in the declared control flow. A cycle is a legitimate pattern for a plan and act loop. This scan attached no deterministic source-declared ceiling to the cycle.'
            : `These components form a cycle in the declared control flow. One conditional relation compares against ${bound.name}${bound.operator === undefined ? '' : ` with ${bound.operator}`}, whose source-declared static default is ${bound.defaultValue}. Runtime configuration can override that default, and this static scan did not observe which value a run selected.`,
        impact:
          bound === undefined
            ? 'Without evidence of a ceiling, the scan cannot establish a finite run bound.'
            : 'The cycle remains cyclic, and its run length depends on the runtime-selected configuration rather than on the static default alone.',
        components: [...new Set(cycle)],
        edges: cycleEdges.map((edge) => edge.id),
        evidence: [...new Set(cycleEdges.flatMap((edge) => edge.evidence))] as EvidenceId[],
        goalEligible: false,
        goalReason: 'Whether the cycle is intended is a question for the owner.',
        tags: ['cycle'],
      };
    });

export const architectureShapeRule: Rule = {
  id: 'topology-shape',
  category: 'architecture',
  summary: 'Fan out, reachability and cycles in the declared control flow.',
  evaluate: (context) => {
    const drafts: FindingDraft[] = [];
    const requirements = topologyRequirements(context.graph);
    const stats = degrees(context.graph);
    const highFanOut = stats.filter((entry) => entry.controlFlowOutDegree >= 8);
    for (const entry of highFanOut) {
      const component = context.graph.component(entry.componentId);
      if (component === undefined || component.kind !== 'agent') continue;
      drafts.push({
        ruleId: 'topology-shape',
        situation: 'agent-wide-control-flow-fanout',
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

    if (requirements.reachabilityComplete) {
      drafts.push(
        ...unreachableDrafts(
          context.graph,
          requirements.inspectedInputs,
          requirements.entryComponentIds,
        ),
      );
    }

    drafts.push(...cycleDrafts(context.graph));

    /**
     * A strength has to be about something.
     *
     * "Reachable, acyclic and narrow" is true of a graph with no relations in it, and of a repository where the
     * only components are the databases and services some code happens to touch. Reporting it there reads as an
     * endorsement of an agent system that was never found, so the claim requires an agent and a relation between
     * components before it is made.
     */
    const audited = auditedComponents(context.graph);
    const hasAgent = audited.some(
      (component) => component.kind === 'agent' || component.kind === 'agent_group',
    );
    if (
      drafts.length === 0 &&
      hasAgent &&
      auditedEdges(context.graph).length > 0 &&
      requirements.acyclicityComplete &&
      requirements.reachabilityComplete &&
      requirements.narrownessComplete
    ) {
      const population = absenceEvidence({
        producer: PRODUCER,
        searched:
          'an unreachable control-flow participant, declared control-flow cycle, or wide agent fan-out',
        scope:
          'all applicable relation producers, conditional destinations and accounted entry boundaries',
        inspectedCount: requirements.inspectedInputs,
      });
      return fired([
        {
          ruleId: 'topology-shape',
          situation: 'declared-topology-reachable-acyclic-narrow',
          wholeSystemSubject: 'declared-control-flow-topology',
          category: 'architecture',
          polarity: 'strength',
          severity: 'info',
          confidence: CONFIDENCE_BANDS.deterministic,
          basis: 'discovered',
          title: 'The declared topology is reachable, acyclic and narrow',
          explanation: `Every declared control-flow participant is reachable from an accounted entry boundary, the complete control-flow population contains no cycle, and no agent coordinates more than eight downstream operations. The claim covers ${requirements.inspectedInputs} inspected topology inputs.`,
          impact: 'The system can be reasoned about one path at a time.',
          components: audited.slice(0, 5).map((component) => component.id),
          newEvidence: [population],
          evidence: audited
            .slice(0, 3)
            .flatMap((component) => component.evidence.slice(0, 1)) as EvidenceId[],
          goalEligible: false,
          goalReason: 'Nothing to change.',
          metrics: [
            {
              name: 'topologyInputsInspected',
              value: requirements.inspectedInputs,
              unit: 'topology_input',
              sampleSize: requirements.inspectedInputs,
              basis: 'discovered',
            },
          ],
          tags: ['positive', 'topology'],
        },
      ]);
    }
    if (
      drafts.length === 0 &&
      hasAgent &&
      (!requirements.acyclicityComplete ||
        !requirements.reachabilityComplete ||
        !requirements.narrownessComplete)
    ) {
      return insufficient(
        requirements.status === 'unknown'
          ? 'topology completeness is unknown because this graph has no evidence population'
          : `topology completeness is insufficient across ${requirements.inspectedInputs} inspected inputs`,
      );
    }
    /*
     * The population is the declared components whose arrangement this reads. Reported without one, the
     * outcome was the bare word `clear` and no sentence at all, which says the same thing about a
     * repository holding a hundred well arranged components and about one holding nothing.
     */
    return examined(drafts, {
      count: audited.length,
      singular: 'declared component',
    });
  },
};

export const broadPermissionRule: Rule = {
  id: 'permissions-broader-than-observed-use',
  category: 'permissions',
  summary: 'A declared permission that observed behaviour did not need.',
  evaluate: (context) => {
    if (context.observedRuns.length === 0) {
      return nothingObserved(context, 'which of the declared permissions was needed');
    }
    const drafts: FindingDraft[] = [];
    let holders = 0;
    for (const component of auditedComponents(context.graph)) {
      const writePermissions = component.permissions.filter(
        (permission) => permission.mode === 'write',
      );
      if (writePermissions.length === 0) continue;
      if (!component.presence.runtime) continue;
      /*
       * Counted here rather than at the write permission, because a component that never ran is not one
       * this rule matched against observed use and passed. It is one there was nothing to match.
       */
      holders += 1;
      if (component.metadata['observedSideEffect'] === true) continue;

      const record = absenceEvidence({
        producer: PRODUCER,
        searched: `a side effect performed by ${component.id}`,
        scope: formatCount(context.observedRuns.length, 'observed run'),
        inspectedCount: context.observedRuns.length,
      });
      drafts.push({
        ruleId: 'permissions-broader-than-observed-use',
        situation: 'write-permission-unused-in-observed-runs',
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
    return examined(
      drafts,
      {
        count: holders,
        singular: 'component that ran holding write access',
        plural: 'components that ran holding write access',
      },
      drafts.length === 0 ? 'every write permission was matched by observed use' : undefined,
    );
  },
};

export const unusedConfiguredToolRule: Rule = {
  id: 'configured-tool-has-no-caller',
  category: 'maintainability',
  summary: 'A tool that exists in the declared model with nothing calling it.',
  evaluate: (context) => {
    const discovered = context.graph.componentsOfKind('tool');
    const tools = auditedComponentsOfKind(context.graph, 'tool');
    if (tools.length === 0) {
      /*
       * Two different repositories, and one sentence used to cover both. On `langgraph` the only three
       * tools this build finds are `get_weather` fixtures under `libs/prebuilt/tests`, and saying no tool
       * was discovered there is false about a repository whose tests are full of them.
       */
      const narrowed = narrowedAway(discovered, 'tool');
      return notApplicable(
        narrowed === undefined ? 'no tool was discovered' : `${narrowed}, so nothing was examined`,
      );
    }
    const orphans = tools.filter(
      (tool) =>
        !context.graph
          .incoming(tool.id)
          .some((edge) => isControlFlowKind(edge.kind) || edge.kind === 'provides_tool'),
    );
    if (orphans.length === 0) {
      return examined(
        [],
        { count: tools.length, singular: 'tool' },
        'every discovered tool has a caller',
      );
    }

    const drafts: FindingDraft[] = orphans.map((tool) => ({
      ruleId: 'configured-tool-has-no-caller',
      situation: 'configured-tool-without-caller',
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
    return examined(drafts, { count: tools.length, singular: 'discovered tool' });
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
    const retries = auditedEdges(context.graph).filter((edge) => edge.policy?.retry !== undefined);
    const safe = retries.filter((edge) => {
      const retry = edge.policy?.retry;
      return retry?.bounded === true && retry.idempotency === 'declared';
    });

    return examined(
      safe.map((edge) => {
        const target = context.graph.component(edge.to);
        const source = context.graph.component(edge.from);
        const retry = edge.policy?.retry;
        return {
          ruleId: 'bounded-retry-with-declared-idempotency',
          situation: 'bounded-retry-with-idempotency-key',
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
      { count: retries.length, singular: 'discovered retry', plural: 'discovered retries' },
      'no retry declares both a ceiling and a key on the operation it repeats',
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
