/// <reference types="node" />

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Edge } from '@orchescope/schema';
import {
  buildBarRows,
  buildMetricRows,
  countValues,
  distinctValues,
  EMPTY_FINDING_FILTER,
  filterComponents,
  filterEdges,
  filterFindings,
  groupByReason,
  matchesQuery,
  sortFindings,
  sortFindingsForAction,
  sortMetricRows,
} from '../src/presentation/filters.ts';
import { component, finding, metrics } from './fixture.ts';

describe('matchesQuery', () => {
  it('treats an empty query as matching everything', () => {
    assert.equal(matchesQuery('anything', ''), true);
    assert.equal(matchesQuery('anything', '   '), true);
  });

  it('is case insensitive and matches inside words', () => {
    assert.equal(matchesQuery('OrchestratorAgent', 'strator'), true);
    assert.equal(matchesQuery('OrchestratorAgent', 'AGENT'), true);
    assert.equal(matchesQuery('OrchestratorAgent', 'worker'), false);
  });
});

describe('filterFindings', () => {
  const findings = [
    finding({
      id: 'OSC-PERF-0001',
      severity: 'critical',
      category: 'performance',
      basis: 'observed',
    }),
    finding({
      id: 'OSC-SEC-0002',
      severity: 'low',
      category: 'security',
      polarity: 'strength',
      basis: 'discovered',
    }),
    finding({ id: 'OSC-RELY-0003', severity: 'high', category: 'reliability', basis: 'inferred' }),
  ];

  it('returns everything when no facet is selected', () => {
    assert.equal(filterFindings(findings, EMPTY_FINDING_FILTER).length, 3);
  });

  it('filters by severity, category, polarity and basis independently', () => {
    assert.deepEqual(
      filterFindings(findings, { ...EMPTY_FINDING_FILTER, severities: ['critical'] }).map(
        (f) => f.id,
      ),
      ['OSC-PERF-0001'],
    );
    assert.deepEqual(
      filterFindings(findings, { ...EMPTY_FINDING_FILTER, categories: ['security'] }).map(
        (f) => f.id,
      ),
      ['OSC-SEC-0002'],
    );
    assert.deepEqual(
      filterFindings(findings, { ...EMPTY_FINDING_FILTER, polarities: ['strength'] }).map(
        (f) => f.id,
      ),
      ['OSC-SEC-0002'],
    );
    assert.deepEqual(
      filterFindings(findings, { ...EMPTY_FINDING_FILTER, bases: ['inferred'] }).map((f) => f.id),
      ['OSC-RELY-0003'],
    );
    assert.deepEqual(
      filterFindings(findings, {
        ...EMPTY_FINDING_FILTER,
        goalReadiness: ['eligible'],
      }).map((f) => f.id),
      findings.filter((entry) => entry.goalReadiness.eligible).map((entry) => entry.id),
    );
  });

  it('combines facets with and, not or', () => {
    assert.deepEqual(
      filterFindings(findings, {
        ...EMPTY_FINDING_FILTER,
        severities: ['critical'],
        categories: ['security'],
      }),
      [],
    );
  });

  it('treats several values in one facet as or', () => {
    assert.equal(
      filterFindings(findings, { ...EMPTY_FINDING_FILTER, severities: ['critical', 'high'] })
        .length,
      2,
    );
  });

  it('searches the identifier, the title, the components and the tags', () => {
    const searchable = [
      finding({ id: 'OSC-PERF-0009', components: ['tool:refund'], tags: ['retry'] }),
      finding({ id: 'OSC-PERF-0010', title: 'Unbounded queue' }),
    ];
    assert.deepEqual(
      filterFindings(searchable, { ...EMPTY_FINDING_FILTER, query: 'refund' }).map((f) => f.id),
      ['OSC-PERF-0009'],
    );
    assert.deepEqual(
      filterFindings(searchable, { ...EMPTY_FINDING_FILTER, query: 'retry' }).map((f) => f.id),
      ['OSC-PERF-0009'],
    );
    assert.deepEqual(
      filterFindings(searchable, { ...EMPTY_FINDING_FILTER, query: 'queue' }).map((f) => f.id),
      ['OSC-PERF-0010'],
    );
  });
});

