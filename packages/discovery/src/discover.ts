import {
  asOrchescopeError,
  type Clock,
  type Deadline,
  isCancellation,
  projectId as makeProjectId,
  scanId as makeScanId,
  sha256Hex,
  sha256OfJson,
} from '@orchescope/domain';
import { SystemGraphBuilder } from '@orchescope/graph';
import type {
  AdapterRun,
  Evidence,
  ScanCoverage,
  Sha256Hex,
  SystemGraph,
  UnsupportedArea,
} from '@orchescope/schema';
import {
  analyzeFileSet,
  collectFiles,
  type FactCache,
  type Language,
  readManifests,
  type TraversalOptions,
} from '@orchescope/source-analysis';
import type { AdapterFindings, AgentSystemAdapter, DiscoveryContext } from './adapter.ts';
import { createBindingRegistry } from './bindings.ts';
import { readConfigDocuments } from './config-files.ts';
import { DEFAULT_ADAPTERS } from './registry.ts';
import { buildSymbolIndex } from './symbol-index.ts';

/**
 * The static discovery pipeline.
 *
 * Order matters and is fixed: manifests, then configuration, then source facts, then adapters. Cheap
 * deterministic layers run first and constrain the expensive ones, and every layer records what it could
 * not inspect so the report can say so.
 */

export type ScanRequest = {
  readonly root: string;
  readonly projectName?: string;
  readonly orchescopeVersion: string;
  readonly clock: Clock;
  readonly deadline: Deadline;
  readonly traversal: TraversalOptions;
  readonly concurrency: number;
  readonly cache?: FactCache;
  readonly adapters?: readonly AgentSystemAdapter[];
  readonly git?: { readonly commit?: string; readonly ref?: string; readonly dirty: boolean };
};

export type ScanResult = {
  readonly graph: SystemGraph;
  readonly evidence: readonly Evidence[];
  readonly detectedEcosystems: readonly Language[];
  /** True when nothing suggested this repository contains an agent system. */
  readonly agentSystemDetected: boolean;
};

const LANGUAGE_MARKERS: Readonly<Record<string, readonly string[]>> = {
  go: ['.go'],
  rust: ['.rs'],
  java: ['.java'],
  csharp: ['.cs'],
  ruby: ['.rb'],
  php: ['.php'],
};

/**
 * Unsupported areas are reported from what was actually seen, so a Go repository is told that Go is not
 * analysed rather than being shown an empty graph with no explanation.
 */
const unsupportedAreas = (
  extensionCounts: Readonly<Record<string, number>>,
): readonly UnsupportedArea[] => {
  const areas: UnsupportedArea[] = [];
  for (const [language, markers] of Object.entries(LANGUAGE_MARKERS)) {
    const fileCount = markers.reduce((total, marker) => total + (extensionCounts[marker] ?? 0), 0);
    if (fileCount === 0) continue;
    areas.push({
      area: `${language} source files (${fileCount})`,
      reason: 'Orchescope analyses JavaScript, TypeScript and Python source in this release.',
      remediation:
        'Declare the components in .orchescope/manifest.yaml so they appear in the graph.',
    });
  }
  return areas;
};

