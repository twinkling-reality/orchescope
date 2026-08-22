import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ComponentDraft } from '@orchescope/graph';
import { federate } from '@orchescope/graph';
import type { ObservedSource, Sha256Hex } from '@orchescope/schema';
import {
  buildGraph,
  componentDraft,
  observedComponent,
  observedEdge,
  runtimeTopology,
  TEST_TIMESTAMP,
} from '@orchescope/testkit';

const CLIENT_URL = 'https://example.com/client';
const SERVER_URL = 'https://example.com/server';
const CLIENT_REVISION = '1'.repeat(40);
const SERVER_REVISION = '2'.repeat(40);
const WRONG_REVISION = '3'.repeat(40);
const FILE_HASH = '4'.repeat(64) as Sha256Hex;

const provenance = (attribute: string) => ({ attributes: [attribute], spanFields: [] as never[] });

const source = (
  repositoryUrl: string,
  revision: string,
  file = 'src/shared.ts',
  line = 10,
): ObservedSource => ({
  identity: { repositoryUrl, revision, file, line, function: 'shared' },
  provenance: {
    repositoryUrl: provenance('vcs.repository.url.full'),
    revision: provenance('vcs.ref.head.revision'),
    file: provenance('orchescope.code.repository.path'),
    line: provenance('code.line.number'),
    function: provenance('code.function.name'),
  },
});

const declaration = (): ComponentDraft => {
  const draft = componentDraft({ kind: 'agent', name: 'shared', file: 'src/shared.ts', line: 10 });
  return {
    ...draft,
    sourceLocations: [{ file: 'src/shared.ts', startLine: 10, endLine: 20, fileHash: FILE_HASH }],
  };
};

const graph = (repositoryUrl: string, commit: string, dirty = false) =>
  buildGraph([declaration()], [], {
    git: { repositoryUrl, commit, dirty },
  });

const twoRepositoryInput = () => {
  const clientSource = source(CLIENT_URL, CLIENT_REVISION);
  const serverSource = source(SERVER_URL, SERVER_REVISION);
  return {
    repositories: [
      { graph: graph(CLIENT_URL, CLIENT_REVISION), evidence: [] },
      { graph: graph(SERVER_URL, SERVER_REVISION), evidence: [] },
    ],
    topologies: [
      runtimeTopology({
        components: [
          observedComponent({
            kind: 'agent',
            observedName: 'shared',
            observedSource: clientSource,
          }),
          observedComponent({
            kind: 'agent',
            observedName: 'shared',
            observedSource: serverSource,
          }),
        ],
        edges: [
          observedEdge({
            kind: 'hands_off_to',
            fromKind: 'agent',
            fromObservedName: 'shared',
            fromObservedSource: clientSource,
            toKind: 'agent',
            toObservedName: 'shared',
            toObservedSource: serverSource,
          }),
        ],
      }),
    ],
    runtimeEvidence: [],
    orchescopeVersion: '0.8.0',
    generatedAt: TEST_TIMESTAMP,
  } as const;
};

describe('repository federation', () => {
  it('keeps equal local identities distinct and preserves source provenance and file hashes', () => {
    const report = federate(twoRepositoryInput());

    assert.equal(report.repositories.length, 2);
    assert.equal(report.componentJoins.length, 2);
    assert.equal(report.relations.length, 1);
    assert.equal(report.coverage.joinedCrossRepositoryRelations, 1);
    assert.equal(
      report.componentJoins[0]?.component.componentId,
      report.componentJoins[1]?.component.componentId,
    );
    assert.notEqual(
      report.componentJoins[0]?.component.repository.repositoryUrl,
      report.componentJoins[1]?.component.repository.repositoryUrl,
    );
    assert.deepEqual(report.componentJoins[0]?.observedSource.provenance.repositoryUrl, {
      attributes: ['vcs.repository.url.full'],
      spanFields: [],
    });
    assert.ok(
      report.repositories.every(
        (repository) => repository.graph.components[0]?.sourceLocations[0]?.fileHash === FILE_HASH,
      ),
    );
    assert.deepEqual(report.relations[0]?.provenance.relation.spanFields, ['parentSpanId']);
  });

  it('refuses a stale endpoint revision without falling back to its equal name', () => {
    const input = twoRepositoryInput();
    const stale = source(SERVER_URL, WRONG_REVISION);
    const topology = runtimeTopology({
      components: [
        observedComponent({
          kind: 'agent',
          observedName: 'shared',
          observedSource: source(CLIENT_URL, CLIENT_REVISION),
        }),
        observedComponent({ kind: 'agent', observedName: 'shared', observedSource: stale }),
      ],
      edges: [
        observedEdge({
          kind: 'hands_off_to',
          fromKind: 'agent',
          fromObservedName: 'shared',
          fromObservedSource: source(CLIENT_URL, CLIENT_REVISION),
          toKind: 'agent',
          toObservedName: 'shared',
          toObservedSource: stale,
        }),
      ],
    });
    const report = federate({ ...input, topologies: [topology] });

    assert.equal(report.componentJoins.length, 1);
    assert.equal(report.relations.length, 0);
    assert.ok(
      report.coverage.refusals.some(
        (refusal) => refusal.reason === 'revision_mismatch' && refusal.count > 0,
      ),
    );
  });

  it('does not let a repository list manufacture the missing server half', () => {
    const input = twoRepositoryInput();
    const clientSource = source(CLIENT_URL, CLIENT_REVISION);
    const topology = runtimeTopology({
      components: [
        observedComponent({
          kind: 'agent',
          observedName: 'shared',
          observedSource: clientSource,
        }),
      ],
      edges: [
        observedEdge({
          kind: 'hands_off_to',
          fromKind: 'agent',
          fromObservedName: 'shared',
          fromObservedSource: clientSource,
          toKind: 'agent',
          toObservedName: 'shared',
        }),
      ],
    });
    const report = federate({ ...input, topologies: [topology] });

    assert.equal(report.componentJoins.length, 1);
    assert.equal(report.relations.length, 0);
    assert.ok(
      report.coverage.refusals.some(
        (refusal) =>
          refusal.scope === 'relation' &&
          refusal.reason === 'missing' &&
          refusal.attribute === 'observedSource',
      ),
    );
  });

  it('requires parent context independently of two valid endpoint sources', () => {
    const input = twoRepositoryInput();
    const edge = input.topologies[0]?.edges[0];
    assert.ok(edge);
    const topology = runtimeTopology({
      components: input.topologies[0]?.components ?? [],
      edges: [
        {
          ...edge,
          provenance: {
            ...edge.provenance,
            relation: { attributes: [], spanFields: [] },
          },
        },
      ],
    });
    const report = federate({ ...input, topologies: [topology] });

    assert.equal(report.componentJoins.length, 2);
    assert.equal(report.relations.length, 0);
    assert.ok(
      report.coverage.refusals.some((refusal) => refusal.reason === 'relation_evidence_missing'),
    );
  });

  it('excludes a dirty graph and reports the repository refusal', () => {
    const input = twoRepositoryInput();
    const report = federate({
      ...input,
      repositories: [
        input.repositories[0],
        { graph: graph(SERVER_URL, SERVER_REVISION, true), evidence: [] },
      ],
    });

    assert.equal(report.coverage.eligibleRepositories, 1);
    assert.equal(report.relations.length, 0);
    assert.ok(report.coverage.refusals.some((refusal) => refusal.reason === 'repository_dirty'));
  });
});
