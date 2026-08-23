import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { metricEvidence, sourceSpanEvidence } from '@orchescope/domain';
import { indexGraph } from '@orchescope/graph';
import type { Evidence, EvidenceId } from '@orchescope/schema';
import { buildGraph, componentDraft, evidenceForGraph } from '@orchescope/testkit';
import { evaluateRules } from '../src/engine.ts';
import { fired, type FindingDraft, type Rule } from '../src/rule.ts';

const component = componentDraft({ kind: 'agent', name: 'planner', file: 'src/planner.ts' });
const graph = indexGraph(buildGraph([component]));
const componentId = graph.graph.components[0]?.id as string;
const componentEvidence = graph.graph.components[0]?.evidence[0] as EvidenceId;

const draft = (claimEvidence: FindingDraft['claimEvidence']): FindingDraft => ({
  ruleId: 'claim-fixture',
  situation: 'claim-fixture',
  category: 'reliability',
  polarity: 'risk',
  severity: 'low',
  confidence: 0.9,
  basis: 'discovered',
  title: 'A bounded claim',
  explanation: 'A bounded claim with separately supported clauses.',
  impact: 'The evidence boundary is visible.',
  components: [componentId],
  claimEvidence,
  goalEligible: false,
  goalReason: 'Fixture.',
});

const evaluate = (drafts: readonly FindingDraft[], evidence: readonly Evidence[]) => {
  const rule: Rule = {
    id: 'claim-fixture',
    category: 'reliability',
    summary: 'fixture',
    evaluate: () => fired(drafts),
  };
  return evaluateRules({
    scanId: 'scan_claim_evidence',
    generatedAt: '2026-08-22T12:00:00.000Z',
    graph,
    context: {
      delta: undefined,
      observedRuns: [],
      silentRuns: [],
      benchmarks: [],
      chaosReports: [],
      scenarios: [],
      evidenceById: new Map(evidence.map((record) => [record.id, record])),
    },
    rules: [rule],
  });
};

describe('finding claim evidence', () => {
  it('refuses empty and dangling material clauses with a recorded reason', () => {
    const known = [...evidenceForGraph(graph.graph).values()];
    const empty = evaluate(
      [
        draft({
          mechanism: [componentEvidence],
          subject: [],
          conclusion: [componentEvidence],
        }),
      ],
      known,
    );
    assert.equal(empty.findingSet.findings.length, 0);
    assert.match(empty.findingSet.rulesEvaluated.at(-1)?.detail ?? '', /subject clause/);

    const dangling = evaluate(
      [
        draft({
          mechanism: [componentEvidence],
          subject: [componentEvidence],
          conclusion: ['ev_0000000000000000' as EvidenceId],
        }),
      ],
      known,
    );
    assert.equal(dangling.findingSet.findings.length, 0);
    assert.match(dangling.findingSet.rulesEvaluated.at(-1)?.detail ?? '', /could not be resolved/);
  });

  it('derives source locations only from bound evidence and keeps their order canonical', () => {
    const proof = sourceSpanEvidence({
      producer: 'fixture',
      location: { file: 'src/proof.ts', startLine: 7 },
      symbol: 'proof',
    });
    const known = [...evidenceForGraph(graph.graph).values(), proof];
    const claim = draft({
      mechanism: [proof.id],
      subject: [proof.id],
      conclusion: [proof.id],
    });
    const first = evaluate([claim], known).findingSet.findings[0];
    const permuted = evaluate(
      [
        {
          ...claim,
          claimEvidence: {
            mechanism: [proof.id],
            subject: [proof.id],
            conclusion: [proof.id],
          },
        },
      ],
      [...known].reverse(),
    ).findingSet.findings[0];
    assert.deepEqual(first?.sourceLocations, [{ file: 'src/proof.ts', startLine: 7 }]);
    assert.deepEqual(permuted?.sourceLocations, first?.sourceLocations);
    assert.deepEqual(permuted?.evidence, first?.evidence);
  });

  it('accepts one structured population record supplied by a non-representative grouped draft', () => {
    const records = Array.from({ length: 101 }, (_unused, index) =>
      sourceSpanEvidence({
        producer: 'fixture',
        location: { file: `src/items/${index}.ts`, startLine: 1 },
        symbol: `item_${index}`,
      }),
    );
    const population = metricEvidence({
      producer: 'fixture',
      runIds: ['run_population'],
      metric: 'grouped_positive_population',
      value: 101,
      unit: 'item',
      sampleSize: 101,
      basis: 'discovered',
    });
    const drafts = records.map(
      (record, index): FindingDraft => ({
        ...draft({
          mechanism: [record.id],
          subject: [record.id],
          conclusion: [record.id],
        }),
        occurrence: { key: 'population', groupedTitle: '{count} bounded claims' },
        components: [componentId],
        ...(index === records.length - 1
          ? {
              newEvidence: [population],
              claimPopulationEvidence: {
                mechanism: population.id,
                subject: population.id,
                conclusion: population.id,
              },
            }
          : {}),
      }),
    );
    const result = evaluate(drafts, [...evidenceForGraph(graph.graph).values(), ...records]);
    assert.equal(result.findingSet.findings.length, 1);
    assert.deepEqual(result.findingSet.findings[0]?.evidence, [population.id]);
    assert.equal(
      result.findingSet.findings[0]?.metrics.find((metric) => metric.name === 'occurrences')?.value,
      101,
    );
  });
});
