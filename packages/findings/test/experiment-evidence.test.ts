import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { derivedEvidence, faultInjectionEvidence } from '@orchescope/domain';
import { indexGraph } from '@orchescope/graph';
import type { ChaosReport } from '@orchescope/schema';
import { buildGraph, componentDraft } from '@orchescope/testkit';
import { evaluateRules } from '../src/engine.ts';
import { fired, type FindingDraft, type RuleContext } from '../src/rule.ts';
import { resilienceRule } from '../src/rules/experiments.ts';

const agent = componentDraft({ kind: 'agent', name: 'planner', file: 'src/planner.ts' });
const graph = indexGraph(buildGraph([agent]));

const chaos = (overrides: Record<string, unknown> = {}): ChaosReport =>
  ({
    schemaVersion: 1,
    id: 'chaos_0000000000000000',
    scenarioId: 'support-desk',
    environment: 'local_deterministic',
    startedAt: '2026-08-22T12:00:00.000Z',
    finishedAt: '2026-08-22T12:01:00.000Z',
    baselineRunId: 'run_baseline',
    outcomes: [
      {
        faultKind: 'tool_timeout',
        target: 'planner',
        appliedCount: 1,
        runId: 'run_fault',
        taskCompleted: true,
        recovered: true,
        duplicateSideEffects: 0,
        prohibitedSideEffects: 0,
        userInterventions: 0,
        loopIterations: 1,
        degradedGracefully: true,
        policyViolations: 0,
        evaluators: [],
        ...overrides,
      },
    ],
    notApplied: [],
    metadata: {},
  }) as unknown as ChaosReport;

const context = (report: ChaosReport): RuleContext => ({
  graph,
  delta: undefined,
  observedRuns: [],
  silentRuns: [],
  benchmarks: [],
  chaosReports: [report],
  scenarios: [],
  evidenceById: new Map(),
});

describe('resilience outcome evidence', () => {
  it('does not invent absent cost or retry ratios for a complete strength', () => {
    const outcome = resilienceRule.evaluate(context(chaos()));
    assert.equal(outcome.status, 'fired');
    const strength = outcome.drafts[0];
    assert.equal(strength?.polarity, 'strength');
    assert.match(strength?.explanation ?? '', /Cost amplification was not measured/);
    assert.equal(
      strength?.metrics?.some((metric) => metric.name === 'cost_amplification') ?? false,
      false,
    );
  });

  it('refuses a broad strength when intervention-free graceful outcome facts are absent', () => {
    const outcome = resilienceRule.evaluate(context(chaos({ userInterventions: 1 })));
    assert.equal(outcome.status, 'insufficient_evidence');
    assert.deepEqual(outcome.drafts, []);
  });

  it('drops a strength bound only to legacy thin fault application evidence', () => {
    const thin = faultInjectionEvidence({
      producer: 'fixture',
      runId: 'run_fault',
      faultKind: 'tool_timeout',
      target: 'planner',
      appliedCount: 1,
    });
    const draft: FindingDraft = {
      ruleId: 'resilience-under-injected-fault',
      situation: 'injected-fault-absorbed',
      category: 'resilience',
      polarity: 'strength',
      severity: 'info',
      confidence: 0.99,
      basis: 'simulated',
      title: 'The fault was absorbed',
      explanation: 'The fault was absorbed without intervention.',
      impact: 'The failure mode is handled.',
      components: [graph.graph.components[0]?.id as string],
      claimEvidence: {
        mechanism: [thin.id],
        subject: [thin.id],
        conclusion: [thin.id],
      },
      goalEligible: false,
      goalReason: 'Nothing to change.',
    };
    const result = evaluateRules({
      scanId: 'scan_thin_fault',
      generatedAt: '2026-08-22T12:00:00.000Z',
      graph,
      context: {
        ...context(chaos()),
        chaosReports: [],
        evidenceById: new Map([[thin.id, thin]]),
      },
      rules: [
        {
          id: draft.ruleId,
          category: draft.category,
          summary: 'fixture',
          evaluate: () => fired([draft]),
        },
      ],
    });
    assert.equal(result.findingSet.findings.length, 0);
    assert.match(result.findingSet.rulesEvaluated.at(-1)?.detail ?? '', /complete outcome/);
  });

  it('does not let a derived wrapper hide a legacy thin fault outcome', () => {
    const thin = faultInjectionEvidence({
      producer: 'fixture',
      runId: 'run_fault',
      faultKind: 'tool_timeout',
      target: 'planner',
      appliedCount: 1,
    });
    const wrapper = derivedEvidence({
      producer: 'fixture',
      rule: 'summarise-thin-fault',
      inputs: [thin.id],
    });
    const draft: FindingDraft = {
      ruleId: 'resilience-under-injected-fault',
      situation: 'injected-fault-absorbed',
      category: 'resilience',
      polarity: 'strength',
      severity: 'info',
      confidence: 0.99,
      basis: 'simulated',
      title: 'The fault was absorbed',
      explanation: 'The fault was absorbed without intervention.',
      impact: 'The failure mode is handled.',
      components: [graph.graph.components[0]?.id as string],
      claimEvidence: {
        mechanism: [wrapper.id],
        subject: [wrapper.id],
        conclusion: [wrapper.id],
      },
      goalEligible: false,
      goalReason: 'Nothing to change.',
    };
    const result = evaluateRules({
      scanId: 'scan_wrapped_thin_fault',
      generatedAt: '2026-08-22T12:00:00.000Z',
      graph,
      context: {
        ...context(chaos()),
        chaosReports: [],
        evidenceById: new Map([
          [thin.id, thin],
          [wrapper.id, wrapper],
        ]),
      },
      rules: [
        {
          id: draft.ruleId,
          category: draft.category,
          summary: 'fixture',
          evaluate: () => fired([draft]),
        },
      ],
    });
    assert.equal(result.findingSet.findings.length, 0);
    assert.match(result.findingSet.rulesEvaluated.at(-1)?.detail ?? '', /complete outcome/);
  });
});
