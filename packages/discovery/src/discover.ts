import {
  asOrchescopeError,
  type Clock,
  type Deadline,
  establishesAgentSystem,
  identityKey,
  isCancellation,
  projectId as makeProjectId,
  scanId as makeScanId,
  sha256Hex,
  sha256OfJson,
} from '@orchescope/domain';
import { type BuiltGraph, type DiscardedEdge, SystemGraphBuilder } from '@orchescope/graph';
import { MAX_MANIFEST_COMPONENTS } from '@orchescope/schema';
import type {
  AdapterRun,
  Evidence,
  ScanCoverage,
  Sha256Hex,
  SkippedFile,
  SystemGraph,
  GraphProvenance,
  UnsupportedArea,
  TopologyCoverage,
} from '@orchescope/schema';
import {
  analyzeFileSet,
  type CitationSnapshot,
  collectFiles,
  type DeclinedDirectory,
  type FactCache,
  boundSkipped,
  isSupportedLanguage,
  type Language,
  languageOf,
  type ModuleFacts,
  readManifests,
  readCitationSnapshots,
  type TraversalOptions,
} from '@orchescope/source-analysis';
import type {
  AdapterFindings,
  AgentSystemAdapter,
  DiscoveryContext,
  TopologyDiscovery,
} from './adapter.ts';
import { createBindingRegistry } from './bindings.ts';
import { createCallSiteEffects } from './call-site-effect.ts';
import {
  type ConfigDocument,
  type ConfigProblem,
  namedConfigPaths,
  readConfigDocuments,
} from './config-files.ts';
import { createImplementationSpanRegistry } from './implementation-span.ts';
import { localModules, namesLocalModule } from './local-modules.ts';
import { manifestCitationRequests } from './manifest-citations.ts';
import { DEFAULT_ADAPTERS } from './registry.ts';
import { moduleMatches } from './matching.ts';
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
  /**
   * How many files the index lists, when the root is a checkout.
   *
   * Read by the caller that also supplies `traversal.trackedPaths`, because the two come from one reading
   * of the index and a second one could disagree with it. It is the repository's own statement of what it
   * contains, which is the only whole the counts this scan chooses can be checked against.
   */
  readonly trackedFileCount?: number;
  readonly concurrency: number;
  readonly cache?: FactCache;
  readonly adapters?: readonly AgentSystemAdapter[];
  readonly git?: NonNullable<GraphProvenance['git']>;
  /** Called once per parsed file, so a caller can report a determinate count during the parse. */
  readonly onFileParsed?: (completed: number, total: number) => void;
};

export type ScanResult = {
  readonly graph: SystemGraph;
  readonly evidence: readonly Evidence[];
  readonly detectedEcosystems: readonly Language[];
  /** True when nothing suggested this repository contains an agent system. */
  readonly agentSystemDetected: boolean;
};

/**
 * Languages this build does not read, named by the extension a repository would carry.
 *
 * The list is what a real repository turns out to contain rather than what a survey says exists. Swift and Kotlin were
 * added because the first repository outside the corpus that this was pointed at has a menu bar application and a
 * mobile target in it, and fifty three Swift files went unmentioned: the coverage report said every file in a language
 * this build reads had been read, which was true and was not the whole answer.
 */
const LANGUAGE_MARKERS: Readonly<Record<string, readonly string[]>> = {
  go: ['.go'],
  rust: ['.rs'],
  java: ['.java'],
  kotlin: ['.kt', '.kts'],
  swift: ['.swift'],
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
      kind: 'language_not_analysed',
      reason: 'Orchescope analyses JavaScript, TypeScript and Python source in this release.',
      remediation:
        'Declare the components in .orchescope/manifest.yaml so they appear in the graph.',
    });
  }
  return areas;
};

/** The top level distribution a specifier belongs to: `langgraph.func` and `langgraph/prebuilt` are both `langgraph`. */
const distributionOf = (specifier: string): string => {
  const [scopedOrPlain = '', scopedRest] = specifier.split('/', 2);
  const base = specifier.startsWith('@') ? `${scopedOrPlain}/${scopedRest ?? ''}` : scopedOrPlain;
  return (base.split('.')[0] ?? base).toLowerCase();
};

