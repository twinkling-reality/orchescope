import { isTestFile } from '@orchescope/domain';
import type { Sha256Hex, UnsupportedArea } from '@orchescope/schema';
import type { CallFact, ModuleFacts, ObjectEntryFact } from '@orchescope/source-analysis';
import {
  type LocalModules,
  localModules,
  namesDefinedPackage,
  namesLocalModule,
} from './local-modules.ts';
import { moduleMatches } from './matching.ts';
import { namesStandardLibrary } from './standard-library.ts';
import { namesRootAlias } from './symbol-index.ts';

/**
 * Imported constructions no adapter has claimed.
 *
 * `adapter_found_nothing` answers only when an adapter has already said a distribution is its
 * responsibility. An imported factory whose distribution is on nobody's list never enters that path:
 * the file is parsed, the call is retained, every adapter reports `not_applicable`, and the document
 * says no agent system was detected. That sentence is a claim about the repository. What happened is
 * a claim about this build.
 *
 * The signal is structural and language-neutral. It does not name a factory, a framework or an
 * ecosystem. A call whose origin is an imported, non-local, non-type-only distribution, whose form is
 * a call or a construction rather than a decorator, and one of whose argument names carries a model, a
 * tool or a prompt stem, is recorded as unread. The name does not establish an agent: it establishes
 * that a parsed construction would otherwise disappear. Inventing an `agent` from `Agent` or from those
 * keys is the widening ADR 0004 already refused, and it is not what this does.
 *
 * That refusal governs a producer of components. This produces an `UnsupportedArea`, which has no
 * identity, enters no population, moves no metric and cannot flip `agentSystemDetected`, so it is held to
 * a different standard: widen on provenance and bound the output, rather than require a second argument
 * name. Requiring one was what made a repository with nine refused agent constructions hide a tenth whose
 * only difference was an absent `tools`. [ADR 0014](../../../docs/architecture/adr/0014-layer-three-refusal-and-the-model-call-frame.md)
 * is the record.
 *
 * An OpenAI-style array of tool-schema objects is a model API payload, not a local tool population,
 * and stays quiet. Claimed distributions stay on `adapter_found_nothing`. Local modules, bundler root
 * aliases, standard library modules, type-only imports, test files and origin-less names stay quiet:
 * each of those names is owned by somebody, and naming an owner is what keeps this reader precise as it
 * widens.
 */

const SAMPLE_CEILING = 10;

/** How many sites one distribution contributes before the rest are counted rather than listed. */
const SITES_PER_DISTRIBUTION = 3;

/**
 * The roles a construction argument names, matched against a segment of a key rather than the whole of it.
 *
 * The four lists this replaces held nine exact names and required two of them at once. Every silent miss
 * the 0.9.2 acceptance check recorded that had an argument at all missed on one of those two counts:
 * `Agent(name=, model=, instruction=)` carries no tools-shaped name, `AssistantAgent(..., model_client=)`
 * spells the model half a tenth way, and `LlamaChatSession({ systemPrompt })` spells neither.
 *
 * Splitting the key first is what makes this a generalisation rather than a longer list. `modelPath`,
 * `model_client`, `chatModel` and `language_model` are one stem written four ways, and none of them is
 * written down here. Adding a name to the old lists would have fixed one repository; splitting the key
 * fixes the shape.
 *
 * Measured across the pinned corpus and the eight acceptance targets, this fires on `express`, `flask`,
 * `axios`, `orchescope-discovery` and the acceptance negative control a total of zero times, while newly
 * naming `autogen_agentchat`, `google.adk`, `@mastra/core` and `node-llama-cpp`. The precision comes from
 * the owner gates above and the two suppressors below, never from requiring a second key.
 */
const MODEL_STEMS: readonly string[] = ['model', 'llm'];
const TOOL_STEMS: readonly string[] = ['tool'];
const PROMPT_STEMS: readonly string[] = ['prompt', 'instruction'];

/**
 * The words a key is made of, so that one stem covers every spelling a language convention produces.
 *
 * `modelPath` splits on the case change, `model_client` and `model-client` on the separator, and both
 * arrive as the same two words. A trailing plural is read as the same word, because `tools` and `tool`
 * name one argument.
 */