const runAdapter = (
  adapter: AgentSystemAdapter,
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  monotonicMs: () => number,
): AdapterRun => {
  const startedAt = monotonicMs();
  const base = {
    adapterId: adapter.id,
    adapterVersion: adapter.version,
    ecosystem: adapter.ecosystem,
  };
  if (!adapter.appliesTo(context)) {
    return {
      ...base,
      componentsFound: 0,
      edgesFound: 0,
      filesInspected: 0,
      durationMs: monotonicMs() - startedAt,
      status: 'not_applicable',
    };
  }
  let findings: AdapterFindings;
  try {
    findings = adapter.discover(context, builder);
  } catch (error) {
    if (isCancellation(error)) throw error;
    const failure = asOrchescopeError(error, 'PARSE_FAILED', 'the adapter failed');
    return {
      ...base,
      componentsFound: 0,
      edgesFound: 0,
      filesInspected: 0,
      durationMs: monotonicMs() - startedAt,
      status: 'failed',
      detail: failure.message.slice(0, 500),
    };
  }
  if (findings.problem !== undefined) {
    return {
      ...base,
      componentsFound: findings.componentsFound,
      edgesFound: findings.edgesFound,
      filesInspected: findings.filesInspected,
      durationMs: monotonicMs() - startedAt,
      status: 'failed',
      detail: findings.problem.slice(0, 500),
    };
  }
  return {
    ...base,
    componentsFound: findings.componentsFound,
    edgesFound: findings.edgesFound,
    filesInspected: findings.filesInspected,
    durationMs: monotonicMs() - startedAt,
    status: 'completed',
    ...(findings.note === undefined ? {} : { detail: findings.note }),
  };
};

export const discover = async (request: ScanRequest): Promise<ScanResult> => {
  const startedAtMs = request.clock.monotonicMs();
  const startedAt = request.clock.now();

  const manifests = readManifests(request.root);
  const configs = readConfigDocuments(request.root);
  const fileSet = collectFiles(request.root, request.traversal);
  request.deadline.check('static discovery');

  const analysis = await analyzeFileSet(fileSet, {
    deadline: request.deadline,
    concurrency: request.concurrency,
    ...(request.cache === undefined ? {} : { cache: request.cache }),
  });

  const symbols = buildSymbolIndex(analysis.facts);
  const bindings = createBindingRegistry(symbols);
  const projectName =
    request.projectName ?? manifests.projectName ?? request.root.split('/').pop() ?? 'project';

  const context: DiscoveryContext = {
    projectName,
    manifests,
    modules: analysis.facts,
    configs: configs.documents,
    symbols,
    bindings,
    deadline: request.deadline,
  };

  const builder = new SystemGraphBuilder();
  const adapters = request.adapters ?? DEFAULT_ADAPTERS;
  const adapterRuns: AdapterRun[] = [];
  for (const adapter of adapters) {
    request.deadline.check('static discovery');
    adapterRuns.push(runAdapter(adapter, context, builder, request.clock.monotonicMs));
  }

  const pathHash = sha256Hex(request.root) as Sha256Hex;
  const projectIdentifier = makeProjectId(pathHash);
  const sourceDigest = sha256OfJson({
    files: analysis.facts.map((module) => [module.file, module.contentHash]),
    configs: configs.documents.map((document) => [document.path, document.byteLength]),
    manifests: manifests.dependencies.map((entry) => [entry.name, entry.versionRange ?? '']),
  });
  const scan = makeScanId({ projectId: projectIdentifier, startedAt, sourceDigest });

  const coverage: ScanCoverage = {
    filesDiscovered: fileSet.files.length,
    filesParsed: analysis.facts.length,
    bytesParsed: analysis.bytesParsed,
    skipped: [...analysis.skipped],
    languages: [...analysis.languages],
    adapters: adapterRuns,
    unsupported: [...unsupportedAreas(fileSet.extensionCounts)],
    durationMs: request.clock.monotonicMs() - startedAtMs,
    truncated: fileSet.truncated,
  };

  const built = builder.build({
    provenance: {
      orchescopeVersion: request.orchescopeVersion,
      scanId: scan,
      projectId: projectIdentifier,
      projectName,
      generatedAt: startedAt,
      projectPathHash: pathHash,
      ...(request.git === undefined ? {} : { git: request.git }),
    },
    coverage,
  });

  const detectedEcosystems = analysis.languages.map((entry) => entry.language as Language);
  const agentSystemDetected = built.graph.components.some((component) =>
    ['agent', 'model', 'tool', 'mcp_server'].includes(component.kind),
  );

  return {
    graph: built.graph,
    evidence: built.evidence,
    detectedEcosystems,
    agentSystemDetected,
  };
};