/**
 * Where an adapter claims a framework this repository uses and reads nothing from it.
 *
 * This is the failure mode a per framework reader has: the framework moves, or the repository uses a form the
 * reader was never taught, and the result looks exactly like a repository with no agent system in it. Reporting
 * it names the ceiling instead of hiding it, which is the difference between a reader that is behind and a
 * repository that is empty. The signal is deliberately narrow: the adapter has to have claimed a distribution
 * that a parsed file actually imports at run time, and to have finished without contributing anything.
 *
 * A type only import does not count. `import type { ToolUIPart } from "ai"` is erased before the program runs and
 * can construct no agent, model or tool, so an adapter reading nothing from it is correct rather than behind.
 * Counting those was how two repositories came to carry a gap naming a framework they render types from.
 *
 * Neither does a name that reaches this repository's own file. `from agents import ...` beside an `agents.py` is
 * not the OpenAI Agents SDK, and counting it here is how a pinned entry came to report a framework gap that does
 * not exist against a repository declaring no such distribution anywhere. This asks the same question
 * `projectUses` asks before an adapter runs at all, so the claim and the decision to run now agree.
 */
const adaptersThatFoundNothing = (
  adapters: readonly AgentSystemAdapter[],
  runs: readonly AdapterRun[],
  modules: readonly ModuleFacts[],
): readonly UnsupportedArea[] => {
  const local = localModules(modules);
  const imported = new Set<string>();
  for (const module of modules) {
    for (const entry of module.imports) {
      if (entry.isType) continue;
      if (namesLocalModule(local, module, entry.module)) continue;
      imported.add(distributionOf(entry.module));
    }
  }

  const areas: UnsupportedArea[] = [];
  for (const adapter of adapters) {
    const run = runs.find((entry) => entry.adapterId === adapter.id);
    if (run === undefined || run.status !== 'completed') continue;
    if (run.componentsFound > 0 || run.edgesFound > 0) continue;
    const structured = run.applicability;
    const used =
      structured === undefined
        ? [...new Set(adapter.packages.map(distributionOf))].filter((name) => imported.has(name))
        : [...new Set(structured.sample.map((entry) => `${entry.module}.${entry.imported}`))];
    if (structured !== undefined && structured.relevantImports === 0) continue;
    if (used.length === 0) continue;
    areas.push({
      /*
       * The area names what was imported and what came of it. Naming the adapter that read it beside
       * the word this gap renders under produced "unread: mcp used in source, read by adapter:mcp",
       * which is a line that contradicts itself in the one place a reader is being told about a limit.
       */
      area:
        structured === undefined
          ? `${used.join(', ')} is imported here and its adapter found nothing`
          : `${structured.relevantImports} exact relevant import(s) for ${adapter.id} produced no component`,
      kind: 'adapter_found_nothing',
      reason:
        structured === undefined
          ? `${adapter.id} claims this framework, ran and found no component. Either this build does not read the form this repository uses, or this repository imports the framework as a client and declares nothing an adapter could read.`
          : `${adapter.id} inspected ${structured.relevantImports} exact relevant import(s) across ${structured.distinctFiles} file(s), including ${used.join(', ')}, and found no component. ${structured.omittedImports} matching import(s) were omitted from the bounded sample. Either this build does not read the form this repository uses, or the imports are clients that declare nothing the adapter can model.`,
      remediation:
        'Declare the components in .orchescope/manifest.yaml so they appear in the graph. If the repository does declare components in source, report the form so an adapter can read it.',
    });
  }
  return areas;
};

/**
 * Source the configuration removed and the repository kept.
 *
 * `analysis.exclude` matches a path segment at any depth, and `build`, `out`, `target`, `vendor` and
 * `coverage` are ordinary module names as well as ordinary build output names. A repository with
 * `src/build/` in it lost every file inside it while the report said `filesSkipped: 0`, listed nothing,
 * and printed a headline saying every file had been read.
 *
 * Reported as an area rather than as a finding because a finding is about the system and this is about
 * the scan, and because the decision is the owner's: a project that vendors its dependencies on purpose
 * wants exactly this exclusion and only its owner knows which case they are in.
 */
const excludedTrackedSource = (
  declined: readonly DeclinedDirectory[],
): readonly UnsupportedArea[] =>
  declined.map((entry) => ({
    area: `${entry.path}, which the repository tracks source inside`,
    kind: 'excluded_from_analysis' as const,
    reason: `Traversal did not enter it because ${entry.rule} excludes it, so nothing it declares is in this graph. An exclusion matches a path segment at any depth, so a name chosen for build output also removes a module of the same name wherever it sits.`,
    remediation:
      'Set analysis.exclude in .orchescope/config.yaml to the directory names this repository actually uses for derived output, then rerun the audit and check the parsed count.',
  }));