const segmentsOfKey = (key: string): readonly string[] =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.toLowerCase());

const matchesStem = (word: string, stem: string): boolean => word === stem || word === `${stem}s`;

const keyNamesStem = (key: string, stems: readonly string[]): boolean => {
  const segments = segmentsOfKey(key);
  return stems.some((stem) => segments.some((word) => matchesStem(word, stem)));
};

/**
 * A prompt stem counts only as the word the key ends with, which the other stems do not require.
 *
 * A compound names its subject in its last word and describes it in the ones before. `systemPrompt` and
 * `agent_instruction` are prompts; `prompt_suffix` is a punctuation string belonging to a prompt, and
 * `prompt_toolkit` is a terminal library. `crewai` passes `prompt_suffix=` to three `click` calls, and
 * reading those as unread model constructions is a wrong owner on a repository this build reads well.
 *
 * `model` and `tool` do not need the rule and must not have it: `model_client` and `tool_choice` name
 * their subject first, and requiring the last word would lose the AutoGen construction that is the whole
 * reason the model half was generalised.
 */
const keyEndsWithStem = (key: string, stems: readonly string[]): boolean => {
  const last = segmentsOfKey(key).at(-1);
  return last !== undefined && stems.some((stem) => matchesStem(last, stem));
};

/** The role this construction's arguments name, or nothing, which is the whole of the widened test. */
const constructionRole = (entries: readonly ObjectEntryFact[]): string | undefined => {
  const named = entries.find(
    (entry) =>
      keyNamesStem(entry.key, MODEL_STEMS) ||
      keyNamesStem(entry.key, TOOL_STEMS) ||
      keyEndsWithStem(entry.key, PROMPT_STEMS),
  );
  return named?.key;
};

/**
 * A specifier that names a file this repository writes, or a module its language runtime provides, rather
 * than a distribution it depends on.
 *
 * The three prefixes were the whole of this test, and each of the other two answers a case the prefixes
 * cannot see. A bundler root alias is a file: `@/lib/agents` cannot be a package because an npm scope is
 * never empty, and `open-agent-platform` maps exactly that alias in `apps/web/tsconfig.json`. A standard
 * library module is the interpreter's, so `typing` and `dataclasses` are owned by Python rather than
 * unclaimed by an adapter.
 *
 * Both are provenance rather than vocabulary: they say whose file a name belongs to, which is what
 * [ADR 0004](../../../docs/architecture/adr/0004-provenance-not-confidence.md) requires of anything that
 * makes this reader see more. They are here before the reader is widened, because the conjunction below
 * fires so rarely that neither gap is reachable today, and both become wrong answers the moment it is.
 */
const namesLocalSpecifier = (specifier: string, language: string): boolean =>
  specifier.startsWith('.') ||
  specifier.startsWith('/') ||
  specifier.startsWith('node:') ||
  namesRootAlias(specifier) ||
  namesStandardLibrary(specifier, language);

/** The top level distribution a specifier belongs to: `pkg.sub` and `pkg/sub` are both `pkg`. */
const distributionOf = (specifier: string): string => {
  const [scopedOrPlain = '', scopedRest] = specifier.split('/', 2);
  const base = specifier.startsWith('@') ? `${scopedOrPlain}/${scopedRest ?? ''}` : scopedOrPlain;
  return (base.split('.')[0] ?? base).toLowerCase();
};

const objectEntries = (call: CallFact): readonly ObjectEntryFact[] => {
  const entries: ObjectEntryFact[] = [];
  for (const argument of call.args) {
    if (argument.kind === 'object') entries.push(...argument.entries);
  }
  return entries;
};

/**
 * An OpenAI-style tool-schema payload is a model API, not an agent construction.
 *
 * Agent frameworks pass local callables or a bound collection. `completion(model=..., tools=[{...}])`
 * is the former wearing the same two keys, and treating it as an unread agent construction would
 * rename every tools-calling client as a coverage gap.
 */
