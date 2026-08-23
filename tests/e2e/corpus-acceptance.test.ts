import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { acceptanceVerdict } from '../../scripts/corpus/acceptance.mjs';

const entry = {
  acceptance: {
    graphPopulation: { components: 1, edges: 1 },
    exactIdsByKind: { agent: ['agent:a'] },
    absentKinds: ['database'],
    absentComponentTerms: ['postgres'],
    requiredEdges: [
      {
        kind: 'hands_off_to',
        from: 'agent:a',
        to: 'agent:a',
        sourceFile: 'src/graph.py',
        evidence: [
          {
            producer: 'adapter:langgraph',
            symbol: 'add_edge',
            sourceFile: 'src/graph.py',
            startLine: 1,
            endLine: 1,
          },
        ],
      },
    ],
    componentMetadata: { 'agent:a': { configurationDefault: true } },
    componentEvidence: {
      'agent:a': [
        {
          producer: 'adapter:langgraph',
          symbol: 'agent',
          sourceFile: 'src/graph.py',
          startLine: 1,
          endLine: 1,
        },
      ],
    },
    sourceCitations: { 'agent:a': ['src/graph.py'] },
    adapterApplicability: {
      'adapter:model-sdk': {
        relevantImports: 2,
        distinctFiles: 1,
        omittedImports: 0,
        fileSample: [
          { module: 'models', imported: 'Model', sourceFile: 'src/graph.py', startLine: 1 },
        ],
      },
    },
    topology: {
      status: 'incomplete',
      unresolvedCount: 1,
      conditionalDestinations: 1,
      requiredRefusals: [
        {
          kind: 'conditional_destination',
          reason: 'A dynamic router has no settled destination.',
          sourceFile: 'src/graph.py',
          startLine: 1,
        },
      ],
    },
    findings: {
      strengths: 0,
      requiredRules: ['topology-shape'],
      exactRisks: [{ ruleId: 'topology-shape', severity: 'low' }],
    },
  },
};

const source = {
  endColumn: 1,
  endLine: 1,
  file: 'src/graph.py',
  fileHash: 'a'.repeat(64),
  startColumn: 0,
  startLine: 1,
};

const bundle = () => ({
  evidence: [
    {
      id: 'ev_agent',
      kind: 'source_span',
      producer: 'adapter:langgraph',
      symbol: 'agent',
      location: source,
    },
    {
      id: 'ev_edge',
      kind: 'source_span',
      producer: 'adapter:langgraph',
      symbol: 'add_edge',
      location: source,
    },
  ],
  findings: [{ polarity: 'risk', ruleId: 'topology-shape', severity: 'low' }],
  graph: {
    components: [
      {
        id: 'agent:a',
        kind: 'agent',
        metadata: { configurationDefault: true },
        sourceLocations: [source],
        evidence: ['ev_agent'],
      },
    ],
    edges: [
      {
        kind: 'hands_off_to',
        from: 'agent:a',
        to: 'agent:a',
        sourceLocations: [source],
        evidence: ['ev_edge'],
      },
    ],
    coverage: {
      adapters: [
        {
          adapterId: 'adapter:model-sdk',
          applicability: {
            relevantImports: 2,
            distinctFiles: 1,
            omittedImports: 0,
            sample: [
              {
                module: 'models',
                imported: 'Model',
                location: { file: 'src/graph.py', startLine: 1 },
              },
            ],
          },
        },
      ],
      topology: {
        status: 'incomplete',
        unresolvedCount: 1,
        conditionalDestinations: 1,
        unresolved: [
          {
            kind: 'conditional_destination',
            reason: 'A dynamic router has no settled destination.',
            location: source,
          },
        ],
      },
    },
  },
});

describe('corpus semantic acceptance', () => {
  it('holds identities, evidence, applicability and topology outside recordable totals', () => {
    const verdict = acceptanceVerdict(entry, bundle());
    assert.ok(verdict.total >= 15, `only ${verdict.total} assertions were configured`);
    assert.equal(verdict.held, verdict.total);
    assert.deepEqual(verdict.broken, []);
  });

  it('rejects same-sized semantic substitutions and evidence-free claims', () => {
    const changed = bundle();
    changed.graph.components = [
      {
        id: 'database:postgres',
        kind: 'database',
        metadata: { configurationDefault: false },
        sourceLocations: [source],
        evidence: [],
      },
    ];
    changed.graph.edges = [];
    changed.graph.coverage.adapters[0]!.applicability.relevantImports = 1;
    changed.graph.coverage.topology.status = 'complete';
    changed.findings = [{ polarity: 'strength', ruleId: 'acyclic-topology', severity: 'info' }];

    const broken = acceptanceVerdict(entry, changed).broken.join('\n');
    assert.match(broken, /agent identities/);
    assert.match(broken, /component kind database/);
    assert.match(broken, /contained postgres/);
    assert.match(broken, /agent:a -> agent:a was absent/);
    assert.match(broken, /component agent:a was absent/);
    assert.match(broken, /applicability.relevantImports/);
    assert.match(broken, /topology.status/);
    assert.match(broken, /reported 1 strengths/);
    assert.match(broken, /finding rule topology-shape was absent/);
    assert.match(broken, /risk findings were/);
  });

  it('rejects substituted relation evidence while component and edge totals stay fixed', () => {
    const changed = bundle();
    changed.evidence[1]!.symbol = 'nearby_component';

    const verdict = acceptanceVerdict(entry, changed);
    assert.equal(changed.graph.components.length, bundle().graph.components.length);
    assert.equal(changed.graph.edges.length, bundle().graph.edges.length);
    assert.match(verdict.broken.join('\n'), /lacked adapter:langgraph evidence add_edge/);
  });

  it('rejects a same-count risk substitution by exact rule and severity', () => {
    const changed = bundle();
    changed.findings = [{ polarity: 'risk', ruleId: 'topology-shape', severity: 'info' }];

    const broken = acceptanceVerdict(entry, changed).broken.join('\n');
    assert.match(broken, /risk findings were/);
    assert.doesNotMatch(broken, /finding rule topology-shape was absent/);
  });

  it('rejects a substituted refusal while aggregate topology counts stay fixed', () => {
    const changed = bundle();
    changed.graph.coverage.topology.unresolved[0]!.reason = 'A different refusal.';

    const broken = acceptanceVerdict(entry, changed).broken.join('\n');
    assert.match(broken, /topology refusal conditional_destination/);
    assert.doesNotMatch(broken, /topology.unresolvedCount/);
  });

  it('rejects extra components or relations outside the declared exact populations', () => {
    const changed = bundle();
    changed.graph.components.push({
      id: 'tool:extra',
      kind: 'tool',
      metadata: { configurationDefault: false },
      sourceLocations: [source],
      evidence: ['ev_agent'],
    });
    changed.graph.edges.push({
      kind: 'hands_off_to',
      from: 'agent:a',
      to: 'tool:extra',
      sourceLocations: [source],
      evidence: ['ev_edge'],
    });

    const broken = acceptanceVerdict(entry, changed).broken.join('\n');
    assert.match(broken, /graph had 2 components, expected 1/);
    assert.match(broken, /graph had 2 edges, expected 1/);
  });
});
