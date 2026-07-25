import { CONFIDENCE_BANDS, derivedEvidence, metricEvidence } from '@orchescope/domain';
import type { ComponentId, EvidenceId } from '@orchescope/schema';
import {
  clear,
  type FindingDraft,
  fired,
  insufficient,
  notApplicable,
  type Rule,
} from '../rule.ts';

/**
 * Rules that need observed runs.
 *
 * Every threshold here is stated in the finding text, and every one has a minimum sample size, because a
 * latency claim from two executions is an anecdote. When the sample is too small the rule reports
 * insufficient evidence rather than firing quietly.
 */

const PRODUCER = 'rule:runtime';
const MIN_EXECUTIONS_FOR_SHARE = 3;
const MIN_EXECUTIONS_FOR_ERROR_RATE = 5;
const LATENCY_SHARE_THRESHOLD = 0.4;
const TOKEN_SHARE_THRESHOLD = 0.4;
const ERROR_RATE_THRESHOLD = 0.2;

type Aggregate = {
  readonly componentId: ComponentId;
  executions: number;
  selfDurationMs: number;
  totalDurationMs: number;
  inputTokens: number;
  outputTokens: number;
  errors: number;
  retries: number;
};

const aggregateByComponent = (
  context: Parameters<Rule['evaluate']>[0],
): ReadonlyMap<string, Aggregate> => {
  const totals = new Map<string, Aggregate>();
  for (const entry of context.runs) {
    for (const metric of entry.componentMetrics) {
      const current =
        totals.get(metric.componentId) ??
        ({
          componentId: metric.componentId,
          executions: 0,
          selfDurationMs: 0,
          totalDurationMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          errors: 0,
          retries: 0,
        } satisfies Aggregate);
      current.executions += metric.executionCount;
      current.selfDurationMs += metric.selfDurationMs;
      current.totalDurationMs += metric.totalDurationMs;
      current.inputTokens += metric.inputTokens;
      current.outputTokens += metric.outputTokens;
      current.errors += metric.errorCount;
      current.retries += metric.retryCount;
      totals.set(metric.componentId, current);
    }
  }
  return totals;
};