const toolsArgumentLooksLikeJsonSchemas = (entries: readonly ObjectEntryFact[]): boolean => {
  const tools = entries.find((entry) => keyNamesStem(entry.key, TOOL_STEMS));
  if (tools === undefined || tools.value.kind !== 'array') return false;
  if (tools.value.items.length === 0) return false;
  return tools.value.items.every((item) => item.kind === 'object');
};

/**
 * A schema being described, not an agent being built.
 *
 * `z.object({ model: z.string().optional(), tools: z.array(z.string()) })` carries both names this reader
 * looks for, and every one of its values is another call to the same library. A construction hands a
 * repository's own values to somebody else's code; a declaration builder hands that library back to
 * itself. The test is the shape rather than a name, so it holds for any schema library and needs none of
 * them listed: `agentgauge` reproduces the case in the pinned corpus, and the acceptance negative control
 * is a server that describes model payloads for a living.
 *
 * Two entries is the floor because a single-entry object says nothing about a pattern.
 *
 * Every field must be a call, and at least one of them must be rooted at the name the construction
 * itself is rooted at. Both halves are load bearing. Requiring every field to be rooted there missed the
 * ordinary case of a schema naming its siblings: `z.object({ id: z.uuid(), message:
 * userMessageSchema.optional(), selectedChatModel: z.string() })` is one call to another schema in three,
 * and it was reported as an unread construction on two pinned repositories. Dropping the second half
 * instead would suppress `Agent(model=get_model(), tools=get_tools())`, which is a real construction
 * whose arguments happen to be computed, so the library handing itself back is what has to be seen.
 */
const looksLikeADeclarationBuilder = (
  call: CallFact,
  entries: readonly ObjectEntryFact[],
): boolean => {
  if (entries.length < 2) return false;
  const root = call.calleePath[0];
  if (root === undefined) return false;
  if (!entries.every((entry) => entry.value.kind === 'call')) return false;
  return entries.some((entry) => entry.value.kind === 'call' && entry.value.path[0] === root);
};

const constructedExportName = (call: CallFact): string | undefined => {
  const origin = call.origin;
  if (origin === undefined) return undefined;
  if (origin.imported !== '*' && origin.imported !== 'default') return origin.imported;
  return call.calleePath[call.calleePath.length - 1];
};

const constructionKey = (area: UnsupportedArea): string => {
  const location = area.location;
  if (location === undefined) return area.area;
  return `${location.file}:${location.startLine}:${area.area}`;
};

type UnclaimedConstruction = { readonly exported: string; readonly namedBy: string };

const unclaimedConstruction = (
  module: ModuleFacts,
  call: CallFact,
  local: LocalModules,
  claimedPackages: readonly string[],
): UnclaimedConstruction | undefined => {
  if (call.kind !== 'call' && call.kind !== 'new') return undefined;
  const origin = call.origin;
  if (origin === undefined || origin.isType) return undefined;
  if (
    namesLocalSpecifier(origin.module, module.language) ||
    namesLocalModule(local, module, origin.module) ||
    (module.language === 'python' && namesDefinedPackage(local, origin.module))
  ) {
    return undefined;
  }
  if (moduleMatches(origin.module, claimedPackages)) return undefined;
  const exported = constructedExportName(call);
  if (exported === undefined) return undefined;
  const entries = objectEntries(call);
  const namedBy = constructionRole(entries);
  if (namedBy === undefined) return undefined;
  if (toolsArgumentLooksLikeJsonSchemas(entries)) return undefined;
  if (looksLikeADeclarationBuilder(call, entries)) return undefined;
  return { exported, namedBy };
};

/**
 * What a reader is told, and where each half of it goes.
 *
 * `area` is the only field the terminal prints (`apps/cli/src/terminal/gap-rows.ts`) and the only field
 * the corpus records (`scripts/corpus/observation.mjs`), so it carries the identity and the location and
 * nothing that moves for an unrelated reason. Everything variable, including which argument named the
 * role, goes in `reason`, which the machine readable document carries in full.
 */
