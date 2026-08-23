import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { acceptanceVerdict } from '../../scripts/corpus/acceptance.mjs';
import { claimDifference } from '../../scripts/corpus/comparison.mjs';

const source = {
  endColumn: 11,
  endLine: 16,
  file: 'main.py',
  fileHash: '5a5026fe20e94206493025a8772dbfb3b03608959bbc90856c8ea5d5720a5ef7',
  startColumn: 5,
  startLine: 16,
};

const acceptance = {
  type: 'completed_zero',
  expectedAgentSystemDetected: false,
  graphPopulation: { components: 0, edges: 0 },
  evidencePopulation: { records: 0 },
  evidenceCoverage: {
    totalEligible: 0,
    included: 0,
    omitted: 0,
    requiredIncluded: 0,
    omissionReasons: [],
  },
  componentMetricPopulation: { records: 0 },
  runtimePopulation: {
    runs: 0,
    observed: { count: 0, runIds: [] },
    silent: { count: 0, runIds: [] },
  },
  adapterOutcomes: {
    'adapter:openai-agents': {
      status: 'completed',
      componentsFound: 0,
      edgesFound: 0,
      filesInspected: 1,
      languages: ['python'],
    },
    'adapter:effects': {
      status: 'completed',
      componentsFound: 0,
      edgesFound: 0,
      filesInspected: 0,
      languages: [],
    },
  },
  unsupported: [
    {
      kind: 'adapter_found_nothing',
      area: 'agents is imported here and its adapter found nothing',
      reason:
        'adapter:openai-agents claims this framework, ran and found no component. Either this build does not read the form this repository uses, or this repository imports the framework as a client and declares nothing an adapter could read.',
    },
  ],
  topology: {
    status: 'incomplete',
    unresolvedCount: 1,
    conditionalDestinations: 0,
    producers: [
      {
        adapterId: 'adapter:openai-agents',
        status: 'incomplete',
        scope: 'control_flow',
        inspectedInputs: 0,
        relationsFound: 0,
      },
    ],
    requiredRefusals: [
      {
        kind: 'adapter_input',
        reason:
          'adapter:openai-agents did not state an inspected topology population for this applicable input.',
        sourceFile: 'main.py',
        startLine: 16,
        fileHash: source.fileHash,
      },
    ],
  },
  findings: { total: 0, strengths: 0 },
};

const entry = { kind: 'agent_system', acceptance };

type Bundle = {
  componentMetrics: { name: string }[];
  evidence: { id: string }[];
  evidenceCoverage: {
    totalEligible: number;
    included: number;
    omitted: number;
    requiredIncluded: number;
    omissionReasons?: { reason: string; count: number }[];
  };
  findings: { polarity: string; ruleId: string; severity: string }[];
  runPopulations: {
    observed: { count: number; runIds?: string[] };
    silent: { count: number; runIds?: string[] };
  };
  runs: { runId: string }[];
  graph: {
    components: { id: string; kind: string }[];
    edges: { kind: string; from: string; to: string }[];
    coverage: {
      adapters: {
        adapterId: string;
        status: string;
        componentsFound: number;
        edgesFound: number;
        filesInspected: number;
        languages: string[];
      }[];
      unsupported: { kind: string; area: string; reason: string }[];
      topology: {
        status: string;
        unresolvedCount: number;
        conditionalDestinations: number;
        producers: {
          adapterId: string;
          status: string;
          scope: string;
          inspectedInputs: number;
          relationsFound: number;
        }[];
        unresolved: {
          kind: string;
          reason: string;
          location: typeof source;
        }[];
      };
    };
  };
};

const bundle = (): Bundle => ({
  componentMetrics: [],
  evidence: [],
  evidenceCoverage: {
    totalEligible: 0,
    included: 0,
    omitted: 0,
    requiredIncluded: 0,
    omissionReasons: [],
  },
  findings: [],
  runPopulations: {
    observed: { count: 0, runIds: [] },
    silent: { count: 0, runIds: [] },
  },
  runs: [],
  graph: {
    components: [],
    edges: [],
    coverage: {
      adapters: [
        {
          adapterId: 'adapter:openai-agents',
          status: 'completed',
          componentsFound: 0,
          edgesFound: 0,
          filesInspected: 1,
          languages: ['python'],
        },
        {
          adapterId: 'adapter:effects',
          status: 'completed',
          componentsFound: 0,
          edgesFound: 0,
          filesInspected: 0,
          languages: [],
        },
      ],
      unsupported: acceptance.unsupported.map((gap) => ({ ...gap })),
      topology: {
        status: 'incomplete',
        unresolvedCount: 1,
        conditionalDestinations: 0,
        producers: acceptance.topology.producers.map((producer) => ({ ...producer })),
        unresolved: [
          {
            kind: 'adapter_input',
            reason: acceptance.topology.requiredRefusals[0]!.reason,
            location: source,
          },
        ],
      },
    },
  },
});