export const sequentialIndependentCallsRule: Rule = {
  id: 'independent-calls-run-sequentially',
  category: 'performance',
  summary: 'Sibling operations that never overlapped despite having no observed dependency.',
  evaluate: (context) => {
    if (context.runs.length === 0) return insufficient('no run has been ingested');
    const toolEdges = context.graph
      .edgesOfKind('calls_tool')
      .filter((edge) => edge.observation !== undefined && edge.observation.executionCount > 0);
    if (toolEdges.length < 2) {
      return notApplicable(
        'fewer than two observed tool relations, so ordering cannot be compared',
      );
    }

    const bySource = new Map<string, typeof toolEdges>();
    for (const edge of toolEdges) {
      const bucket = bySource.get(edge.from);
      if (bucket === undefined) bySource.set(edge.from, [edge]);
      else bucket.push(edge);
    }

    const drafts: FindingDraft[] = [];
    for (const [sourceId, edges] of bySource) {
      if (edges.length < 2) continue;
      const neverParallel = edges.filter((edge) => (edge.observation?.parallelCount ?? 0) === 0);
      if (neverParallel.length < 2) continue;
      const source = context.graph.component(sourceId);
      const targets = neverParallel
        .map((edge) => context.graph.component(edge.to))
        .filter((component): component is NonNullable<typeof component> => component !== undefined);
      const readOnly = targets.filter(
        (target) => target.sideEffect === 'read_only' || target.details?.for === 'tool',
      );
      if (readOnly.length < 2) continue;

      const totalSequential = neverParallel.reduce(
        (total, edge) => total + (edge.observation?.totalDurationMs ?? 0),
        0,
      );
      const slowest = Math.max(
        ...neverParallel.map((edge) => edge.observation?.maxDurationMs ?? 0),
      );
      const savingMs = Math.max(0, totalSequential - slowest);
      if (savingMs <= 0) continue;

      const record = derivedEvidence({
        producer: PRODUCER,
        rule: 'independent-calls-run-sequentially',
        inputs: neverParallel.flatMap((edge) => edge.evidence.slice(0, 2)) as EvidenceId[],
        note: `${neverParallel.length} tool relations from ${sourceId} never overlapped in ${context.runs.length} run(s); sequential total ${Math.round(totalSequential)} ms against a slowest single call of ${Math.round(slowest)} ms`,
      });

      drafts.push({
        ruleId: 'independent-calls-run-sequentially',
        category: 'performance',
        polarity: 'risk',
        severity: savingMs > 500 ? 'medium' : 'low',
        confidence: CONFIDENCE_BANDS.strongStructural,
        basis: 'observed',
        title: `${source?.displayName ?? sourceId} calls ${targets.map((target) => target.displayName).join(' and ')} one after another`,
        explanation: `Across ${context.runs.length} run(s) these ${neverParallel.length} tool calls never overlapped in wall clock time. Their combined observed time is ${Math.round(totalSequential)} ms and the slowest single call is ${Math.round(slowest)} ms. Whether the calls are truly independent is a question about the code rather than about the trace, so the estimate below is labelled as an estimate.`,
        impact: `If the calls are independent, starting them together removes about ${Math.round(savingMs)} ms of user visible latency per request.`,
        components: [sourceId, ...targets.map((target) => target.id)],
        edges: neverParallel.map((edge) => edge.id),
        newEvidence: [record],
        evidence: neverParallel.flatMap((edge) => edge.evidence.slice(0, 2)) as EvidenceId[],
        metrics: [
          {
            name: 'sequential_total_ms',
            value: Math.round(totalSequential),
            unit: 'ms',
            sampleSize: neverParallel.reduce(
              (total, edge) => total + (edge.observation?.executionCount ?? 0),
              0,
            ),
            basis: 'observed',
          },
          {
            name: 'estimated_parallel_ms',
            value: Math.round(slowest),
            unit: 'ms',
            sampleSize: neverParallel.length,
            basis: 'estimated',
          },
        ],
        recommendation: {
          summary: 'Start the independent calls together instead of awaiting each one in turn.',
          steps: [
            'Confirm neither call consumes the other result.',
            'Start both and await them together.',
            'Rerun the scenario and compare the p95 against the baseline run.',
          ],
          effort: 'small',
          risk: 'low',
        },
        suggestedExperiment: {
          description: 'Rerun the scenario and compare latency and success against the baseline.',
          command: ['orchescope', 'compare', '<baseline-run>', '<candidate-run>'],
          expectedSignal: 'p95 latency improves while task success does not decline',
        },
        goalEligible: true,
        goalReason: 'The change is local to one call site and is verified by comparing runs.',
        tags: ['latency', 'parallelism'],
      });
    }
    return fired(
      drafts,
      drafts.length === 0
        ? 'no pair of independent tool calls ran strictly sequentially'
        : undefined,
    );
  },
};

export const latencyConcentrationRule: Rule = {
  id: 'latency-concentrated-in-one-component',
  category: 'performance',
  summary: 'One component holding most of the measured self time.',
  evaluate: (context) => {
    if (context.runs.length === 0) return insufficient('no run has been ingested');
    const totals = aggregateByComponent(context);
    const overall = [...totals.values()].reduce((total, entry) => total + entry.selfDurationMs, 0);
    if (overall <= 0) return insufficient('no self time was recorded');

    const drafts: FindingDraft[] = [];
    for (const entry of totals.values()) {
      if (entry.executions < MIN_EXECUTIONS_FOR_SHARE) continue;
      const share = entry.selfDurationMs / overall;
      if (share < LATENCY_SHARE_THRESHOLD) continue;
      const component = context.graph.component(entry.componentId);
      if (component === undefined) continue;
      const record = metricEvidence({
        producer: PRODUCER,
        runId: context.runs.map((run) => run.run.id).join(','),
        metric: 'self_time_share',
        value: share,
        unit: 'fraction',
        sampleSize: entry.executions,
        componentId: entry.componentId,
      });
      drafts.push({
        ruleId: 'latency-concentrated-in-one-component',
        category: 'performance',
        polarity: 'risk',
        severity: share > 0.6 ? 'medium' : 'low',
        confidence: CONFIDENCE_BANDS.strongStructural,
        basis: 'observed',
        title: `${component.displayName} accounts for ${Math.round(share * 100)} percent of measured time`,
        explanation: `Across ${entry.executions} execution(s) in ${context.runs.length} run(s), ${component.displayName} spent ${Math.round(entry.selfDurationMs)} ms of self time out of ${Math.round(overall)} ms measured in total. Self time excludes time spent inside its children, so this is time this component itself is responsible for.`,
        impact: 'Any latency work that does not touch this component will not move the total much.',
        components: [component.id],
        newEvidence: [record],
        evidence: component.evidence.slice(0, 2) as EvidenceId[],
        metrics: [
          {
            name: 'self_time_ms',
            value: Math.round(entry.selfDurationMs),
            unit: 'ms',
            sampleSize: entry.executions,
            basis: 'observed',
          },
          {
            name: 'self_time_share',
            value: Number(share.toFixed(3)),
            unit: 'fraction',
            sampleSize: entry.executions,
            basis: 'observed',
          },
        ],
        goalEligible: false,
        goalReason:
          'Where the time goes is a measurement. What to do about it depends on the component.',
        tags: ['latency'],
      });
    }
    return fired(
      drafts,
      drafts.length === 0
        ? 'no single component held more than 40 percent of self time'
        : undefined,
    );
  },
};

