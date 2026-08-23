import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { indexGraph } from '@orchescope/graph';
import type { EvidenceId, Finding } from '@orchescope/schema';
import { buildGraph, componentDraft, edgeDraft } from '@orchescope/testkit';
import { evaluateRules } from '../src/engine.ts';
import { fired, type FindingDraft, type Rule } from '../src/rule.ts';

const planner = componentDraft({ kind: 'agent', name: 'planner', file: 'src/planner.ts' });
const primary = componentDraft({ kind: 'model', name: 'primary', file: 'src/models.ts' });
const secondary = componentDraft({ kind: 'model', name: 'secondary', file: 'src/models.ts' });
const graph = indexGraph(
  buildGraph(
    [planner, primary, secondary],
    [edgeDraft('invokes_model', planner, primary), edgeDraft('invokes_model', planner, secondary)],
  ),
);

const componentIds = graph.graph.components.map((component) => component.id);
const plannerId = componentIds.find((id) => id.includes('planner')) as string;
const primaryId = componentIds.find((id) => id.includes('primary')) as string;
const secondaryId = componentIds.find((id) => id.includes('secondary')) as string;
const edgeIds = graph.graph.edges.map((edge) => edge.id);
const evidence = [...planner.evidence, ...primary.evidence, ...secondary.evidence];
const primaryEvidenceId = primary.evidence[0]?.id as EvidenceId;
const secondaryEvidenceId = secondary.evidence[0]?.id as EvidenceId;
const claim = (...ids: readonly EvidenceId[]) => ({
  mechanism: ids,
  subject: ids,
  conclusion: ids,
});

const draft = (overrides: Partial<FindingDraft> = {}): FindingDraft => ({
  ruleId: 'model-call-without-timeout',
  situation: 'model-call-without-timeout',
  category: 'reliability',
  polarity: 'risk',
  severity: 'medium',
  confidence: 0.85,
  basis: 'discovered',
  title: 'Primary has no timeout',
  explanation: 'The call carries no timeout.',
  impact: 'A provider can hold the run open.',
  components: [plannerId, primaryId],
  edges: [edgeIds[0] as string],
  claimEvidence: claim(primaryEvidenceId),
  remediationVariant: 'client',
  goalEligible: true,
  goalReason: 'One bounded client setting.',
  ...overrides,
});

const ruleFor = (id: string, drafts: readonly FindingDraft[]): Rule => ({
  id,
  category: drafts[0]?.category ?? 'reliability',
  summary: id,
  evaluate: () => fired(drafts),
});

const evaluate = (
  rules: readonly Rule[],
  generatedAt = '2026-08-22T12:00:00.000Z',
): readonly Finding[] =>
  evaluateRules({
    scanId: 'scan_semantic_identity',
    generatedAt,
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
    rules,
  }).findingSet.findings;

const byRule = (findings: readonly Finding[], ruleId: string): Finding => {
  const finding = findings.find((entry) => entry.ruleId === ruleId);
  assert.ok(finding !== undefined, `no finding from ${ruleId}`);
  return finding;
};

describe('finding engine semantic identity', () => {
  it('does not change an existing identifier when an unrelated finding is added', () => {
    const selected = ruleFor('model-call-without-timeout', [draft()]);
    const before = byRule(evaluate([selected]), selected.id);
    const unrelatedDraft = draft({
      ruleId: 'runtime-only-component',
      situation: 'runtime-component-without-declaration',
      category: 'architecture',
      components: [secondaryId],
      edges: [],
      claimEvidence: claim(secondaryEvidenceId),
    });
    const after = byRule(
      evaluate([ruleFor(unrelatedDraft.ruleId, [unrelatedDraft]), selected]),
      selected.id,
    );
    assert.equal(after.id, before.id);
    assert.notEqual(
      byRule(
        evaluate([ruleFor(unrelatedDraft.ruleId, [unrelatedDraft]), selected]),
        unrelatedDraft.ruleId,
      ).id,
      before.id,
      'runtime evidence gave an existing handle to another rule and subject',
    );
  });

  it('separates a strength from a risk over the same rule, situation and subject', () => {
    const findings = evaluate([
      ruleFor('model-call-without-timeout', [
        draft(),
        draft({ polarity: 'strength', severity: 'info', goalEligible: false }),
      ]),
    ]);
    assert.equal(findings.length, 2);
    assert.notEqual(findings[0]?.id, findings[1]?.id);
  });

  it('keeps two simultaneous subjects from one rule distinct', () => {
    const findings = evaluate([
      ruleFor('model-call-without-timeout', [
        draft(),
        draft({
          title: 'Secondary has no timeout',
          components: [plannerId, secondaryId],
          edges: [edgeIds[1] as string],
          claimEvidence: claim(secondaryEvidenceId),
        }),
      ]),
    ]);
    assert.equal(findings.length, 2);
    assert.notEqual(findings[0]?.id, findings[1]?.id);
  });

  it('ignores component, edge and evidence order as well as prose, severity and time', () => {
    const firstDraft = draft({
      edges: [...edgeIds],
      claimEvidence: claim(primaryEvidenceId, secondaryEvidenceId),
    });
    const first = evaluate([ruleFor('model-call-without-timeout', [firstDraft])])[0] as Finding;
    const reordered = evaluate(
      [
        ruleFor('model-call-without-timeout', [
          draft({
            title: 'Reworded title',
            explanation: 'Reworded explanation.',
            severity: 'high',
            components: [primaryId, plannerId],
            edges: [...edgeIds].reverse(),
            claimEvidence: claim(secondaryEvidenceId, primaryEvidenceId),
          }),
        ]),
      ],
      '2026-08-23T12:00:00.000Z',
    )[0] as Finding;
    assert.equal(reordered.id, first.id);
  });

  it('uses a grouped occurrence key instead of its expanding affected population', () => {
    const occurrence = { key: 'no-timeout', groupedTitle: '{count} models have no timeout' };
    const first = evaluate([
      ruleFor('model-call-without-timeout', [draft({ occurrence })]),
    ])[0] as Finding;
    const expanded = evaluate([
      ruleFor('model-call-without-timeout', [
        draft({ occurrence }),
        draft({
          occurrence,
          components: [plannerId, secondaryId],
          edges: [edgeIds[1] as string],
          claimEvidence: claim(secondaryEvidenceId),
        }),
      ]),
    ])[0] as Finding;
    assert.equal(expanded.id, first.id);
    assert.equal(expanded.metrics.find((metric) => metric.name === 'occurrences')?.value, 2);
  });

  it('uses an explicit whole-system subject instead of a bounded display sample', () => {
    const first = evaluate([
      ruleFor('coverage', [
        draft({
          ruleId: 'coverage',
          situation: 'coverage-low',
          wholeSystemSubject: 'runtime-coverage',
          components: [primaryId],
        }),
      ]),
    ])[0] as Finding;
    const resampled = evaluate([
      ruleFor('coverage', [
        draft({
          ruleId: 'coverage',
          situation: 'coverage-low',
          wholeSystemSubject: 'runtime-coverage',
          components: [secondaryId, plannerId],
        }),
      ]),
    ])[0] as Finding;
    assert.equal(resampled.id, first.id);
  });
});