/**
 * Relations the graph could not keep, grouped by the adapter that reported them.
 *
 * This is reported as a defect in Orchescope rather than as a limit of the repository, because that is what it
 * is: an adapter named an endpoint it never created.
 */
const discardedRelations = (discarded: readonly DiscardedEdge[]): readonly UnsupportedArea[] => {
  const byAdapter = new Map<string, number>();
  for (const edge of discarded) {
    const producer = edge.discoveredBy.join(', ');
    byAdapter.set(producer, (byAdapter.get(producer) ?? 0) + 1);
  }
  return [...byAdapter.entries()].map(([producer, count]) => ({
    area: `${count} relation(s) discarded from ${producer}`,
    kind: 'discarded_relation' as const,
    reason:
      'The adapter reported a relation whose endpoint it never added, so the relation was dropped to keep the graph valid.',
    remediation:
      'This is a defect in Orchescope rather than in this repository. Report it with the repository that produced it.',
  }));
};

/**
 * The languages an adapter run read, from the files it says it inspected.
 *
 * Sorted so two scans of one repository produce the same document, which is what lets a corpus
 * expectation be committed beside the repository it measures.
 */
const languagesOf = (files: readonly string[]): string[] =>
  [...new Set(files.map((file) => languageOf(file)))].sort();

type AdapterExecution = {
  readonly run: AdapterRun;
  readonly topology?: TopologyDiscovery;
};

const runAdapter = (
  adapter: AgentSystemAdapter,
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  monotonicMs: () => number,
): AdapterExecution => {
  const startedAt = monotonicMs();
  const exactApplicability = adapter.applicability?.(context);
  const applicability =
    exactApplicability === undefined
      ? undefined
      : (() => {
          const sorted = [...exactApplicability].sort((left, right) => {
            const leftKey = `${left.location.file}:${left.location.startLine}:${left.location.startColumn ?? 0}:${left.module}:${left.imported}`;
            const rightKey = `${right.location.file}:${right.location.startLine}:${right.location.startColumn ?? 0}:${right.module}:${right.imported}`;
            return leftKey.localeCompare(rightKey);
          });
          const sample = sorted.slice(0, 10);
          return {
            relevantImports: sorted.length,
            distinctFiles: new Set(sorted.map((entry) => entry.location.file)).size,
            sample,
            omittedImports: sorted.length - sample.length,
          };
        })();
  const base = {
    adapterId: adapter.id,
    adapterVersion: adapter.version,
    ...(applicability === undefined ? {} : { applicability }),
  };
  const applicabilityFiles = [
    ...new Set(exactApplicability?.map((entry) => entry.location.file) ?? []),
  ];
  if (
    exactApplicability === undefined ? !adapter.appliesTo(context) : exactApplicability.length === 0
  ) {
    return {
      run: {
        ...base,
        componentsFound: 0,
        edgesFound: 0,
        filesInspected: applicabilityFiles.length,
        languages: languagesOf(applicabilityFiles),
        durationMs: monotonicMs() - startedAt,
        status: 'not_applicable',
      },
    };
  }
  let findings: AdapterFindings;
  try {
    findings = adapter.discover(context, builder);
  } catch (error) {
    if (isCancellation(error)) throw error;
    const failure = asOrchescopeError(error, 'PARSE_FAILED', 'the adapter failed');
    return {
      run: {
        ...base,
        componentsFound: 0,
        edgesFound: 0,
        filesInspected: applicabilityFiles.length,
        languages: languagesOf(applicabilityFiles),
        durationMs: monotonicMs() - startedAt,
        status: 'failed',
        detail: failure.message.slice(0, 500),
      },
    };
  }
  const inspectedFiles = [...new Set([...findings.filesInspected, ...applicabilityFiles])];
  const read = {
    filesInspected: inspectedFiles.length,
    languages: languagesOf(inspectedFiles),
  };
  if (findings.problem !== undefined) {
    return {
      run: {
        ...base,
        ...read,
        componentsFound: findings.componentsFound,
        edgesFound: findings.edgesFound,
        durationMs: monotonicMs() - startedAt,
        status: 'failed',
        detail: findings.problem.slice(0, 500),
      },
      ...(findings.topology === undefined ? {} : { topology: findings.topology }),
    };
  }
  return {
    run: {
      ...base,
      ...read,
      componentsFound: findings.componentsFound,
      edgesFound: findings.edgesFound,
      durationMs: monotonicMs() - startedAt,
      status: 'completed',
      ...(findings.note === undefined ? {} : { detail: findings.note }),
    },
    ...(findings.topology === undefined ? {} : { topology: findings.topology }),
  };
};

