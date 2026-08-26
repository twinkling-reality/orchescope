import { isTestFile } from '@orchescope/domain';
import type { Sha256Hex, UnsupportedArea } from '@orchescope/schema';
import type { CallFact, ModuleFacts, ObjectEntryFact } from '@orchescope/source-analysis';
import {
  type LocalModules,
  localModules,
  namesDefinedPackage,
  namesLocalModule,
  namesLocalSpecifier,
} from './local-modules.ts';
import { moduleMatches } from './matching.ts';
import { buildSymbolIndex, type SymbolIndex } from './symbol-index.ts';

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
 *
 * A local module is asked one further question before it is left alone: whether the symbol it hands over
 * is its own. `from .llm import Agent` is local, and `llm.py` may hold `from anthropic_agents import
 * Agent`, in which case the owner is a distribution and calling the name local is simply wrong. That
 * chain is followed and it widens nothing, which is the point of it: measured over fifty six pinned
 * repositories it produces zero further refusals and corrects thirty six ownership answers.
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

/** Whether a specifier reaches a distribution this build has no reader for. */
const namesUnclaimedDistribution = (
  module: ModuleFacts,
  specifier: string,
  local: LocalModules,
  claimedPackages: readonly string[],
): boolean =>
  !namesLocalSpecifier(specifier, module.language) &&
  !namesLocalModule(local, module, specifier) &&
  !(module.language === 'python' && namesDefinedPackage(local, specifier)) &&
  !moduleMatches(specifier, claimedPackages);

/**
 * The distribution a construction really came from, after following the repository's own modules.
 *
 * `from .llm import Agent` is refused as this repository's own before any argument test runs, and that
 * refusal is a claim about ownership rather than a bound on the reader: `llm.py` may hold
 * `from anthropic import Agent`, in which case the name belongs to a distribution and the build has just
 * told itself otherwise. Following the chain can only make the ownership answer more correct, which is why
 * this widens nothing: measured over the pinned corpus it produces zero new refusals, corrects 36 wrong
 * ownership answers and redirects 37 more onto a distribution an adapter already claims.
 *
 * The locality of the terminal specifier is judged from the file that wrote it and not from the file that
 * consumed it, because a relative or aliased specifier means something different in each.
 *
 * [ADR 0014](../../../docs/architecture/adr/0014-layer-three-refusal-and-the-model-call-frame.md) states
 * this as a decision already taken. It was not built until now, and the sentence in that record was
 * describing an intention.
 */
const throughLocalModules = (
  index: SymbolIndex,
  module: ModuleFacts,
  call: CallFact,
  local: LocalModules,
  claimedPackages: readonly string[],
): { readonly specifier: string; readonly claimed: boolean } | undefined => {
  const root = call.calleePath[0];
  if (root === undefined) return undefined;
  const owner = index.owningDistribution(module.file, root);
  if (owner === undefined) return undefined;
  const writer = index.moduleOf(owner.from);
  if (writer === undefined) return undefined;
  return {
    specifier: owner.module,
    claimed: !namesUnclaimedDistribution(writer, owner.module, local, claimedPackages),
  };
};

type UnclaimedConstruction = {
  readonly specifier: string;
  readonly symbol: string;
  readonly namedBy: string;
};

const unclaimedConstruction = (
  module: ModuleFacts,
  call: CallFact,
  local: LocalModules,
  claimedPackages: readonly string[],
  index: SymbolIndex,
): UnclaimedConstruction | undefined => {
  if (call.kind !== 'call' && call.kind !== 'new') return undefined;
  const origin = call.origin;
  if (origin === undefined || origin.isType) return undefined;
  let specifier = origin.module;
  if (!namesUnclaimedDistribution(module, specifier, local, claimedPackages)) {
    const owner = throughLocalModules(index, module, call, local, claimedPackages);
    if (owner === undefined || owner.claimed) return undefined;
    specifier = owner.specifier;
  }
  const symbol = constructedExportName(call);
  if (symbol === undefined) return undefined;
  const entries = objectEntries(call);
  const namedBy = constructionRole(entries);
  if (namedBy === undefined) return undefined;
  if (toolsArgumentLooksLikeJsonSchemas(entries)) return undefined;
  if (looksLikeADeclarationBuilder(call, entries)) return undefined;
  return { specifier, symbol, namedBy };
};

const unclaimedReceiverCall = (
  module: ModuleFacts,
  call: CallFact,
  receivers: ReadonlyMap<string, string>,
  local: LocalModules,
  claimedPackages: readonly string[],
): UnclaimedConstruction | undefined => {
  if (call.kind !== 'call' || call.origin !== undefined) return undefined;
  if (call.calleePath.length < 2) return undefined;
  const receiver = call.calleePath.slice(0, -1).join('.');
  const specifier = receivers.get(receiver);
  if (specifier === undefined) return undefined;
  if (!namesUnclaimedDistribution(module, specifier, local, claimedPackages)) return undefined;
  const entries = objectEntries(call);
  const namedBy = constructionRole(entries);
  if (namedBy === undefined) return undefined;
  if (toolsArgumentLooksLikeJsonSchemas(entries)) return undefined;
  const method = call.calleePath[call.calleePath.length - 1];
  if (method === undefined) return undefined;
  return { specifier, symbol: `${receiver}.${method}`, namedBy };
};

