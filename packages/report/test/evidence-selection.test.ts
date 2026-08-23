import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { derivedEvidence, spanEvidence } from '@orchescope/domain';
import type { Evidence, EvidenceId, Finding, Goal } from '@orchescope/schema';
import { buildGraph, componentDraft, evidenceForGraph } from '@orchescope/testkit';
import { REPORT_EVIDENCE_CEILING, selectReportEvidence } from '../src/evidence-selection.ts';

const component = componentDraft({ kind: 'agent', name: 'planner', file: 'src/planner.ts' });
const graph = buildGraph([component]);
const source = [...evidenceForGraph(graph).values()][0];
assert.ok(source !== undefined);

const finding = (evidence: readonly EvidenceId[]): Finding => ({ evidence }) as unknown as Finding;

const controlledSpan = (index: number, id?: EvidenceId): Evidence => ({
  id: id ?? (`ev_${index.toString(16).padStart(16, '0')}` as EvidenceId),
  kind: 'span',
  basis: 'observed',
  producer: 'fixture',
  runId: 'run_fixture',
  traceId: index.toString(16).padStart(32, '0'),
  spanId: index.toString(16).padStart(16, '0'),
  spanName: `span-${index}`,
});

describe('report evidence selection', () => {
  it('includes every cited record and its transitive derivation inputs', () => {
    const derived = derivedEvidence({
      producer: 'fixture',
      rule: 'claim',
      inputs: [source.id],
      note: 'bounded claim',
    });
    const selection = selectReportEvidence({
      evidence: [derived, source],
      graph,
      findings: [finding([derived.id])],
      goals: [],
      reconciliation: undefined,
    });
    assert.deepEqual(
      selection.evidence.map((record) => record.id).sort(),
      [derived.id, source.id].sort(),
    );
    assert.equal(selection.coverage.requiredIncluded, 2);
    assert.equal(selection.coverage.omitted, 0);
  });

  it('accounts deterministically for uncited span evidence over the ceiling', () => {
    const spans = Array.from({ length: REPORT_EVIDENCE_CEILING + 2 }, (_unused, index) =>
      spanEvidence({
        producer: 'fixture',
        runId: 'run_fixture',
        traceId: index.toString(16).padStart(32, '0'),
        spanId: index.toString(16).padStart(16, '0'),
        spanName: `span-${index}`,
      }),
    );
    const selection = selectReportEvidence({
      evidence: spans,
      graph: buildGraph([]),
      findings: [],
      goals: [],
      reconciliation: undefined,
    });
    assert.equal(selection.coverage.totalEligible, REPORT_EVIDENCE_CEILING + 2);
    assert.equal(selection.coverage.included, REPORT_EVIDENCE_CEILING);
    assert.equal(selection.coverage.omitted, 2);
    assert.deepEqual(selection.coverage.omissionReasons, [
      { reason: 'uncited_span_over_ceiling', count: 2 },
    ]);
    assert.equal(
      selection.coverage.omissionReasons.reduce((total, entry) => total + entry.count, 0),
      selection.coverage.omitted,
    );
  });

  it('keeps a mandatory high identifier ahead of lower optional evidence at the ceiling', () => {
    const mandatory = controlledSpan(
      REPORT_EVIDENCE_CEILING + 1,
      'ev_ffffffffffffffff' as EvidenceId,
    );
    const optional = Array.from({ length: REPORT_EVIDENCE_CEILING }, (_unused, index) =>
      controlledSpan(index),
    );
    const selection = selectReportEvidence({
      evidence: [...optional, mandatory],
      graph: buildGraph([]),
      findings: [finding([mandatory.id])],
      goals: [],
      reconciliation: undefined,
    });
    assert.equal(
      selection.evidence.some((record) => record.id === mandatory.id),
      true,
    );
    assert.equal(selection.coverage.requiredIncluded, 1);
    assert.equal(selection.coverage.omitted, 1);
  });

  it('refuses when mandatory citations alone exceed the export ceiling', () => {
    const required = Array.from({ length: REPORT_EVIDENCE_CEILING + 1 }, (_unused, index) =>
      controlledSpan(index),
    );
    assert.throws(
      () =>
        selectReportEvidence({
          evidence: required,
          graph: buildGraph([]),
          findings: [finding(required.map((record) => record.id))],
          goals: [],
          reconciliation: undefined,
        }),
      /above the 5000 record export ceiling/,
    );
  });

  it('is invariant to evidence and citation permutations', () => {
    const records = [controlledSpan(1), controlledSpan(2), controlledSpan(3)];
    const select = (ordered: readonly Evidence[], citations: readonly EvidenceId[]) =>
      selectReportEvidence({
        evidence: ordered,
        graph: buildGraph([]),
        findings: [finding(citations)],
        goals: [],
        reconciliation: undefined,
      });
    const forward = select(records, [records[0]?.id, records[2]?.id] as EvidenceId[]);
    const reverse = select([...records].reverse(), [
      records[2]?.id,
      records[0]?.id,
    ] as EvidenceId[]);
    assert.deepEqual(
      reverse.evidence.map((record) => record.id),
      forward.evidence.map((record) => record.id),
    );
    assert.deepEqual(reverse.coverage, forward.coverage);
  });

  it('exports accepted superseded and unattributed span evidence while under the ceiling', () => {
    const superseded = controlledSpan(1);
    const unattributed = controlledSpan(2);
    const selection = selectReportEvidence({
      evidence: [superseded, unattributed],
      graph: buildGraph([]),
      findings: [],
      goals: [],
      reconciliation: undefined,
    });
    assert.deepEqual(
      selection.evidence.map((record) => record.id),
      [superseded.id, unattributed.id],
    );
    assert.equal(selection.coverage.totalEligible, 2);
    assert.equal(selection.coverage.omitted, 0);
  });

  it('refuses a dangling mandatory citation', () => {
    assert.throws(
      () =>
        selectReportEvidence({
          evidence: [source],
          graph,
          findings: [finding(['ev_0000000000000000' as EvidenceId])],
          goals: [],
          reconciliation: undefined,
        }),
      /could not be resolved/,
    );
  });

  it('refuses a genuinely missing historical goal citation', () => {
    assert.throws(
      () =>
        selectReportEvidence({
          evidence: [],
          graph: buildGraph([]),
          findings: [],
          goals: [{ evidence: ['ev_0000000000000000' as EvidenceId] } as unknown as Goal],
          reconciliation: undefined,
        }),
      /could not be resolved/,
    );
  });

  it('refuses a missing dependency beneath a historical goal derivation', () => {
    const derived = derivedEvidence({
      producer: 'fixture',
      rule: 'historical-goal',
      inputs: ['ev_0000000000000000' as EvidenceId],
    });
    assert.throws(
      () =>
        selectReportEvidence({
          evidence: [derived],
          graph: buildGraph([]),
          findings: [],
          goals: [{ evidence: [derived.id] } as unknown as Goal],
          reconciliation: undefined,
        }),
      /could not be resolved/,
    );
  });
});