export const tokenConcentrationRule: Rule = {
  id: 'tokens-concentrated-in-one-component',
  category: 'cost',
  summary: 'One component holding most of the token usage.',
  evaluate: (context) => {
    if (context.runs.length === 0) return insufficient('no run has been ingested');
    const totals = aggregateByComponent(context);
    const overall = [...totals.values()].reduce(
      (total, entry) => total + entry.inputTokens + entry.outputTokens,
      0,
    );
    if (overall <= 0) return insufficient('no token usage was reported by the instrumentation');

    const drafts: FindingDraft[] = [];
    for (const entry of totals.values()) {
      const tokens = entry.inputTokens + entry.outputTokens;
      const share = tokens / overall;
      if (share < TOKEN_SHARE_THRESHOLD || entry.executions < MIN_EXECUTIONS_FOR_SHARE) continue;
      const component = context.graph.component(entry.componentId);
      if (component === undefined) continue;
      drafts.push({
        ruleId: 'tokens-concentrated-in-one-component',
        category: 'cost',
        polarity: 'risk',
        severity: 'low',
        confidence: CONFIDENCE_BANDS.deterministic,
        basis: 'observed',
        title: `${component.displayName} consumes ${Math.round(share * 100)} percent of all tokens`,
        explanation: `${component.displayName} used ${entry.inputTokens} input and ${entry.outputTokens} output tokens across ${entry.executions} execution(s), which is ${Math.round(share * 100)} percent of the ${overall} tokens measured. Orchescope reports tokens rather than money because the generative AI conventions carry no cost attribute and a bundled price table would go stale.`,
        impact: 'Token reduction work anywhere else has a smaller ceiling than work here.',
        components: [component.id],
        evidence: component.evidence.slice(0, 2) as EvidenceId[],
        metrics: [
          {
            name: 'input_tokens',
            value: entry.inputTokens,
            unit: 'tokens',
            sampleSize: entry.executions,
            basis: 'observed',
          },
          {
            name: 'output_tokens',
            value: entry.outputTokens,
            unit: 'tokens',
            sampleSize: entry.executions,
            basis: 'observed',
          },
        ],
        goalEligible: false,
        goalReason: 'Reducing tokens requires knowing which part of the prompt is unnecessary.',
        tags: ['cost', 'tokens'],
      });
    }
    return fired(
      drafts,
      drafts.length === 0 ? 'token usage was spread across components' : undefined,
    );
  },
};

