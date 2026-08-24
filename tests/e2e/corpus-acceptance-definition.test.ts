import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readCorpus, readCorpusDocument } from '../../scripts/corpus/definition.mjs';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const acceptance = {
  exactIdsByKind: { agent: ['agent:measured'] },
  absentKinds: ['database'],
  absentComponentTerms: ['postgres'],
  requiredEdges: [
    {
      kind: 'hands_off_to',
      from: 'agent:measured',
      to: 'agent:measured',
      sourceFile: 'src/graph.ts',
      evidence: [
        {
          producer: 'adapter:example',
          symbol: 'route',
          sourceFile: 'src/graph.ts',
          startLine: 1,
          endLine: 1,
        },
      ],
    },
  ],
  componentMetadata: { 'agent:measured': { framework: 'example' } },
  componentEvidence: {
    'agent:measured': [
      {
        producer: 'adapter:example',
        symbol: 'agent',
        sourceFile: 'src/graph.ts',
        startLine: 1,
        endLine: 1,
      },
    ],
  },
  sourceCitations: { 'agent:measured': ['src/graph.ts'] },
  adapterApplicability: {
    'adapter:example': {
      relevantImports: 1,
      distinctFiles: 1,
      omittedImports: 0,
      fileSample: [
        { module: 'example', imported: 'Agent', sourceFile: 'src/graph.ts', startLine: 1 },
      ],
    },
  },
  topology: {
    status: 'incomplete',
    unresolvedCount: 2,
    conditionalDestinations: 1,
    configurationBoundFacts: [
      {
        kind: 'invocation_ceiling',
        name: 'recursion_limit',
        value: 10,
        declarationFile: 'src/graph.ts',
        declarationLine: 1,
        referenceFile: 'src/graph.ts',
        referenceLine: 1,
      },
    ],
    producerPopulations: [
      {
        adapterId: 'adapter:example',
        status: 'incomplete',
        inspectedInputs: 1,
        relationsFound: 1,
      },
    ],
    requiredUnlocatedRefusals: [
      {
        kind: 'adapter_input',
        reason: 'The adapter did not state an inspected topology population.',
      },
    ],
  },
  findings: { strengths: 0, requiredRules: ['topology-shape'] },
};

const validEntry = {
  name: 'measured-repository',
  source: 'git',
  url: 'https://github.com/example/measured-repository.git',
  commit: '1'.repeat(40),
  kind: 'agent_system',
  why: 'It is a bounded real repository.',
  acceptance,
};

