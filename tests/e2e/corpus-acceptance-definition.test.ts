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
  topology: { status: 'incomplete', unresolvedCount: 1, conditionalDestinations: 1 },
  findings: { strengths: 0, requiredRules: ['topology-shape'] },
};

const validEntry = {
  name: 'measured-repository',
  source: 'git',
  url: 'https://github.com/example/measured-repository.git',
  commit: '1'.repeat(40),
  kind: 'agent_system',
  why: 'It is a bounded real repository.',
  requiredArchive: {
    url: `https://api.github.com/repos/example/measured-repository/tarball/${'1'.repeat(40)}`,
    treeSha256: '2'.repeat(64),
    licensePath: 'LICENSE',
    licenseSha256: '3'.repeat(64),
  },
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
        exactIdsByKind: Record<string, readonly string[]>;
        componentMetadata: Record<string, Record<string, string | number | boolean>>;
        sourceCitations: Record<string, readonly string[]>;
        adapterApplicability: Record<string, unknown>;
        topology: Record<string, string | number>;
        findings: { strengths: number };
      };
    }[];
    const target = entries.find((entry) => entry.name === 'local-deep-researcher');
    assert.equal(target?.exercise, undefined);
    assert.deepEqual(target?.acceptance?.exactIdsByKind['agent'], [
      'agent:finalize_summary',
      'agent:generate_query',
      'agent:reflect_on_summary',
      'agent:summarize_sources',
      'agent:web_research',
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
      distinctFiles: 1,
      omittedImports: 0,
      relevantImports: 2,
      fileSample: [
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
      unresolvedCount: 3,
    });
    assert.equal(target?.acceptance?.findings.strengths, 0);
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
    ]) {
      assert.throws(() => readTemporary(test.entry), test.message);
    }
  });
});
