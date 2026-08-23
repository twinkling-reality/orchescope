import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readCorpus, readCorpusDocument } from '../../scripts/corpus/definition.mjs';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

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
    'adapter:example': {
      status: 'completed',
      componentsFound: 0,
      edgesFound: 0,
      filesInspected: 1,
      languages: ['python'],
    },
  },
  unsupported: [
    {
      kind: 'adapter_found_nothing',
      area: 'example is imported here and its adapter found nothing',
      reason: 'adapter:example inspected the applicable source and reported no component.',
    },
  ],
  topology: {
    status: 'incomplete',
    unresolvedCount: 1,
    conditionalDestinations: 0,
    producers: [
      {
        adapterId: 'adapter:example',
        status: 'incomplete',
        scope: 'control_flow',
        inspectedInputs: 0,
        relationsFound: 0,
      },
    ],
    requiredRefusals: [
      {
        kind: 'adapter_input',
        reason: 'adapter:example supplied no inspected topology population.',
        sourceFile: 'main.py',
        startLine: 1,
        fileHash: 'a'.repeat(64),
      },
    ],
  },
  findings: { total: 0, strengths: 0 },
};

const validEntry = {
  name: 'completed-zero-application',
  source: 'git',
  url: 'https://github.com/example/completed-zero-application.git',
  commit: '1'.repeat(40),
  kind: 'agent_system',
  why: 'It preserves an honest completed-zero application scan.',
  acceptance,
};

const readTemporary = (entry: object) => {
  const prefix = join(tmpdir(), 'orchescope-completed-zero-definition-');
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

describe('completed-zero corpus acceptance definitions', () => {
  it('retains the exact Box holdout boundary without promoting the A2A control', () => {
    const entries = readCorpus(repositoryRoot) as readonly {
      name: string;
      source: string;
      url?: string;
      commit?: string;
      exercise?: unknown;
      acceptance?: typeof acceptance;
    }[];
    const positive = entries.find((entry) => entry.name === 'openai-agents-sdk-v2-demo');
    assert.equal(positive?.source, 'git');
    assert.equal(positive?.url, 'https://github.com/box-community/openai-agents-sdk-v2-demo.git');
    assert.equal(positive?.commit, 'daf811baacd06f6829d904f596b1125a5817be04');
    assert.equal(positive?.exercise, undefined);
    assert.deepEqual(positive?.acceptance?.graphPopulation, { components: 0, edges: 0 });
    assert.deepEqual(positive?.acceptance?.adapterOutcomes, {
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
    });
    assert.deepEqual(positive?.acceptance?.topology.requiredRefusals, [
      {
        kind: 'adapter_input',
        reason:
          'adapter:openai-agents did not state an inspected topology population for this applicable input.',
        sourceFile: 'main.py',
        startLine: 16,
        fileHash: '5a5026fe20e94206493025a8772dbfb3b03608959bbc90856c8ea5d5720a5ef7',
      },
    ]);
    assert.equal(
      entries.some(
        (entry) => entry.url === 'https://github.com/a2aproject/A2A.git' || entry.name === 'a2a',
      ),
      false,
    );
  });

  it('accepts only the exact zero, incomplete and source-located contract', () => {
    assert.equal(readTemporary(validEntry).repositories[0]?.name, validEntry.name);
    const invalid = [
      {
        acceptance: { ...acceptance, expectedAgentSystemDetected: true },
        message: /expectedAgentSystemDetected false/,
      },
      {
        acceptance: { ...acceptance, graphPopulation: { components: 1, edges: 0 } },
        message: /zero components and zero edges/,
      },
      {
        acceptance: {
          ...acceptance,
          evidenceCoverage: { ...acceptance.evidenceCoverage, totalEligible: 1 },
        },
        message: /exact zero accounting/,
      },
      {
        acceptance: { ...acceptance, componentMetricPopulation: { records: 1 } },
        message: /zero metric records/,
      },
      {
        acceptance: {
          ...acceptance,
          runtimePopulation: {
            ...acceptance.runtimePopulation,
            observed: { count: 0, runIds: ['run_unbounded'] },
          },
        },
        message: /exact zero runs and run IDs/,
      },
      {
        acceptance: { ...acceptance, adapterOutcomes: {} },
        message: /at least one completed adapter population/,
      },
      {
        acceptance: {
          ...acceptance,
          unsupported: [{ ...acceptance.unsupported[0], reason: '' }],
        },
        message: /exact adapter_found_nothing gaps/,
      },
      {
        acceptance: {
          ...acceptance,
          topology: {
            ...acceptance.topology,
            requiredRefusals: [{ ...acceptance.topology.requiredRefusals[0], fileHash: 'short' }],
          },
        },
        message: /source-located refusals and file hashes/,
      },
      {
        acceptance: { ...acceptance, findings: { total: 1, strengths: 0 } },
        message: /zero findings and zero strengths/,
      },
    ];
    for (const test of invalid) {
      assert.throws(
        () => readTemporary({ ...validEntry, acceptance: test.acceptance }),
        test.message,
      );
    }
  });

  it('rejects the completed-zero branch on a negative, local or exercised entry', () => {
    assert.throws(
      () => readTemporary({ ...validEntry, kind: 'not_agent_system' }),
      /static Git agent_system entry/,
    );
    assert.throws(
      () =>
        readTemporary({
          ...validEntry,
          source: 'local',
          path: 'fixtures/example',
          url: undefined,
          commit: undefined,
        }),
      /static Git agent_system entry/,
    );
    assert.throws(
      () =>
        readTemporary({
          ...validEntry,
          exercise: {
            why: 'It supplies a runtime population.',
            script: 'corpus/runs/example.py',
            pythonPackages: ['example==1.0.0'],
          },
        }),
      /static Git agent_system entry/,
    );
  });
});