const readTemporary = (entry: object) => {
  const prefix = join(tmpdir(), 'orchescope-acceptance-definition-');
  const root = mkdtempSync(prefix);
  if (!root.startsWith(prefix)) throw new Error('unexpected temporary corpus root');
  try {
    mkdirSync(join(root, 'corpus'));
    writeFileSync(
      join(root, 'corpus/corpus.yaml'),
      JSON.stringify({ schemaVersion: 2, repositories: [entry] }),
    );
    return readCorpusDocument(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

describe('corpus acceptance definitions', () => {
  it('retains the exact blind-regression identities, evidence and applicability claims', () => {
    const entries = readCorpus(repositoryRoot) as readonly {
      name: string;
      exercise?: unknown;
      acceptance?: {
        graphPopulation?: { components: number; edges: number };
        exactIdsByKind: Record<string, readonly string[]>;
        componentMetadata: Record<string, Record<string, string | number | boolean>>;
        sourceCitations: Record<string, readonly string[]>;
        adapterApplicability: Record<string, unknown>;
        topology: {
          status: string;
          unresolvedCount: number;
          conditionalDestinations: number;
          configurationBoundFacts?: readonly {
            kind: string;
            name: string;
            value: number;
            declarationFile: string;
            declarationLine: number;
            referenceFile: string;
            referenceLine: number;
          }[];
          producerPopulations?: readonly {
            adapterId: string;
            status: string;
            inspectedInputs: number;
            relationsFound: number;
            scope?: string;
          }[];
          requiredUnlocatedRefusals?: readonly { kind: string; reason: string }[];
          requiredRefusals?: readonly {
            kind: string;
            sourceFile: string;
            startLine: number;
            reason: string;
          }[];
        };
        findings: {
          strengths: number;
          exactRisks?: readonly { ruleId: string; severity: string }[];
        };
        absentKinds: readonly string[];
        absentComponentTerms: readonly string[];
        requiredEdges: readonly { kind: string; from: string; to: string }[];
      };
    }[];
    const target = entries.find((entry) => entry.name === 'local-deep-researcher');
    const exposedPositive = entries.find((entry) => entry.name === 'langchain-langgraph-agents');
    const agentFlowPositive = entries.find((entry) => entry.name === 'agentic-browser');
    assert.equal(target?.exercise, undefined);
    assert.deepEqual(target?.acceptance?.exactIdsByKind['workflow_step'], [
      'workflow_step:finalize_summary',
      'workflow_step:generate_query',
      'workflow_step:reflect_on_summary',
      'workflow_step:summarize_sources',
      'workflow_step:web_research',
    ]);
    assert.deepEqual(target?.acceptance?.exactIdsByKind['retrieval'], [
      'retrieval:duckduckgo',
      'retrieval:perplexity',
      'retrieval:searxng',
      'retrieval:tavily',
    ]);
    assert.equal(
      target?.acceptance?.componentMetadata['model:ollama/llama3.2']?.['configurationDefault'],
      true,
    );
    assert.equal(
      target?.acceptance?.componentMetadata['model:lmstudio/llama3.2']?.['configurationSelection'],
      'possible',
    );
    assert.deepEqual(target?.acceptance?.sourceCitations['model:lmstudio/llama3.2'], [
      'src/ollama_deep_researcher/configuration.py',
      'src/ollama_deep_researcher/graph.py',
      'src/ollama_deep_researcher/lmstudio.py',
    ]);
    assert.deepEqual(target?.acceptance?.adapterApplicability['adapter:model-sdk'], {
      distinctFiles: 2,
      omittedImports: 0,
      relevantImports: 3,
      fileSample: [
        {
          imported: 'ChatOpenAI',
          module: 'langchain_openai',
          sourceFile: 'src/ollama_deep_researcher/lmstudio.py',
          startLine: 12,
        },
        {
          imported: 'ChatLMStudio',
          module: 'ollama_deep_researcher.lmstudio',
          sourceFile: 'src/ollama_deep_researcher/graph.py',
          startLine: 38,
        },
        {
          imported: 'ChatOllama',
          module: 'langchain_ollama',
          sourceFile: 'src/ollama_deep_researcher/graph.py',
          startLine: 9,
        },
      ],
    });
    assert.deepEqual(target?.acceptance?.topology, {
      conditionalDestinations: 2,
      status: 'incomplete',
      unresolvedCount: 5,
    });
    assert.equal(target?.acceptance?.findings.strengths, 0);

    assert.deepEqual(exposedPositive?.acceptance?.exactIdsByKind, {
      agent: ['agent:assistant'],
      model: ['model:openai/gpt-5-mini'],
      provider: ['provider:openai'],
      workflow: ['workflow:graph.py-graph'],
    });
    assert.deepEqual(exposedPositive?.acceptance?.graphPopulation, {
      components: 4,
      edges: 1,
    });
    assert.deepEqual(exposedPositive?.acceptance?.absentKinds, ['prompt']);
    assert.deepEqual(exposedPositive?.acceptance?.absentComponentTerms, [
      'context_aware_prompt',
      'prompt-line-1~3df38b',
      'prompt-line-1~7621fb',
      'wrap_model_call',
    ]);
    assert.deepEqual(
      exposedPositive?.acceptance?.requiredEdges.map(({ kind, from, to }) => ({ kind, from, to })),
      [
        {
          kind: 'served_by_provider',
          from: 'model:openai/gpt-5-mini',
          to: 'provider:openai',
        },
      ],
    );
    assert.deepEqual(
      exposedPositive?.acceptance?.topology.requiredRefusals?.map(
        ({ kind, sourceFile, startLine }) => ({ kind, sourceFile, startLine }),
      ),
      [
        { kind: 'adapter_input', sourceFile: 'src/agent/agents.py', startLine: 32 },
        { kind: 'adapter_input', sourceFile: 'src/agent/agents.py', startLine: 33 },
        { kind: 'explicit_relation', sourceFile: 'src/agent/agents.py', startLine: 48 },
        { kind: 'explicit_relation', sourceFile: 'src/agent/agents.py', startLine: 49 },
        { kind: 'prompt_input', sourceFile: 'src/agent/agents.py', startLine: 51 },
      ],
    );
    assert.deepEqual(
      {
        conditionalDestinations: exposedPositive?.acceptance?.topology.conditionalDestinations,
        status: exposedPositive?.acceptance?.topology.status,
        unresolvedCount: exposedPositive?.acceptance?.topology.unresolvedCount,
      },
      { conditionalDestinations: 0, status: 'incomplete', unresolvedCount: 14 },
    );
    assert.equal(exposedPositive?.acceptance?.findings.strengths, 0);
    assert.deepEqual(exposedPositive?.acceptance?.findings.exactRisks, [
      { ruleId: 'observability-coverage', severity: 'info' },
    ]);
    assert.deepEqual(agentFlowPositive?.acceptance?.topology.configurationBoundFacts, [
      {
        kind: 'invocation_ceiling',
        name: 'recursion_limit',
        value: 40,
        declarationFile: 'browser_agent/agent/tools.py',
        declarationLine: 51,
        referenceFile: 'browser_agent/bridge/agent_controller.py',
        referenceLine: 189,
      },
      {
        kind: 'invocation_ceiling',
        name: 'recursion_limit',
        value: 10,
        declarationFile: 'react_sync.py',
        declarationLine: 52,
        referenceFile: 'react_sync.py',
        referenceLine: 52,
      },
    ]);
    assert.deepEqual(agentFlowPositive?.acceptance?.topology.requiredUnlocatedRefusals, [
      {
        kind: 'adapter_input',
        reason:
          'adapter:effects did not state an inspected topology population for this applicable input.',
      },
    ]);
  });

  it('accepts a complete bounded contract and rejects incomplete or unknown shapes', () => {
    assert.equal(readTemporary(validEntry).repositories[0]?.name, 'measured-repository');
    for (const test of [
      {
        entry: { ...validEntry, acceptance: { ...acceptance, exactIdsByKind: {} } },
        message: /exactIdsByKind has to hold at least one exact component population/,
      },
      {
        entry: { ...validEntry, acceptance: { ...acceptance, unknown: true } },
        message: /acceptance has to declare exactly/,
      },
      {
        entry: {
          ...validEntry,
          acceptance: {
            ...acceptance,
            requiredEdges: [{ ...acceptance.requiredEdges[0], evidence: [] }],
          },
        },
        message: /sourceFile and exact evidence/,
      },
      {
        entry: {
          ...validEntry,
          acceptance: {
            ...acceptance,
            topology: {
              ...acceptance.topology,
              configurationBoundFacts: [
                { ...acceptance.topology.configurationBoundFacts[0], value: 0 },
              ],
            },
          },
        },
        message: /exact source-located static defaults or invocation ceilings/,
      },
      {
        entry: {
          ...validEntry,
          acceptance: {
            ...acceptance,
            topology: {
              ...acceptance.topology,
              requiredUnlocatedRefusals: [
                {
                  ...acceptance.topology.requiredUnlocatedRefusals[0],
                  sourceFile: 'src/graph.ts',
                },
              ],
            },
          },
        },
        message: /without invented locations/,
      },
    ]) {
      assert.throws(() => readTemporary(test.entry), test.message);
    }
  });

  it('permits no required relations only for an exact zero-edge graph with cited refusals', () => {
    const componentOnly = {
      ...acceptance,
      graphPopulation: { components: 1, edges: 0 },
      requiredEdges: [],
      topology: {
        status: 'incomplete',
        unresolvedCount: 1,
        conditionalDestinations: 0,
        requiredRefusals: [
          {
            kind: 'explicit_relation',
            reason: 'Runtime selection prevents a source-declared relation.',
            sourceFile: 'src/graph.ts',
            startLine: 1,
          },
        ],
      },
    };
    assert.equal(
      readTemporary({ ...validEntry, acceptance: componentOnly }).repositories[0]?.name,
      'measured-repository',
    );
    assert.throws(
      () =>
        readTemporary({
          ...validEntry,
          acceptance: {
            ...componentOnly,
            graphPopulation: { components: 1, edges: 1 },
          },
        }),
      /empty acceptance.requiredEdges requires an exact zero-edge graphPopulation/,
    );
    assert.throws(
      () =>
        readTemporary({
          ...validEntry,
          acceptance: {
            ...componentOnly,
            topology: {
              status: 'incomplete',
              unresolvedCount: 1,
              conditionalDestinations: 0,
            },
          },
        }),
      /empty acceptance.requiredEdges requires an exact zero-edge graphPopulation/,
    );
    for (const topology of [
      {
        status: 'complete',
        unresolvedCount: 1,
        conditionalDestinations: 0,
        requiredRefusals: componentOnly.topology.requiredRefusals,
      },
      {
        status: 'incomplete',
        unresolvedCount: 0,
        conditionalDestinations: 0,
        requiredRefusals: componentOnly.topology.requiredRefusals,
      },
      {
        status: 'incomplete',
        unresolvedCount: 1,
        conditionalDestinations: 0,
        requiredRefusals: [
          {
            kind: 'config_backed_bound',
            reason: 'A runtime setting did not establish a universal bound.',
            sourceFile: 'src/graph.ts',
            startLine: 1,
          },
        ],
      },
    ]) {
      assert.throws(
        () => readTemporary({ ...validEntry, acceptance: { ...componentOnly, topology } }),
        /incomplete positive-unresolved topology and a source-located explicit_relation refusal/,
      );
    }
  });

  it('allows acceptance on static Git entries and rejects local or exercised populations', () => {
    assert.equal('requiredArchive' in validEntry, false);
    assert.equal(readTemporary(validEntry).repositories[0]?.source, 'git');

    const localEntry = {
      ...validEntry,
      source: 'local',
      path: 'fixtures/measured-repository',
      url: undefined,
      commit: undefined,
    };
    assert.throws(() => readTemporary(localEntry), /acceptance belongs to a static Git entry/);

    const exercisedEntry = {
      ...validEntry,
      exercise: {
        why: 'It supplies a bounded runtime population.',
        script: 'corpus/runs/measured-repository/exercise.py',
        pythonPackages: ['example==1.0.0'],
      },
    };
    assert.throws(() => readTemporary(exercisedEntry), /acceptance belongs to a static Git entry/);
  });

  it('requires exact graph and adapter populations before a positive may record unsupported detection', () => {
    const bounded = {
      ...acceptance,
      expectedAgentSystemDetected: false,
      graphPopulation: { components: 1, edges: 1 },
      adapterOutcomes: {
        'adapter:example': {
          status: 'completed',
          componentsFound: 1,
          edgesFound: 1,
          filesInspected: 1,
        },
      },
    };
    assert.equal(
      readTemporary({ ...validEntry, acceptance: bounded }).repositories[0]?.name,
      'measured-repository',
    );
    assert.throws(
      () =>
        readTemporary({
          ...validEntry,
          acceptance: { ...bounded, graphPopulation: undefined },
        }),
      /requires an exact graphPopulation/,
    );
    assert.throws(
      () =>
        readTemporary({
          ...validEntry,
          acceptance: { ...bounded, adapterOutcomes: undefined },
        }),
      /requires non-empty exact adapterOutcomes/,
    );
  });
});