describe('completed-zero corpus acceptance', () => {
  it('accepts the false classification only through the complete semantic verdict', () => {
    const verdict = acceptanceVerdict(entry, bundle());
    assert.deepEqual(verdict, { held: 34, total: 34, broken: [] });
    assert.equal(claimDifference(entry, { agentSystemDetected: false }, verdict), undefined);

    const aggregateOnly = claimDifference(
      entry,
      { agentSystemDetected: false },
      { held: 0, total: 0, broken: [] },
    );
    assert.equal(aggregateOnly?.path, 'agentSystemDetected');
  });

  it('rejects same-population substitutions and every missing completed-zero proof', () => {
    const substitutions: readonly {
      name: string;
      mutate: (changed: Bundle) => void;
    }[] = [
      {
        name: 'component identity',
        mutate: (changed) => changed.graph.components.push({ id: 'agent:guessed', kind: 'agent' }),
      },
      {
        name: 'relation identity',
        mutate: (changed) =>
          changed.graph.edges.push({
            kind: 'invokes_model',
            from: 'agent:guessed',
            to: 'model:guessed',
          }),
      },
      {
        name: 'evidence population',
        mutate: (changed) => changed.evidence.push({ id: 'ev_unbound' }),
      },
      {
        name: 'evidence coverage',
        mutate: (changed) => {
          changed.evidenceCoverage.totalEligible = 1;
        },
      },
      {
        name: 'missing evidence omission reasons',
        mutate: (changed) => {
          changed.evidenceCoverage = {
            totalEligible: changed.evidenceCoverage.totalEligible,
            included: changed.evidenceCoverage.included,
            omitted: changed.evidenceCoverage.omitted,
            requiredIncluded: changed.evidenceCoverage.requiredIncluded,
          };
        },
      },
      {
        name: 'component metric population',
        mutate: (changed) => changed.componentMetrics.push({ name: 'over-scoped' }),
      },
      {
        name: 'run population',
        mutate: (changed) => changed.runs.push({ runId: 'run_unbounded' }),
      },
      {
        name: 'observed run count',
        mutate: (changed) => {
          changed.runPopulations.observed.count = 1;
        },
      },
      {
        name: 'silent run ID without a count',
        mutate: (changed) => changed.runPopulations.silent.runIds?.push('run_unbounded'),
      },
      {
        name: 'missing observed run IDs',
        mutate: (changed) => {
          changed.runPopulations.observed = {
            count: changed.runPopulations.observed.count,
          };
        },
      },
      {
        name: 'missing silent run IDs',
        mutate: (changed) => {
          changed.runPopulations.silent = {
            count: changed.runPopulations.silent.count,
          };
        },
      },
      {
        name: 'OpenAI Agents outcome',
        mutate: (changed) => {
          changed.graph.coverage.adapters[0]!.filesInspected = 0;
        },
      },
      {
        name: 'effects outcome',
        mutate: (changed) => {
          changed.graph.coverage.adapters.splice(1, 1);
        },
      },
      {
        name: 'unsupported explanation',
        mutate: (changed) => {
          changed.graph.coverage.unsupported[0]!.reason = 'A substituted explanation.';
        },
      },
      {
        name: 'topology producer',
        mutate: (changed) => {
          changed.graph.coverage.topology.producers[0]!.relationsFound = 1;
        },
      },
      {
        name: 'topology evidence',
        mutate: (changed) => {
          changed.graph.coverage.topology.unresolved[0]!.location = {
            ...source,
            fileHash: 'b'.repeat(64),
          };
        },
      },
      {
        name: 'finding population',
        mutate: (changed) =>
          changed.findings.push({ polarity: 'risk', ruleId: 'substituted', severity: 'info' }),
      },
    ];

    for (const substitution of substitutions) {
      const changed = bundle();
      substitution.mutate(changed);
      const verdict = acceptanceVerdict(entry, changed);
      assert.ok(verdict.broken.length > 0, `${substitution.name} did not break acceptance`);
      assert.equal(
        claimDifference(entry, { agentSystemDetected: false }, verdict)?.path,
        'agentSystemDetected',
        `${substitution.name} suppressed the classification mismatch`,
      );
    }
  });
});
