import {
  CONFIDENCE_BANDS,
  derivedEvidence,
  faultInjectionEvidence,
  formatCount,
} from '@orchescope/domain';
import type {
  BenchmarkReport,
  ChaosReport,
  ComponentId,
  EvidenceId,
  VariantResult,
} from '@orchescope/schema';
import { resolveByRuntimeName, taskLevelComponents } from '../attribution.ts';
import {
  examined,
  type FindingDraft,
  fired,
  insufficient,
  notApplicable,
  type Rule,
  type RuleContext,
} from '../rule.ts';

/**
 * Rules that read experiment results: topology benchmarks, concurrency benchmarks and chaos runs.
 *
 * The discipline here is compute normalisation and sample size. A topology comparison that ignores the
 * tokens each variant spent is not a comparison, and a latency improvement with a lower success rate is not
 * an improvement, so both are checked before anything is claimed.
 */

const PRODUCER = 'rule:experiments';

/**
 * A fault names its target the way the running system does. The component it landed on is named first, and the task
 * level components follow, because a fault that ends the task is a fact about the task as well as about the target.
 */
const attributionFor = (
  context: Parameters<Rule['evaluate']>[0],
  target: string,
): readonly string[] => {
  const resolved = resolveByRuntimeName(context.graph, target);
  const task = taskLevelComponents(context.graph);
  return resolved === undefined ? [...task] : [resolved, ...task.filter((id) => id !== resolved)];
};

const variantLabel = (variant: VariantResult): string =>
  variant.variant.agents !== undefined
    ? formatCount(variant.variant.agents, 'agent')
    : variant.variant.concurrency !== undefined
      ? `concurrency ${variant.variant.concurrency}`
      : variant.variantId;

const tokensOf = (variant: VariantResult): number =>
  variant.aggregateMetrics.inputTokens + variant.aggregateMetrics.outputTokens;

const latencyOf = (variant: VariantResult): number | undefined =>
  variant.durationMs.p50 ?? variant.durationMs.mean;

const orderedVariants = (report: BenchmarkReport): readonly VariantResult[] =>
  [...report.variants].sort((left, right) => {
    const leftKey = left.variant.agents ?? left.variant.concurrency ?? 0;
    const rightKey = right.variant.agents ?? right.variant.concurrency ?? 0;
    return leftKey - rightKey;
  });

type AgentCountComparison = {
  readonly report: BenchmarkReport;
  readonly baseline: VariantResult;
  readonly variant: VariantResult;
  readonly baselineLatency: number;
  readonly variantLatency: number;
  readonly baselineSuccess: number;
  readonly variantSuccess: number;
  readonly components: readonly ComponentId[];
};

/**
 * The finding for one variant pair.
 *
 * Sample sizes travel with every number, and the finding is only eligible to become a goal once both sides have enough
 * runs to support the claim: a difference from a handful of runs is not a trend.
 */