const MAX_TOPOLOGY_SAMPLES = 10;

const firstAdapterInput = (
  adapter: AgentSystemAdapter,
  modules: readonly ModuleFacts[],
): ModuleFacts['imports'][number]['location'] | undefined => {
  const local = localModules(modules);
  const matches = modules.flatMap((module) =>
    module.imports.filter(
      (entry) =>
        !entry.isType &&
        moduleMatches(entry.module, adapter.packages) &&
        !namesLocalModule(local, module, entry.module),
    ),
  );
  return matches.sort((left, right) => {
    if (left.location.file !== right.location.file) {
      return left.location.file < right.location.file ? -1 : 1;
    }
    return left.location.startLine - right.location.startLine;
  })[0]?.location;
};

const firstStructuredAdapterInput = (
  execution: AdapterExecution,
): ModuleFacts['imports'][number]['location'] | undefined =>
  execution.run.applicability?.sample[0]?.location;

const topologySampleKey = (sample: {
  readonly kind: string;
  readonly reason?: string;
  readonly location?: { readonly file: string; readonly startLine: number };
}): string =>
  `${sample.location?.file ?? ''}:${sample.location?.startLine ?? 0}:${sample.kind}:${sample.reason ?? ''}`;

/**
 * One closed-world answer requires every applicable relation producer to state its population.
 *
 * A producer that adds a relation but supplies no topology population is not silently treated as complete.
 * The same applies to a framework adapter that completed with zero output: its import establishes an
 * applicable input, not that the repository contains no declaration.
 */
