import { buildIdentity, moduleNamespace, sourceSpanEvidence } from '@orchescope/domain';
import { type ComponentDraft, type EdgeDraft, SystemGraphBuilder } from '@orchescope/graph';
import type {
  ComponentKind,
  EdgeKind,
  GraphProvenance,
  ObservedComponent,
  ObservedEdge,
  RuntimeTopology,
  ScanCoverage,
  Sha256Hex,
  SideEffectRecord,
  SystemGraph,
} from '@orchescope/schema';

/**
 * Builders for tests. Every value is deterministic so that a whole document can be compared without
 * masking timestamps or identifiers.
 */

export const TEST_TIMESTAMP = '2026-01-01T00:00:00.000Z';
const ZERO_DIGEST = '0'.repeat(64) as Sha256Hex;

export const testProvenance = (
  overrides: Partial<GraphProvenance> = {},
): Omit<GraphProvenance, 'runIds'> & { runIds?: readonly string[] } => ({
  orchescopeVersion: '0.1.0',
  scanId: `scan_${'a'.repeat(16)}`,
  projectId: `prj_${'b'.repeat(16)}`,
  projectName: 'fixture-project',
  generatedAt: TEST_TIMESTAMP,
  projectPathHash: ZERO_DIGEST,
  runIds: [],
  ...overrides,
});

export const emptyCoverage = (overrides: Partial<ScanCoverage> = {}): ScanCoverage => ({
  filesDiscovered: 0,
  filesParsed: 0,
  bytesParsed: 0,
  skipped: [],
  languages: [],
  adapters: [],
  unsupported: [],
  durationMs: 0,
  truncated: false,
  ...overrides,
});

export type ComponentFixture = {
  readonly kind: ComponentKind;
  readonly name: string;
  readonly file?: string;
  readonly line?: number;
  readonly details?: ComponentDraft['details'];
  readonly sideEffect?: ComponentDraft['sideEffect'];
  readonly metadata?: ComponentDraft['metadata'];
  readonly permissions?: ComponentDraft['permissions'];
  readonly tags?: ComponentDraft['tags'];
  readonly discoveredBy?: string;
};

export const componentDraft = (fixture: ComponentFixture): ComponentDraft => {
  const file = fixture.file ?? `src/${fixture.kind}s/${fixture.name}.ts`;
  const line = fixture.line ?? 1;
  const evidence = sourceSpanEvidence({
    producer: fixture.discoveredBy ?? 'fixture',
    location: { file, startLine: line },
    symbol: fixture.name,
  });
  return {
    identity: buildIdentity(fixture.kind, moduleNamespace(file), fixture.name),
    kind: fixture.kind,
    displayName: fixture.name,
    basis: 'discovered',
    confidence: 0.9,
    discoveredBy: fixture.discoveredBy ?? 'fixture',
    sourceLocations: [{ file, startLine: line }],
    evidence: [evidence],
    ...(fixture.details === undefined ? {} : { details: fixture.details }),
    ...(fixture.sideEffect === undefined ? {} : { sideEffect: fixture.sideEffect }),
    ...(fixture.metadata === undefined ? {} : { metadata: fixture.metadata }),
    ...(fixture.permissions === undefined ? {} : { permissions: fixture.permissions }),
    ...(fixture.tags === undefined ? {} : { tags: fixture.tags }),
  };
};

export const edgeDraft = (
  kind: EdgeKind,
  from: ComponentDraft,
  to: ComponentDraft,
  overrides: Partial<EdgeDraft> = {},
): EdgeDraft => ({
  kind,
  from: from.identity,
  to: to.identity,
  basis: 'discovered',
  confidence: 0.9,
  discoveredBy: 'fixture',
  evidence: [
    sourceSpanEvidence({
      producer: 'fixture',
      location: from.sourceLocations?.[0] ?? { file: 'src/main.ts', startLine: 1 },
      symbol: `${from.displayName}->${to.displayName}`,
    }),
  ],
  ...overrides,
});

export const buildGraph = (
  components: readonly ComponentDraft[],
  edges: readonly EdgeDraft[] = [],
  provenance: Partial<GraphProvenance> = {},
): SystemGraph => {
  const builder = new SystemGraphBuilder();
  for (const component of components) builder.addComponent(component);
  for (const edge of edges) builder.addEdge(edge);
  return builder.build({ provenance: testProvenance(provenance), coverage: emptyCoverage() }).graph;
};

export const observedComponent = (
  overrides: Partial<ObservedComponent> & Pick<ObservedComponent, 'kind' | 'observedName'>,
): ObservedComponent => ({
  operation: 'unclassified',
  spanCount: 1,
  errorCount: 0,
  retryCount: 0,
  selfDurationMs: 10,
  totalDurationMs: 10,
  durationsMs: [10],
  inputTokens: 0,
  outputTokens: 0,
  performedSideEffect: false,
  evidence: [],
  attributes: {},
  ...overrides,
});

export const observedEdge = (
  overrides: Partial<ObservedEdge> &
    Pick<ObservedEdge, 'kind' | 'fromKind' | 'fromObservedName' | 'toKind' | 'toObservedName'>,
): ObservedEdge => ({
  executionCount: 1,
  errorCount: 0,
  retryCount: 0,
  parallelCount: 0,
  totalDurationMs: 10,
  durationsMs: [10],
  inputTokens: 0,
  outputTokens: 0,
  evidence: [],
  ...overrides,
});

export const runtimeTopology = (overrides: Partial<RuntimeTopology> = {}): RuntimeTopology => ({
  runIds: [`run_${'c'.repeat(16)}`],
  components: [],
  edges: [],
  sideEffects: [],
  unattributed: [],
  ...overrides,
});

export const sideEffectRecord = (
  overrides: Partial<SideEffectRecord> & Pick<SideEffectRecord, 'kind' | 'target'>,
): SideEffectRecord => ({
  traceId: 'a'.repeat(32),
  spanId: 'b'.repeat(16),
  spanName: `execute_tool ${overrides.kind}`,
  outcome: 'succeeded',
  timeUnixNano: '1700000000000000000',
  ...overrides,
});