const agentCountDraft = (input: AgentCountComparison): FindingDraft => {
  const { baseline, variant, baselineLatency, variantLatency, baselineSuccess, variantSuccess } =
    input;
  const tokenRatio = tokensOf(baseline) === 0 ? undefined : tokensOf(variant) / tokensOf(baseline);
  const enoughRuns = baseline.completedRuns >= 5 && variant.completedRuns >= 5;
  const record = derivedEvidence({
    producer: PRODUCER,
    rule: 'agent-count-does-not-pay-for-itself',
    inputs: [] as EvidenceId[],
    note: `${variantLabel(variant)} against ${variantLabel(baseline)}: latency ${Math.round(baselineLatency)} ms to ${Math.round(variantLatency)} ms, success ${baselineSuccess.toFixed(2)} to ${variantSuccess.toFixed(2)}, tokens ${tokensOf(baseline)} to ${tokensOf(variant)}`,
    basis: 'observed',
  });

  return {
    ruleId: 'agent-count-does-not-pay-for-itself',
    category: 'agent_complexity',
    polarity: 'risk',
    severity: 'medium',
    confidence: enoughRuns ? CONFIDENCE_BANDS.strongStructural : CONFIDENCE_BANDS.heuristic,
    basis: 'observed',
    title: `Going from ${variantLabel(baseline)} to ${variantLabel(variant)} costs latency without improving success`,
    explanation: `Median duration moved from ${Math.round(baselineLatency)} ms to ${Math.round(variantLatency)} ms while task success moved from ${(baselineSuccess * 100).toFixed(0)} percent to ${(variantSuccess * 100).toFixed(0)} percent${tokenRatio === undefined ? '' : `, and token usage changed by a factor of ${tokenRatio.toFixed(2)}`}. Sample sizes were ${baseline.completedRuns} and ${variant.completedRuns} completed runs, which is stated because a difference from a handful of runs is not a trend.`,
    impact:
      'The extra coordination is being paid for in latency and tokens and is not returning a measurable success improvement on this scenario.',
    components: [...input.components],
    newEvidence: [record],
    evidence: [],
    metrics: [
      {
        name: 'p50_duration_ms',
        value: Math.round(variantLatency),
        unit: 'ms',
        sampleSize: variant.completedRuns,
        basis: 'observed',
        comparisonValue: Math.round(baselineLatency),
      },
      {
        name: 'success_rate',
        value: Number(variantSuccess.toFixed(3)),
        unit: 'fraction',
        sampleSize: variant.completedRuns,
        basis: 'observed',
        comparisonValue: Number(baselineSuccess.toFixed(3)),
      },
      {
        name: 'total_tokens',
        value: tokensOf(variant),
        unit: 'tokens',
        sampleSize: variant.completedRuns,
        basis: 'observed',
        comparisonValue: tokensOf(baseline),
      },
    ],
    recommendation: {
      summary: `Run this scenario with ${variantLabel(baseline)} unless another scenario shows a gain.`,
      steps: [
        'Check whether a different scenario benefits from the higher agent count.',
        'If not, set the agent count to the lower value.',
        'Rerun the benchmark to confirm the change holds.',
      ],
      effort: 'small',
      risk: 'low',
    },
    suggestedExperiment: {
      description: 'Rerun the agent count benchmark after changing the default.',
      command: [
        'orchescope',
        'benchmark',
        '--scenario',
        input.report.scenarioId,
        '--agents',
        '1,2,4',
      ],
      expectedSignal: 'the chosen count has the best latency at equal or better success',
    },
    goalEligible: enoughRuns,
    goalReason: enoughRuns
      ? 'The change is a configuration value and the check is a rerun of the same benchmark.'
      : 'More repetitions are needed before this is worth acting on.',
    tags: ['topology', 'agent-count'],
  };
};

export const agentCountRule: Rule = {
  id: 'agent-count-does-not-pay-for-itself',
  category: 'agent_complexity',
  summary:
    'Whether adding agents improved task success enough to justify its latency and token cost.',
  evaluate: (context) => {
    const reports = context.benchmarks.filter((report) => report.dimension === 'agent_count');
    if (reports.length === 0) return notApplicable('no agent count benchmark has been run');

    const drafts: FindingDraft[] = [];
    for (const report of reports) {
      const variants = orderedVariants(report);
      const baseline = variants[0];
      if (baseline === undefined || variants.length < 2) {
        return insufficient('an agent count comparison needs at least two variants');
      }
      for (const variant of variants.slice(1)) {
        const baselineLatency = latencyOf(baseline);
        const variantLatency = latencyOf(variant);
        if (baselineLatency === undefined || variantLatency === undefined) continue;
        const baselineSuccess = baseline.successRate;
        const variantSuccess = variant.successRate;
        if (baselineSuccess === undefined || variantSuccess === undefined) continue;

        const latencyWorse = variantLatency > baselineLatency * 1.1;
        const successGain = variantSuccess - baselineSuccess;
        if (!latencyWorse || successGain > 0.02) continue;

        drafts.push(
          agentCountDraft({
            report,
            baseline,
            variant,
            baselineLatency,
            variantLatency,
            baselineSuccess,
            variantSuccess,
            components: taskLevelComponents(context.graph),
          }),
        );
      }
    }
    return fired(
      drafts,
      drafts.length === 0
        ? 'higher agent counts did not cost latency without a success gain'
        : undefined,
    );
  },
};

