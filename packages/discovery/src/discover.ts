import {
  asOrchescopeError,
  type Clock,
  type Deadline,
  establishesAgentSystem,
  isCancellation,
  projectId as makeProjectId,
  scanId as makeScanId,
  sha256Hex,
  sha256OfJson,
} from '@orchescope/domain';
import { type DiscardedEdge, SystemGraphBuilder } from '@orchescope/graph';
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
import type { AdapterFindings, AgentSystemAdapter, DiscoveryContext } from './adapter.ts';
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
    const used = [...new Set(adapter.packages.map(distributionOf))].filter((name) =>
      imported.has(name),
    );
    if (used.length === 0) continue;
    areas.push({
      /*
       * The area names what was imported and what came of it. Naming the adapter that read it beside
       * the word this gap renders under produced "unread: mcp used in source, read by adapter:mcp",
       * which is a line that contradicts itself in the one place a reader is being told about a limit.
       */
      area: `${used.join(', ')} is imported here and its adapter found nothing`,
      kind: 'adapter_found_nothing',
      reason: `${adapter.id} claims this framework, ran and found no component. Either this build does not read the form this repository uses, or this repository imports the framework as a client and declares nothing an adapter could read.`,
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
  };
  if (!adapter.appliesTo(context)) {
    return {
      ...base,
      componentsFound: 0,
      edgesFound: 0,
      filesInspected: 0,
      languages: [],
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
      languages: [],
      durationMs: monotonicMs() - startedAt,
      status: 'failed',
      detail: failure.message.slice(0, 500),
    };
  }
  const read = {
    filesInspected: findings.filesInspected.length,
    languages: languagesOf(findings.filesInspected),
  };
  if (findings.problem !== undefined) {
    return {
      ...base,
      ...read,
      componentsFound: findings.componentsFound,
      edgesFound: findings.edgesFound,
      durationMs: monotonicMs() - startedAt,
      status: 'failed',
      detail: findings.problem.slice(0, 500),
    };
  }
  return {
    ...base,
    ...read,
    componentsFound: findings.componentsFound,
    edgesFound: findings.edgesFound,
    durationMs: monotonicMs() - startedAt,
    status: 'completed',
    ...(findings.note === undefined ? {} : { detail: findings.note }),
  };
};

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
    unsupported: [
      ...unsupportedAreas(fileSet.extensionCounts),
      ...excludedTrackedSource(fileSet.excludedTracked),
      ...adaptersThatFoundNothing(adapters, adapterRuns, analysis.facts),
    ],
    durationMs: request.clock.monotonicMs() - startedAtMs,
    /*
     * A named configuration kind past its cap cut the scan short as surely as the traversal's file limit did,
     * and the reader is owed the same sentence. What this does not say is which ceiling was reached, because
     * the coverage vocabulary has one flag and naming the ceiling would be a schema decision.
     */
    truncated: fileSet.truncated || named.declined > 0,
  };

  const provenance = {
    orchescopeVersion: request.orchescopeVersion,
    scanId: scan,
    projectId: projectIdentifier,
    projectName,
    generatedAt: startedAt,
    projectPathHash: pathHash,
    ...(request.git === undefined ? {} : { git: request.git }),
  };

  /**
   * Built twice when a relation had to be discarded, and only then.
   *
   * A discarded relation is a defect in the adapter that reported it, and the reader has to be told. Coverage is
   * an input to the build, so recording it means building again with the fuller coverage. That costs one pass over
   * drafts already in memory, on the rare path where something was wrong.
   */
  const firstPass = builder.build({ provenance, coverage });
  const built =
    firstPass.discardedEdges.length === 0
      ? firstPass
      : builder.build({
          provenance,
          coverage: {
            ...coverage,
            unsupported: [...coverage.unsupported, ...discardedRelations(firstPass.discardedEdges)],
          },
        });

  const detectedEcosystems = analysis.languages.map((entry) => entry.language as Language);
  const agentSystemDetected = built.graph.components.some(establishesAgentSystem);

  return {
    graph: built.graph,
    evidence: built.evidence,
    detectedEcosystems,
    agentSystemDetected,
  };
};