describe('sortFindings', () => {
  it('orders by severity, then confidence, then identifier', () => {
    const sorted = sortFindings([
      finding({ id: 'OSC-AAA-0003', severity: 'low', confidence: 0.9 }),
      finding({ id: 'OSC-AAA-0002', severity: 'critical', confidence: 0.5 }),
      finding({ id: 'OSC-AAA-0001', severity: 'critical', confidence: 0.9 }),
      finding({ id: 'OSC-AAA-0004', severity: 'critical', confidence: 0.9 }),
    ]);
    assert.deepEqual(
      sorted.map((f) => f.id),
      ['OSC-AAA-0001', 'OSC-AAA-0004', 'OSC-AAA-0002', 'OSC-AAA-0003'],
    );
  });

  it('does not mutate its input', () => {
    const input = [
      finding({ id: 'OSC-AAA-0002', severity: 'low' }),
      finding({ id: 'OSC-AAA-0001' }),
    ];
    const snapshot = input.map((f) => f.id);
    sortFindings(input);
    assert.deepEqual(
      input.map((f) => f.id),
      snapshot,
    );
  });
});

describe('sortFindingsForAction', () => {
  it('puts goal eligible work before a more severe finding that cannot be verified yet', () => {
    const sorted = sortFindingsForAction([
      finding({
        id: 'OSC-AAA-0001',
        severity: 'critical',
        goalReadiness: {
          eligible: false,
          reason: 'needs a design decision',
          requiresRuntimeEvidence: false,
          requiresHumanReview: true,
        },
      }),
      finding({ id: 'OSC-AAA-0002', severity: 'medium' }),
    ]);
    assert.deepEqual(
      sorted.map((entry) => entry.id),
      ['OSC-AAA-0002', 'OSC-AAA-0001'],
    );
  });
});

describe('countValues and distinctValues', () => {
  it('counts and lists distinct values in a stable order', () => {
    const findings = [
      finding({ id: 'OSC-A-0001', category: 'security' }),
      finding({ id: 'OSC-A-0002', category: 'performance' }),
      finding({ id: 'OSC-A-0003', category: 'security' }),
    ];
    assert.equal(countValues(findings, (f) => f.category).get('security'), 2);
    assert.deepEqual(
      distinctValues(findings, (f) => f.category),
      ['performance', 'security'],
    );
  });
});

describe('filterComponents', () => {
  const components = [
    component({ id: 'agent:planner', kind: 'agent', displayName: 'Planner' }),
    component({ id: 'tool:refund', kind: 'tool', displayName: 'Refund', tags: ['financial'] }),
    component({
      id: 'model:gpt',
      kind: 'model',
      displayName: 'Model',
      sourceLocations: [{ file: 'src/model.ts', startLine: 1 }],
    }),
  ];

  it('filters by kind', () => {
    assert.deepEqual(
      filterComponents(components, { query: '', kinds: ['tool'] }).map((c) => c.id),
      ['tool:refund'],
    );
  });

  it('searches names, identifiers, tags and file paths', () => {
    assert.deepEqual(
      filterComponents(components, { query: 'plann', kinds: [] }).map((c) => c.id),
      ['agent:planner'],
    );
    assert.deepEqual(
      filterComponents(components, { query: 'financial', kinds: [] }).map((c) => c.id),
      ['tool:refund'],
    );
    assert.deepEqual(
      filterComponents(components, { query: 'src/model.ts', kinds: [] }).map((c) => c.id),
      ['model:gpt'],
    );
  });

  it('applies the kind and the query together', () => {
    assert.deepEqual(filterComponents(components, { query: 'plann', kinds: ['tool'] }), []);
  });
});

describe('filterEdges', () => {
  const edge = (id: string, kind: Edge['kind'], from: string, to: string): Edge => ({
    id,
    kind,
    from,
    to,
    basis: 'discovered',
    confidence: 1,
    discoveredBy: ['adapter:test'],
    sourceLocations: [],
    configLocations: [],
    evidence: [],
    runtimeOnly: false,
    metadata: {},
  });
  const edges = [
    edge('calls_tool:0000000000000001', 'calls_tool', 'agent:a', 'tool:t'),
    edge('hands_off_to:0000000000000002', 'hands_off_to', 'agent:a', 'agent:b'),
  ];

  it('drops an edge whose endpoint is filtered out', () => {
    const visible = new Set(['agent:a', 'tool:t']);
    assert.deepEqual(
      filterEdges(edges, [], visible).map((e) => e.id),
      ['calls_tool:0000000000000001'],
    );
  });

  it('filters by edge kind as well', () => {
    const visible = new Set(['agent:a', 'agent:b', 'tool:t']);
    assert.deepEqual(
      filterEdges(edges, ['hands_off_to'], visible).map((e) => e.id),
      ['hands_off_to:0000000000000002'],
    );
  });
});