/**
 * A call on something this repository built out of an unclaimed distribution and kept.
 *
 * `this.ollama = new Ollama({ host })` then `this.ollama.chat({ model, messages })` is a hand written
 * agent loop, and the second line carries no `origin` at all: the callee is a member of an object, not an
 * imported name, so every net keyed on an import walks past it. The 0.9.2 acceptance check recorded that
 * as two silent misses in one file, and noted that the MCP half of the same repository was refused
 * correctly while the model half said nothing.
 *
 * The bridge is the assignment. `AssignmentFact` carries `target: ['this', 'ollama']` and a value that is
 * a call to `Ollama`, and `Ollama` resolves through the module's own imports to a distribution. So the
 * receiver is named by the same provenance every other net uses, and the call is read under the same
 * argument-name rule. Without that rule the net reads `app.get('/path', handler)` on every web framework
 * there is: measured before it was applied, thirteen hits on one Express server and eleven across two
 * pinned repositories, against three real ones.
 */
const boundReceivers = (module: ModuleFacts): ReadonlyMap<string, string> => {
  const imported = new Map<string, string>();
  for (const entry of module.imports) if (!entry.isType) imported.set(entry.local, entry.module);

  const receivers = new Map<string, string>();
  const bind = (target: string, builtBy: string | undefined): void => {
    if (builtBy === undefined) return;
    const specifier = imported.get(builtBy);
    if (specifier !== undefined) receivers.set(target, specifier);
  };

  /* `this.ollama = new Ollama(...)`, and every later rebinding of a field or a name. */
  for (const assignment of module.assignments) {
    const value = assignment.value;
    if (value === undefined || value.kind !== 'call') continue;
    bind(assignment.target.join('.'), value.path[0]);
  }
  /*
   * `const client = new Ollama(...)` at the top of a module, which is a definition rather than an
   * assignment and is the more common of the two: a client bound once and called from every function in
   * the file. Python writes every module level binding this way and has no other spelling for it.
   *
   * Only at module scope. A name bound inside a function or a class body holds that scope's working
   * value, not a long lived client, and reading it as one attributes the call to whichever library
   * produced the value rather than to whatever it is. Measured on the corpus before this bound was
   * added: `const items = useMemo(...)` made `items.push(...)` a call to `react`, and a pydantic
   * `Field(default=None)` on a class made `agent.execute_task(tools=...)` a call to `pydantic`. Both
   * name an owner that is not the owner, which is the one thing this reader must not do.
   */
  for (const definition of module.definitions) {
    if (definition.kind !== 'variable' || definition.enclosing !== undefined) continue;
    bind(definition.name, definition.initializer?.[0]);
  }
  return receivers;
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
): UnsupportedArea => {
  const { specifier, symbol, namedBy } = construction;
  const distribution = distributionOf(specifier);
  const called = call.origin === undefined;
  const fileHash = module.contentHash as Sha256Hex;
  return {
    area: `${distribution}.${symbol} is ${called ? 'called' : 'constructed'} at ${module.file}:${call.location.startLine} and no adapter claims that distribution`,
    kind: 'unclaimed_imported_construction',
    reason: `${specifier}.${symbol} ${called ? 'is called on a value this repository built from a distribution no adapter claims' : 'is imported from a distribution no adapter claims and is constructed'} with an argument named ${namedBy}. This build does not treat that silence as an empty repository, and it does not invent an agent identity from that argument name.`,
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
type FoundArea = {
  readonly distribution: string;
  readonly called: boolean;
  readonly area: UnsupportedArea;
};

const sampled = (found: readonly FoundArea[]): readonly UnsupportedArea[] => {
  const takenFrom = new Map<string, number>();
  const kept = new Set<UnsupportedArea>();

  /*
   * Constructions before calls, because a construction says what was built and a call says what was done
   * with it, and the first is what a reader needs to go and look at. Measured: without the ordering, one
   * `llm.bindTools` call evicted the `new ChatOpenAI()` two hundred lines above it that produced `llm`,
   * because the per-distribution share is filled in the sorted order and `:171` sorts before `:89`.
   */
  for (const constructionsFirst of [true, false]) {
    for (const entry of found) {
      if (entry.called === constructionsFirst) continue;
      if (kept.size >= SAMPLE_CEILING) break;
      const taken = takenFrom.get(entry.distribution) ?? 0;
      if (taken >= SITES_PER_DISTRIBUTION) continue;
      takenFrom.set(entry.distribution, taken + 1);
      kept.add(entry.area);
    }
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
  const index = buildSymbolIndex(input.modules);
  const found: FoundArea[] = [];

  for (const module of input.modules) {
    if (isTestFile(module.file)) continue;
    const receivers = boundReceivers(module);
    for (const call of module.calls) {
      const construction =
        unclaimedConstruction(module, call, local, input.claimedPackages, index) ??
        unclaimedReceiverCall(module, call, receivers, local, input.claimedPackages);
      if (construction === undefined) continue;
      found.push({
        distribution: distributionOf(construction.specifier),
        called: call.origin === undefined,
        area: areaFor(module, call, construction),
      });
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