const aggregateTopology = (
  adapters: readonly AgentSystemAdapter[],
  executions: readonly AdapterExecution[],
  modules: readonly ModuleFacts[],
  digests: ReadonlyMap<string, Sha256Hex>,
): TopologyCoverage | undefined => {
  const producers: TopologyCoverage['producers'][number][] = [];
  const boundaryFacts: TopologyCoverage['boundaryFacts'][number][] = [];
  const entryTargets = new Map<string, TopologyCoverage['entryTargets'][number]>();
  const configurationBoundFacts: TopologyCoverage['configurationBoundFacts'][number][] = [];
  const unresolved: TopologyCoverage['unresolved'][number][] = [];
  let inspectedInputs = 0;
  let explicitRelations = 0;
  let conditionalConstructs = 0;
  let conditionalDestinations = 0;
  let entryBoundaries = 0;
  let terminalBoundaries = 0;
  let configurationBounds = 0;
  let unresolvedCount = 0;

  const stamp = <T extends { readonly file: string }>(location: T): T => {
    const fileHash = digests.get(location.file);
    return fileHash === undefined || 'fileHash' in location
      ? location
      : ({ ...location, fileHash } as T);
  };

  for (let index = 0; index < executions.length; index += 1) {
    const execution = executions[index];
    const adapter = adapters[index];
    if (
      execution === undefined ||
      adapter === undefined ||
      execution.run.status === 'not_applicable'
    ) {
      continue;
    }
    const topology = execution.topology;
    if (topology !== undefined) {
      producers.push({
        adapterId: adapter.id,
        status: topology.status,
        inspectedInputs: topology.inspectedInputs,
        relationsFound: execution.run.edgesFound,
      });
      inspectedInputs += topology.inspectedInputs;
      explicitRelations += topology.explicitRelations;
      conditionalConstructs += topology.conditionalConstructs;
      conditionalDestinations += topology.conditionalDestinations;
      entryBoundaries += topology.entryBoundaries;
      for (const target of topology.entryTargets) entryTargets.set(identityKey(target), target);
      terminalBoundaries += topology.terminalBoundaries;
      configurationBounds += topology.configurationBounds;
      unresolvedCount += topology.unresolvedCount;
      boundaryFacts.push(
        ...topology.boundaryFacts.map((fact) => ({ ...fact, location: stamp(fact.location) })),
      );
      configurationBoundFacts.push(
        ...topology.configurationBoundFacts.map((fact) => ({
          ...fact,
          reference: stamp(fact.reference),
          declaration: stamp(fact.declaration),
        })),
      );
      unresolved.push(
        ...topology.unresolved.map((entry) => ({
          ...entry,
          ...(entry.location === undefined ? {} : { location: stamp(entry.location) }),
        })),
      );
      continue;
    }

    const structured = execution.run.applicability;
    const needsPopulation =
      structured === undefined
        ? adapter.packages.length > 0 || execution.run.edgesFound > 0
        : structured.relevantImports > 0 || execution.run.edgesFound > 0;
    if (!needsPopulation) continue;
    producers.push({
      adapterId: adapter.id,
      status: 'incomplete',
      inspectedInputs: 0,
      relationsFound: execution.run.edgesFound,
    });
    unresolvedCount += 1;
    const location =
      structured === undefined
        ? firstAdapterInput(adapter, modules)
        : firstStructuredAdapterInput(execution);
    unresolved.push({
      kind: 'adapter_input',
      reason:
        execution.run.status === 'failed'
          ? `${adapter.id} failed before it stated an inspected topology population.`
          : `${adapter.id} did not state an inspected topology population for this applicable input.`,
      ...(location === undefined ? {} : { location: stamp(location) }),
    });
  }

  if (producers.length === 0) return undefined;
  const sampleOrder = <T extends Parameters<typeof topologySampleKey>[0]>(left: T, right: T) =>
    topologySampleKey(left).localeCompare(topologySampleKey(right));
  boundaryFacts.sort(sampleOrder);
  unresolved.sort(sampleOrder);
  configurationBoundFacts.sort((left, right) =>
    `${left.reference.file}:${left.reference.startLine}:${left.name}`.localeCompare(
      `${right.reference.file}:${right.reference.startLine}:${right.name}`,
    ),
  );
  const complete =
    inspectedInputs > 0 &&
    unresolvedCount === 0 &&
    producers.every((producer) => producer.status === 'complete');
  return {
    status: complete ? 'complete' : 'incomplete',
    producers,
    inspectedInputs,
    explicitRelations,
    conditionalConstructs,
    conditionalDestinations,
    entryBoundaries,
    entryTargets: [...entryTargets.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, target]) => target),
    terminalBoundaries,
    boundaryFacts: boundaryFacts.slice(0, MAX_TOPOLOGY_SAMPLES),
    configurationBounds,
    configurationBoundFacts: configurationBoundFacts.slice(0, MAX_TOPOLOGY_SAMPLES),
    unresolvedCount,
    unresolved: unresolved.slice(0, MAX_TOPOLOGY_SAMPLES),
  };
};

const incompleteTopologyArea = (topology: TopologyCoverage | undefined): UnsupportedArea[] => {
  if (topology === undefined || topology.status === 'complete') return [];
  const first = topology.unresolved[0];
  const location = first?.location;
  const where = location === undefined ? '' : ` at ${location.file}:${location.startLine}`;
  const reasons = topology.unresolved
    .slice(0, 3)
    .map((entry) => entry.reason)
    .join(' ');
  return [
    {
      area: `topology: ${topology.unresolvedCount} unresolved${where}`,
      reason:
        reasons.length === 0
          ? 'A relation producer did not state the inspected population needed for a closed-world topology claim.'
          : reasons.slice(0, 500),
      remediation:
        'Review the bounded topology refusals in JSON and declare dynamic wiring in .orchescope/manifest.yaml where a source adapter cannot resolve it.',
    },
  ];
};

const runAdapters = (
  adapters: readonly AgentSystemAdapter[],
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  deadline: Deadline,
  monotonicMs: () => number,
): readonly AdapterExecution[] =>
  adapters.map((adapter) => {
    deadline.check('static discovery');
    return runAdapter(adapter, context, builder, monotonicMs);
  });

const provenanceFor = (
  request: ScanRequest,
  scanId: string,
  projectId: string,
  projectName: string,
  generatedAt: ReturnType<Clock['now']>,
  projectPathHash: Sha256Hex,
): Omit<GraphProvenance, 'runIds'> => ({
  orchescopeVersion: request.orchescopeVersion,
  scanId: scanId as GraphProvenance['scanId'],
  projectId: projectId as GraphProvenance['projectId'],
  projectName,
  generatedAt,
  projectPathHash,
  ...(request.git === undefined ? {} : { git: request.git }),
});

