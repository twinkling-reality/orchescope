import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { acceptanceVerdict } from '../../scripts/corpus/acceptance.mjs';

const entry = {
  acceptance: {
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
    topology: { status: 'incomplete', unresolvedCount: 1, conditionalDestinations: 1 },
    findings: { strengths: 0, requiredRules: ['topology-shape'] },
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
  findings: [{ polarity: 'risk', ruleId: 'topology-shape' }],
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
      topology: { status: 'incomplete', unresolvedCount: 1, conditionalDestinations: 1 },
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
    changed.findings = [{ polarity: 'strength', ruleId: 'acyclic-topology' }];

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
  });
});