export const concurrencySaturationRule: Rule = {
  id: 'throughput-saturates-under-concurrency',
  category: 'performance',
  summary: 'Where added concurrency stops buying throughput.',
  evaluate: (context) => {
    const reports = context.benchmarks.filter(
      (report) => report.dimension === 'traffic_concurrency',
    );
    if (reports.length === 0) return notApplicable('no traffic concurrency benchmark has been run');

    const drafts: FindingDraft[] = [];
    for (const report of reports) {
      const variants = orderedVariants(report);
      if (variants.length < 2)
        return insufficient('a concurrency comparison needs at least two variants');
      const baseline = variants[0];
      if (baseline === undefined) continue;
      const baselineLatency = latencyOf(baseline);
      if (baselineLatency === undefined || baselineLatency <= 0) continue;

      for (const variant of variants.slice(1)) {
        const latency = latencyOf(variant);
        const baselineConcurrency = baseline.variant.concurrency ?? 1;
        const variantConcurrency = variant.variant.concurrency ?? 1;
        if (latency === undefined || variantConcurrency <= baselineConcurrency) continue;
        const concurrencyRatio = variantConcurrency / baselineConcurrency;
        const latencyRatio = latency / baselineLatency;
        // Superlinear latency growth against the added concurrency is the saturation signal.
        if (latencyRatio <= concurrencyRatio) continue;

        drafts.push({
          ruleId: 'throughput-saturates-under-concurrency',
          category: 'performance',
          polarity: 'risk',
          severity: 'medium',
          confidence:
            variant.completedRuns >= 5
              ? CONFIDENCE_BANDS.strongStructural
              : CONFIDENCE_BANDS.heuristic,
          basis: 'observed',
          title: `Latency grows faster than load between concurrency ${baselineConcurrency} and ${variantConcurrency}`,
          explanation: `Concurrency rose by a factor of ${concurrencyRatio.toFixed(1)} and median duration rose by a factor of ${latencyRatio.toFixed(1)}, from ${Math.round(baselineLatency)} ms to ${Math.round(latency)} ms, over ${formatCount(variant.completedRuns, 'completed run')}. Growth faster than the added load means something in the path is a bottleneck rather than a parallel resource.`,
          impact:
            'Beyond this point, more traffic makes every request slower rather than serving more of them.',
          components: [...taskLevelComponents(context.graph)],
          evidence: [],
          metrics: [
            {
              name: 'p50_duration_ms',
              value: Math.round(latency),
              unit: 'ms',
              sampleSize: variant.completedRuns,
              basis: 'observed',
              comparisonValue: Math.round(baselineLatency),
            },
            {
              name: 'concurrency',
              value: variantConcurrency,
              unit: 'requests',
              sampleSize: variant.completedRuns,
              basis: 'observed',
              comparisonValue: baselineConcurrency,
            },
          ],
          recommendation: {
            summary:
              'Find the shared resource that serialises the work, then bound the queue in front of it.',
            steps: [
              'Look at the latency overlay for the component whose self time grows with concurrency.',
              'Bound the queue or raise the worker count for that component.',
              'Rerun the concurrency benchmark.',
            ],
            effort: 'medium',
            risk: 'medium',
          },
          goalEligible: false,
          goalReason:
            'The remedy depends on which resource saturates, which needs a human to identify.',
          tags: ['concurrency', 'saturation'],
        });
      }
    }
    return fired(
      drafts,
      drafts.length === 0 ? 'latency grew no faster than the added concurrency' : undefined,
    );
  },
};

type ChaosOutcome = ChaosReport['outcomes'][number];

/**
 * What one injected fault did.
 *
 * A duplicated external effect outranks a task that failed cleanly: a failure the caller can see is recoverable, an
 * effect that reached the outside world twice is not. An absorbed fault is recorded as a strength, because resilience
 * that was measured is worth as much to a reader as a defect.
 */