export const repeatedContextRule: Rule = {
  id: 'workers-receive-comparably-large-context',
  category: 'cost',
  summary:
    'Several workers receiving similarly large inputs, consistent with a shared full context.',
  evaluate: (context) => {
    if (context.runs.length === 0) return insufficient('no run has been ingested');
    const totals = aggregateByComponent(context);
    const agents = [...totals.values()]
      .map((entry) => ({ entry, component: context.graph.component(entry.componentId) }))
      .filter(
        (candidate) =>
          candidate.component !== undefined &&
          candidate.component.kind === 'agent' &&
          candidate.entry.inputTokens > 0,
      );
    if (agents.length < 2) return notApplicable('fewer than two agents reported input tokens');

    const perExecution = agents.map((candidate) => ({
      ...candidate,
      tokensPerExecution: candidate.entry.inputTokens / Math.max(1, candidate.entry.executions),
    }));
    const largest = Math.max(...perExecution.map((candidate) => candidate.tokensPerExecution));
    if (largest < 500) return clear('no agent received a large input per execution');
    const similar = perExecution.filter(
      (candidate) =>
        candidate.tokensPerExecution >= largest * 0.8 && candidate.tokensPerExecution >= 500,
    );
    if (similar.length < 2)
      return clear('agent input sizes differ, which is what a narrowed context looks like');

    const record = derivedEvidence({
      producer: PRODUCER,
      rule: 'workers-receive-comparably-large-context',
      inputs: similar.flatMap(
        (candidate) => candidate.component?.evidence.slice(0, 1) ?? [],
      ) as EvidenceId[],
      note: `${similar.length} agents each received between ${Math.round(largest * 0.8)} and ${Math.round(largest)} input tokens per execution`,
    });

    return fired([
      {
        ruleId: 'workers-receive-comparably-large-context',
        category: 'cost',
        polarity: 'risk',
        severity: 'medium',
        confidence: CONFIDENCE_BANDS.structural,
        basis: 'observed',
        title: `${similar.length} agents each receive a comparably large input`,
        explanation: `${similar
          .map(
            (candidate) =>
              `${candidate.component?.displayName ?? candidate.entry.componentId} at ${Math.round(candidate.tokensPerExecution)} tokens`,
          )
          .join(
            ', ',
          )} per execution. Inputs of the same size arriving at several agents is what passing the full conversation to each one looks like. Orchescope cannot see the prompt content by default, since the conventions make content capture opt in, so this is a shape rather than a proof.`,
        impact: `Each agent pays for context it may not use. At ${Math.round(largest)} tokens per call, the redundant share is the largest single lever on cost here.`,
        components: similar.map((candidate) => candidate.entry.componentId),
        newEvidence: [record],
        evidence: similar.flatMap(
          (candidate) => candidate.component?.evidence.slice(0, 1) ?? [],
        ) as EvidenceId[],
        metrics: similar.map((candidate) => ({
          name: `input_tokens_per_execution:${candidate.entry.componentId}`,
          value: Math.round(candidate.tokensPerExecution),
          unit: 'tokens',
          sampleSize: candidate.entry.executions,
          basis: 'observed' as const,
        })),
        recommendation: {
          summary: 'Give each worker only the fields it reads.',
          steps: [
            'List the fields each worker actually uses.',
            'Pass a narrowed payload instead of the whole conversation.',
            'Rerun the scenario and compare tokens and task success against the baseline.',
          ],
          effort: 'medium',
          risk: 'medium',
        },
        suggestedExperiment: {
          description: 'Compare tokens and success before and after narrowing the worker inputs.',
          command: ['orchescope', 'compare', '<baseline-run>', '<candidate-run>'],
          expectedSignal: 'input tokens fall while task success is unchanged',
        },
        goalEligible: true,
        goalReason:
          'The change is bounded to the payload construction and is checked by a run comparison.',
        tags: ['cost', 'context'],
      },
    ]);
  },
};

export const unreliableRelationRule: Rule = {
  id: 'relation-fails-often',
  category: 'reliability',
  summary: 'A relation whose observed error rate is high enough to matter.',
  evaluate: (context) => {
    if (context.runs.length === 0) return insufficient('no run has been ingested');
    const drafts: FindingDraft[] = [];
    for (const edge of context.graph.graph.edges) {
      const observation = edge.observation;
      if (observation === undefined || observation.executionCount < MIN_EXECUTIONS_FOR_ERROR_RATE)
        continue;
      const rate = observation.errorCount / observation.executionCount;
      if (rate < ERROR_RATE_THRESHOLD) continue;
      const target = context.graph.component(edge.to);
      const source = context.graph.component(edge.from);
      drafts.push({
        ruleId: 'relation-fails-often',
        category: 'reliability',
        polarity: 'risk',
        severity: rate > 0.5 ? 'high' : 'medium',
        confidence: CONFIDENCE_BANDS.deterministic,
        basis: 'observed',
        title: `${source?.displayName ?? edge.from} to ${target?.displayName ?? edge.to} failed ${observation.errorCount} of ${observation.executionCount} times`,
        explanation: `The observed error rate on this relation is ${Math.round(rate * 100)} percent over ${observation.executionCount} executions, with ${observation.retryCount} retries recorded.`,
        impact:
          'A relation that fails this often shapes both the latency distribution and the cost.',
        components: [edge.from, edge.to],
        edges: [edge.id],
        evidence: edge.evidence.slice(0, 3) as EvidenceId[],
        metrics: [
          {
            name: 'error_rate',
            value: Number(rate.toFixed(3)),
            unit: 'fraction',
            sampleSize: observation.executionCount,
            basis: 'observed',
          },
        ],
        goalEligible: false,
        goalReason: 'The fix depends on why the dependency fails, which the trace does not say.',
        tags: ['errors'],
      });
    }
    return fired(
      drafts,
      drafts.length === 0
        ? 'no relation exceeded a 20 percent error rate with at least five executions'
        : undefined,
    );
  },
};