/**
 * Configuration documents the scan opened and could not use.
 *
 * Bounded like every other sample here, because the named kinds can offer as many documents as their caps
 * allow and a list that long is not a report. The count beside it is the whole.
 */
const MAX_UNREAD_CONFIGS = 10;

const unreadConfigs = (problems: readonly ConfigProblem[]): readonly SkippedFile[] =>
  problems.slice(0, MAX_UNREAD_CONFIGS).map((problem) => ({
    file: problem.file,
    reason: problem.reason,
    detail: problem.detail.slice(0, 500),
  }));

const citationSnapshotsFor = (
  fileSet: ReturnType<typeof collectFiles>,
  documents: readonly ConfigDocument[],
  facts: readonly ModuleFacts[],
  traversal: TraversalOptions,
): readonly CitationSnapshot[] => {
  const analyzedDigests = new Map(facts.map((module) => [module.file, module.contentHash]));
  return readCitationSnapshots(fileSet, manifestCitationRequests(documents), {
    maxFileBytes: traversal.maxFileBytes,
    maxRequests: MAX_MANIFEST_COMPONENTS,
  }).map((snapshot) => {
    const analyzed = analyzedDigests.get(snapshot.path);
    if (
      analyzed === undefined ||
      snapshot.contentHash === undefined ||
      analyzed === snapshot.contentHash
    ) {
      return snapshot;
    }
    return {
      path: snapshot.path,
      ...(snapshot.byteLength === undefined ? {} : { byteLength: snapshot.byteLength }),
      lines: [],
      refusal: 'changed_during_scan',
    };
  });
};

const contextFiles = (fileSet: ReturnType<typeof collectFiles>): DiscoveryContext['files'] => {
  const sized = new Map(fileSet.files.map((file) => [file.path, file.byteLength]));
  return fileSet.walked.map((path) => {
    const byteLength = sized.get(path);
    return byteLength === undefined ? { path } : { path, byteLength };
  });
};

const buildWithDiscardDisclosure = (
  builder: SystemGraphBuilder,
  provenance: Omit<GraphProvenance, 'runIds'> & { readonly runIds?: readonly string[] },
  coverage: ScanCoverage,
): BuiltGraph => {
  const firstPass = builder.build({ provenance, coverage });
  if (firstPass.discardedEdges.length === 0) return firstPass;
  return builder.build({
    provenance,
    coverage: {
      ...coverage,
      unsupported: [...coverage.unsupported, ...discardedRelations(firstPass.discardedEdges)],
    },
  });
};