describe('metric rows', () => {
  const rows = buildMetricRows(
    [
      metrics({
        componentId: 'agent:a',
        selfDurationMs: 30,
        totalDurationMs: 90,
        executionCount: 3,
        inputTokens: 10,
        outputTokens: 5,
        errorCount: 1,
      }),
      metrics({
        componentId: 'tool:b',
        selfDurationMs: 5,
        totalDurationMs: 5,
        executionCount: 12,
        costUsd: 0.5,
      }),
      metrics({
        componentId: 'model:c',
        selfDurationMs: 30,
        totalDurationMs: 40,
        executionCount: 1,
      }),
    ],
    (componentId) => ({
      displayName: componentId.split(':')[1] ?? componentId,
      kind: componentId.split(':')[0] ?? '',
    }),
  );

  it('sums the token columns and keeps unmeasured cost as null, not zero', () => {
    const agent = rows.find((row) => row.componentId === 'agent:a');
    assert.equal(agent?.tokens, 15);
    assert.equal(agent?.costUsd, null);
    assert.equal(rows.find((row) => row.componentId === 'tool:b')?.costUsd, 0.5);
  });

  it('sorts numerically in both directions', () => {
    assert.deepEqual(
      sortMetricRows(rows, 'executionCount', false).map((row) => row.componentId),
      ['tool:b', 'agent:a', 'model:c'],
    );
    assert.deepEqual(
      sortMetricRows(rows, 'executionCount', true).map((row) => row.componentId),
      ['model:c', 'agent:a', 'tool:b'],
    );
  });

  it('breaks ties on the component identifier so the order never flickers', () => {
    assert.deepEqual(
      sortMetricRows(rows, 'selfDurationMs', false)
        .filter((row) => row.selfDurationMs === 30)
        .map((row) => row.componentId),
      ['agent:a', 'model:c'],
    );
  });

  it('sorts by name as text', () => {
    assert.deepEqual(
      sortMetricRows(rows, 'displayName', true).map((row) => row.displayName),
      ['a', 'b', 'c'],
    );
  });

  it('sorts unmeasured cost below every measured value', () => {
    const sorted = sortMetricRows(rows, 'costUsd', false);
    assert.equal(sorted[0]?.componentId, 'tool:b');
  });

  it('does not mutate its input', () => {
    const before = rows.map((row) => row.componentId);
    sortMetricRows(rows, 'tokens', true);
    assert.deepEqual(
      rows.map((row) => row.componentId),
      before,
    );
  });
});

describe('buildBarRows', () => {
  it('sorts descending and expresses each value as a share of the largest', () => {
    const bars = buildBarRows(
      [
        { componentId: 'a', value: 25 },
        { componentId: 'b', value: 100 },
        { componentId: 'c', value: 50 },
      ],
      (id) => id.toUpperCase(),
    );
    assert.deepEqual(
      bars.map((bar) => bar.componentId),
      ['b', 'c', 'a'],
    );
    assert.equal(bars[0]?.share, 1);
    assert.equal(bars[1]?.share, 0.5);
    assert.equal(bars[0]?.label, 'B');
  });

  it('gives every row a zero share when every value is zero', () => {
    const bars = buildBarRows([{ componentId: 'a', value: 0 }], () => 'A');
    assert.equal(bars[0]?.share, 0);
  });

  it('drops non finite values', () => {
    const bars = buildBarRows(
      [
        { componentId: 'a', value: Number.NaN },
        { componentId: 'b', value: 1 },
      ],
      (id) => id,
    );
    assert.deepEqual(
      bars.map((bar) => bar.componentId),
      ['b'],
    );
  });
});

describe('groupByReason', () => {
  it('counts by reason, keeps a bounded sample and orders by count', () => {
    const groups = groupByReason([
      { reason: 'too_large', file: 'a.ts' },
      { reason: 'binary', file: 'b.png' },
      { reason: 'too_large', file: 'c.ts' },
      { reason: 'too_large', file: 'd.ts' },
      { reason: 'too_large', file: 'e.ts' },
      { reason: 'too_large', file: 'f.ts' },
      { reason: 'too_large', file: 'g.ts' },
    ]);
    assert.equal(groups[0]?.reason, 'too_large');
    assert.equal(groups[0]?.count, 6);
    assert.equal(groups[0]?.examples.length, 5);
    assert.equal(groups[1]?.reason, 'binary');
  });

  it('returns nothing for an empty list', () => {
    assert.deepEqual(groupByReason([]), []);
  });
});