export const observabilityCoverageRule: Rule = {
  id: 'observability-coverage',
  category: 'observability',
  summary: 'How much of the declared system any run has exercised.',
  evaluate: (context) => {
    if (context.delta === undefined || context.runs.length === 0) {
      return fired([
        {
          ruleId: 'observability-coverage',
          category: 'observability',
          polarity: 'risk',
          severity: 'medium',
          confidence: CONFIDENCE_BANDS.deterministic,
          basis: 'discovered',
          title: 'No runtime evidence has been collected',
          explanation:
            'Every claim in this report comes from source and configuration analysis. Whether the declared system behaves as declared is unknown until a run is observed.',
          impact:
            'Reconciliation, latency, cost and resilience findings are all unavailable, and they are where most of the value is.',
          components: context.graph.graph.components.slice(0, 5).map((component) => component.id),
          evidence: context.graph.graph.components
            .slice(0, 2)
            .flatMap((component) => component.evidence.slice(0, 1)) as EvidenceId[],
          recommendation: {
            summary: 'Record one run with orchescope trace.',
            steps: [
              'Run: orchescope trace -- <the command that starts your system>',
              'Rerun the audit.',
            ],
            effort: 'small',
            risk: 'low',
          },
          goalEligible: false,
          goalReason: 'This is a next step for the operator rather than a code change.',
          tags: ['coverage'],
        },
      ]);
    }
    const rate = context.delta.coverage.componentExerciseRate;
    if (rate === undefined) return insufficient('no exercise rate could be computed');
    if (rate >= 0.8) {
      return fired([
        {
          ruleId: 'observability-coverage',
          category: 'observability',
          polarity: 'strength',
          severity: 'info',
          confidence: CONFIDENCE_BANDS.deterministic,
          basis: 'observed',
          title: `${Math.round(rate * 100)} percent of declared components were exercised`,
          explanation: `${context.delta.coverage.exercisedComponents} of ${context.delta.coverage.declaredComponents} observable declared components appeared in at least one run, so the runtime findings in this report cover most of the system.`,
          impact: 'Conclusions about behaviour rest on evidence for most of the declared model.',
          components: [],
          evidence: [],
          goalEligible: false,
          goalReason: 'Nothing to change.',
          tags: ['positive', 'coverage'],
        },
      ]);
    }
    return fired([
      {
        ruleId: 'observability-coverage',
        category: 'observability',
        polarity: 'risk',
        severity: rate < 0.4 ? 'medium' : 'low',
        confidence: CONFIDENCE_BANDS.deterministic,
        basis: 'observed',
        title: `Only ${Math.round(rate * 100)} percent of declared components were exercised`,
        explanation: `${context.delta.coverage.exercisedComponents} of ${context.delta.coverage.declaredComponents} observable declared components appeared in a run. Runtime findings apply to that subset only.`,
        impact: 'Most runtime conclusions do not cover the unexercised part of the system.',
        components: context.delta.declaredNotExercised.components.slice(0, 10),
        evidence: [],
        recommendation: {
          summary: 'Add scenarios that reach the unexercised components.',
          steps: [
            'Look at the declared but never exercised list in the report.',
            'Write or extend a scenario that reaches those paths.',
          ],
          effort: 'medium',
          risk: 'low',
        },
        goalEligible: false,
        goalReason: 'Writing a scenario is work for the operator rather than a code change.',
        tags: ['coverage'],
      },
    ]);
  },
};

export const RUNTIME_RULES: readonly Rule[] = [
  sequentialIndependentCallsRule,
  latencyConcentrationRule,
  tokenConcentrationRule,
  repeatedContextRule,
  unreliableRelationRule,
  observabilityCoverageRule,
];