export const discover = async (request: ScanRequest): Promise<ScanResult> => {
  const startedAtMs = request.clock.monotonicMs();
  const startedAt = request.clock.now();

  const manifests = readManifests(request.root);
  /*
   * The traversal runs before configuration is read so that a deployment manifest can be found where it lives rather
   * than only at the repository root. It is a stat only walk under the same exclusions and the same file limit, so
   * the cheap deterministic layer still runs before the expensive one: parsing is what `analyzeFileSet` does next.
   */
  const fileSet = collectFiles(request.root, request.traversal);
  const named = namedConfigPaths(fileSet.files.map((file) => file.path));
  const configs = readConfigDocuments(request.root, named.paths);
  request.deadline.check('static discovery');

  const analysis = await analyzeFileSet(fileSet, {
    deadline: request.deadline,
    concurrency: request.concurrency,
    ...(request.cache === undefined ? {} : { cache: request.cache }),
    ...(request.onFileParsed === undefined ? {} : { onFileParsed: request.onFileParsed }),
  });

  const citations = citationSnapshotsFor(
    fileSet,
    configs.documents,
    analysis.facts,
    request.traversal,
  );

  const symbols = buildSymbolIndex(analysis.facts);
  const bindings = createBindingRegistry(symbols);
  const implementations = createImplementationSpanRegistry();
  const callSiteEffects = createCallSiteEffects();
  const projectName =
    request.projectName ?? manifests.projectName ?? request.root.split('/').pop() ?? 'project';

  const context: DiscoveryContext = {
    projectName,
    manifests,
    modules: analysis.facts,
    configs: configs.documents,
    files: contextFiles(fileSet),
    citations,
    symbols,
    bindings,
    implementations,
    callSiteEffects,
    deadline: request.deadline,
  };

  /*
   * Every file this scan read, by the digest it read. A location that names a path and a line is true of one
   * revision and says nothing about any other, and a component's declaration is now genuinely spread across
   * files: the CrewAI join gives one agent a document entry and the call that builds it, in two files with
   * two lifetimes. The digest is what makes staleness detectable per file rather than per scan.
   *
   * Built from what was parsed and what was opened, which is every file a location can name. A path neither
   * layer read answers nothing, and the location keeps what its producer wrote.
   */
  const digests = new Map<string, Sha256Hex>();
  for (const module of analysis.facts) digests.set(module.file, module.contentHash as Sha256Hex);
  for (const document of configs.documents) digests.set(document.path, document.contentHash);
  for (const citation of citations) {
    if (citation.contentHash !== undefined) digests.set(citation.path, citation.contentHash);
  }

  const builder = new SystemGraphBuilder((path) => digests.get(path));
  const adapters = request.adapters ?? DEFAULT_ADAPTERS;
  const adapterExecutions = runAdapters(
    adapters,
    context,
    builder,
    request.deadline,
    request.clock.monotonicMs,
  );
  const adapterRuns = adapterExecutions.map((execution) => execution.run);
  const topology = aggregateTopology(adapters, adapterExecutions, analysis.facts, digests);

  const pathHash = sha256Hex(request.root) as Sha256Hex;
  const projectIdentifier = makeProjectId(pathHash);
  const sourceDigest = sha256OfJson({
    files: analysis.facts.map((module) => [module.file, module.contentHash]),
    configs: configs.documents.map((document) => [document.path, document.byteLength]),
    citations: citations.map((citation) => [
      citation.path,
      citation.contentHash ?? citation.refusal ?? 'unavailable',
    ]),
    manifests: manifests.dependencies.map((entry) => [entry.name, entry.versionRange ?? '']),
  });
  const scan = makeScanId({ projectId: projectIdentifier, startedAt, sourceDigest });

  const coverage: ScanCoverage = {
    filesDiscovered: fileSet.files.length,
    ...(request.trackedFileCount === undefined ? {} : { filesTracked: request.trackedFileCount }),
    /*
     * Files refused before analysis count too. A Python file too large to read is a file this build claims to read
     * and did not, and leaving it out of the denominator would report every such repository as fully parsed.
     */
    filesInSupportedLanguages:
      fileSet.files.filter((file) => isSupportedLanguage(file.language)).length +
      fileSet.skipped.filter((entry) => isSupportedLanguage(languageOf(entry.file))).length,
    filesParsed: analysis.facts.length,
    bytesParsed: analysis.bytesParsed,
    /*
     * Counted from the whole list, listed from a bounded sample of it.
     *
     * A configuration document the scan opened and could not parse belongs here and was reaching nobody: the
     * reader is `readConfigDocuments`, its `problems` had no consumer, and a repository whose only agents
     * document has a syntax error reported no agent and no reason, which reads as a repository that declares
     * none.
     */
    filesSkipped: analysis.skipped.length + configs.problems.length,
    skipped: [...boundSkipped(analysis.skipped), ...unreadConfigs(configs.problems)],
    languages: [...analysis.languages],
    adapters: adapterRuns,
    ...(topology === undefined ? {} : { topology }),
    unsupported: [
      ...unsupportedAreas(fileSet.extensionCounts),
      ...excludedTrackedSource(fileSet.excludedTracked),
      ...adaptersThatFoundNothing(adapters, adapterRuns, analysis.facts),
      ...incompleteTopologyArea(topology),
    ],
    durationMs: request.clock.monotonicMs() - startedAtMs,
    /*
     * A named configuration kind past its cap cut the scan short as surely as the traversal's file limit did,
     * and the reader is owed the same sentence. What this does not say is which ceiling was reached, because
     * the coverage vocabulary has one flag and naming the ceiling would be a schema decision.
     */
    truncated: fileSet.truncated || named.declined > 0,
  };

  const provenance = provenanceFor(
    request,
    scan,
    projectIdentifier,
    projectName,
    startedAt,
    pathHash,
  );

  const built = buildWithDiscardDisclosure(builder, provenance, coverage);

  const detectedEcosystems = analysis.languages.map((entry) => entry.language as Language);
  const agentSystemDetected = built.graph.components.some(establishesAgentSystem);

  return {
    graph: built.graph,
    evidence: built.evidence,
    detectedEcosystems,
    agentSystemDetected,
  };
};