const areaFor = (
  module: ModuleFacts,
  call: CallFact,
  construction: UnclaimedConstruction,
): UnsupportedArea | undefined => {
  const origin = call.origin;
  if (origin === undefined) return undefined;
  const { exported, namedBy } = construction;
  const distribution = distributionOf(origin.module);
  const fileHash = module.contentHash as Sha256Hex;
  return {
    area: `${distribution}.${exported} is constructed at ${module.file}:${call.location.startLine} and no adapter claims that distribution`,
    kind: 'unclaimed_imported_construction',
    reason: `${origin.module}.${exported} is imported from a distribution no adapter claims and is constructed with an argument named ${namedBy}. This build does not treat that silence as an empty repository, and it does not invent an agent identity from that argument name.`,
    remediation:
      'Declare the components in .orchescope/manifest.yaml so they appear in the graph. If the repository does declare components in source, report the form so an adapter can read it.',
    location: {
      file: module.file,
      startLine: call.location.startLine,
      ...(call.location.startColumn === undefined
        ? {}
        : { startColumn: call.location.startColumn }),
      ...(call.location.endLine === undefined ? {} : { endLine: call.location.endLine }),
      ...(call.location.endColumn === undefined ? {} : { endColumn: call.location.endColumn }),
      fileHash,
    },
  };
};

/**
 * The sample: a few from each distribution first, then the ceiling filled from what is left.
 *
 * Sorting by `file:line` and cutting at a flat ceiling lets one directory decide what a reader sees. A
 * repository with twenty constructions from one library under `a/` evicts the single construction from a
 * different library under `z/`, and the evicted one is the one nobody has a reader for. Corpus acceptance
 * asks for a located area by name, so an eviction is not a smaller answer, it is a broken pin.
 *
 * The first pass answers "which libraries did this build not read", which is the question a reader has.
 * The second pass spends whatever the ceiling has left, so a repository using one unread library still
 * gets the full sample rather than being punished for the fairness the first pass buys. Both passes keep
 * the sorted order, so the sample is a subsequence of the whole and two scans of one commit agree.
 */
const sampled = (
  found: readonly { readonly distribution: string; readonly area: UnsupportedArea }[],
): readonly UnsupportedArea[] => {
  const takenFrom = new Map<string, number>();
  const kept = new Set<UnsupportedArea>();
  for (const entry of found) {
    if (kept.size >= SAMPLE_CEILING) break;
    const taken = takenFrom.get(entry.distribution) ?? 0;
    if (taken >= SITES_PER_DISTRIBUTION) continue;
    takenFrom.set(entry.distribution, taken + 1);
    kept.add(entry.area);
  }
  for (const entry of found) {
    if (kept.size >= SAMPLE_CEILING) break;
    kept.add(entry.area);
  }
  return found.filter((entry) => kept.has(entry.area)).map((entry) => entry.area);
};

export const findUnclaimedImportedConstructions = (input: {
  readonly modules: readonly ModuleFacts[];
  readonly claimedPackages: readonly string[];
}): readonly UnsupportedArea[] => {
  const local = localModules(input.modules);
  const found: { distribution: string; area: UnsupportedArea }[] = [];

  for (const module of input.modules) {
    if (isTestFile(module.file)) continue;
    for (const call of module.calls) {
      const construction = unclaimedConstruction(module, call, local, input.claimedPackages);
      if (construction === undefined) continue;
      const area = areaFor(module, call, construction);
      if (area === undefined) continue;
      found.push({ distribution: distributionOf(call.origin?.module ?? ''), area });
    }
  }

  found.sort((left, right) =>
    constructionKey(left.area).localeCompare(constructionKey(right.area)),
  );
  const shown = sampled(found);
  if (shown.length === found.length) return shown;

  return [
    ...shown,
    {
      area: 'further unclaimed imported constructions were found and are omitted from this sample',
      kind: 'unclaimed_imported_construction',
      reason: `This scan recorded ${found.length} imported constructions whose distribution no adapter claims and whose arguments name a model, a tool or a prompt, across ${new Set(found.map((entry) => entry.distribution)).size} distribution(s). The sample above lists ${shown.length} of them, at least ${SITES_PER_DISTRIBUTION} per distribution and ${SAMPLE_CEILING} in total.`,
      remediation:
        'Declare the components in .orchescope/manifest.yaml so they appear in the graph. If the repository does declare components in source, report the form so an adapter can read it.',
    },
  ];
};