const chaosOutcomeDraft = (
  context: RuleContext,
  outcome: ChaosOutcome,
  scenarioId: string,
): FindingDraft => {
  const record = faultInjectionEvidence({
    producer: PRODUCER,
    runId: outcome.runId,
    faultKind: outcome.faultKind,
    target: outcome.target,
    appliedCount: outcome.appliedCount,
  });
  const duplicated = outcome.duplicateSideEffects > 0;
  const collapsed = !outcome.taskCompleted;
  const amplified = (outcome.costAmplification ?? 1) > 1.5;

  if (!collapsed && !duplicated && !amplified) {
    return {
      ruleId: 'resilience-under-injected-fault',
      category: 'resilience',
      polarity: 'strength',
      severity: 'info',
      confidence: CONFIDENCE_BANDS.deterministic,
      basis: 'simulated',
      title: `${outcome.faultKind} on ${outcome.target} was absorbed`,
      explanation: `The fault was applied ${formatCount(outcome.appliedCount, 'time')}, the task still completed, recovery ${outcome.recovered ? 'happened' : 'was not needed'}, no side effect was duplicated and cost amplification stayed at ${(outcome.costAmplification ?? 1).toFixed(2)}.`,
      impact: 'This failure mode is handled without user intervention.',
      components: attributionFor(context, outcome.target),
      newEvidence: [record],
      evidence: [],
      goalEligible: false,
      goalReason: 'Nothing to change.',
      tags: ['positive', 'chaos', outcome.faultKind],
    };
  }

  /*
   * The outcome in the words a reader who did not write the fault plan would use. "A side effect was
   * duplicated" names the schema's category; "an outside effect happened twice" names the thing the
   * reader would have to explain to whoever received it twice, and it is the same phrase the
   * reconciliation region uses for the same event.
   */
  const headline = collapsed
    ? 'the task did not finish'
    : duplicated
      ? 'an outside effect happened twice'
      : 'the run cost materially more';
  return {
    ruleId: 'resilience-under-injected-fault',
    category: 'resilience',
    polarity: 'risk',
    severity: duplicated ? 'high' : collapsed ? 'medium' : 'low',
    confidence: CONFIDENCE_BANDS.deterministic,
    basis: 'simulated',
    title: `${outcome.faultKind} on ${outcome.target}: ${headline}`,
    explanation: `The fault was applied ${formatCount(outcome.appliedCount, 'time')} in run ${outcome.runId}. Task completed: ${outcome.taskCompleted}. Recovered: ${outcome.recovered}. Duplicate side effects: ${outcome.duplicateSideEffects}. Cost amplification against the baseline: ${(outcome.costAmplification ?? 1).toFixed(2)}. Retry amplification: ${(outcome.retryAmplification ?? 1).toFixed(2)}. This is a simulated failure, so the claim is about behaviour under an injected fault rather than about production.`,
    impact: duplicated
      ? 'The failure path produces a duplicated external effect, which is visible outside the system.'
      : collapsed
        ? 'A single dependency failure ends the task rather than degrading it.'
        : 'The failure path costs materially more than the healthy path.',
    components: attributionFor(context, outcome.target),
    newEvidence: [record],
    evidence: [],
    metrics: [
      {
        name: 'duplicate_side_effects',
        value: outcome.duplicateSideEffects,
        unit: 'count',
        sampleSize: 1,
        basis: 'simulated',
      },
      {
        name: 'cost_amplification',
        value: Number((outcome.costAmplification ?? 1).toFixed(2)),
        unit: 'ratio',
        sampleSize: 1,
        basis: 'simulated',
      },
    ],
    recommendation: {
      summary: collapsed
        ? 'Degrade instead of failing: return the part of the answer that does not need the failed dependency.'
        : 'Make the retried operation safe to repeat, then rerun this fault.',
      steps: [
        'Reproduce with the same seed and fault plan.',
        collapsed
          ? 'Handle the failure at the call site and continue with a reduced answer.'
          : 'Attach an idempotency key or remove the retry.',
        'Rerun the chaos scenario and compare against the baseline run.',
      ],
      effort: 'medium',
      risk: 'medium',
    },
    suggestedExperiment: {
      description: `Reapply ${outcome.faultKind} on ${outcome.target} with the same seed.`,
      command: ['orchescope', 'chaos', '--scenario', scenarioId],
      expectedSignal: collapsed
        ? 'the task completes with a degraded answer'
        : 'duplicate side effects drop to zero',
    },
    goalEligible: duplicated,
    goalReason: duplicated
      ? 'The change is local to the retried operation and the check is a deterministic rerun.'
      : 'Choosing how to degrade is a design decision.',
    tags: ['chaos', outcome.faultKind],
  };
};

export const resilienceRule: Rule = {
  id: 'resilience-under-injected-fault',
  category: 'resilience',
  summary: 'What each injected fault did to task completion, cost and side effects.',
  evaluate: (context) => {
    if (context.chaosReports.length === 0) return notApplicable('no chaos suite has been run');
    const drafts: FindingDraft[] = [];
    for (const report of context.chaosReports) {
      for (const outcome of report.outcomes) {
        drafts.push(chaosOutcomeDraft(context, outcome, report.scenarioId));
      }
      if (report.notApplied.length > 0) {
        return fired(
          drafts,
          `${formatCount(report.notApplied.length, 'requested fault')} ${report.notApplied.length === 1 ? 'was' : 'were'} not applied: ${report.notApplied
            .map((entry) => `${entry.faultKind} on ${entry.target} (${entry.reason})`)
            .join('; ')}`,
        );
      }
    }
    /*
     * A suite that ran and recorded no outcome measured nothing, which is not the same as a suite whose
     * outcomes were all fine. `clear` said the second about the first.
     */
    return examined(drafts, {
      count: context.chaosReports.reduce((total, report) => total + report.outcomes.length, 0),
      singular: 'injected fault',
    });
  },
};

export const EXPERIMENT_RULES: readonly Rule[] = [
  agentCountRule,
  concurrencySaturationRule,
  resilienceRule,
];
