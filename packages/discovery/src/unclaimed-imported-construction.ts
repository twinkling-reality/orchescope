import { isTestFile } from '@orchescope/domain';
import type { Sha256Hex, UnsupportedArea } from '@orchescope/schema';
import type { CallFact, ModuleFacts, ObjectEntryFact } from '@orchescope/source-analysis';
import { type LocalModules, localModules, namesLocalModule } from './local-modules.ts';
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
 * a call or a construction rather than a decorator, and whose arguments carry both a tools-shaped
 * name and a model-shaped name, is recorded as unread. The names do not establish an agent: they
 * establish that a parsed construction would otherwise disappear. Inventing an `agent` from `Agent`
 * or from those keys is the widening ADR 0004 already refused.
 *
 * An OpenAI-style array of tool-schema objects is a model API payload, not a local tool population,
 * and stays quiet. Claimed distributions stay on `adapter_found_nothing`. Local modules, bundler root
 * aliases, standard library modules, type-only imports, test files and origin-less names stay quiet:
 * each of those names is owned by somebody, and naming an owner is what keeps this reader precise as it
 * widens.
 */

const SAMPLE_CEILING = 10;

const TOOL_ARGUMENT_KEYS = new Set(['tools', 'toolset', 'toolsets', 'managed_agents']);
const MODEL_ARGUMENT_KEYS = new Set(['model', 'llm', 'language_model', 'chat_model', 'llm_config']);

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

const hasToolsAndModelKeys = (entries: readonly ObjectEntryFact[]): boolean => {
  const names = new Set(entries.map((entry) => entry.key));
  return (
    [...TOOL_ARGUMENT_KEYS].some((key) => names.has(key)) &&
    [...MODEL_ARGUMENT_KEYS].some((key) => names.has(key))
  );
};

/**
 * An OpenAI-style tool-schema payload is a model API, not an agent construction.
 *
 * Agent frameworks pass local callables or a bound collection. `completion(model=..., tools=[{...}])`
 * is the former wearing the same two keys, and treating it as an unread agent construction would
 * rename every tools-calling client as a coverage gap.
 */
const toolsArgumentLooksLikeJsonSchemas = (entries: readonly ObjectEntryFact[]): boolean => {
  const tools = entries.find((entry) => TOOL_ARGUMENT_KEYS.has(entry.key));
  if (tools === undefined || tools.value.kind !== 'array') return false;
  if (tools.value.items.length === 0) return false;
  return tools.value.items.every((item) => item.kind === 'object');
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

const exportedUnclaimedConstruction = (
  module: ModuleFacts,
  call: CallFact,
  local: LocalModules,
  claimedPackages: readonly string[],
): string | undefined => {
  if (call.kind !== 'call' && call.kind !== 'new') return undefined;
  const origin = call.origin;
  if (origin === undefined || origin.isType) return undefined;
  if (
    namesLocalSpecifier(origin.module, module.language) ||
    namesLocalModule(local, module, origin.module)
  ) {
    return undefined;
  }
  if (moduleMatches(origin.module, claimedPackages)) return undefined;
  const exported = constructedExportName(call);
  if (exported === undefined) return undefined;
  const entries = objectEntries(call);
  if (!hasToolsAndModelKeys(entries) || toolsArgumentLooksLikeJsonSchemas(entries)) {
    return undefined;
  }
  return exported;
};

const areaFor = (
  module: ModuleFacts,
  call: CallFact,
  exported: string,
): UnsupportedArea | undefined => {
  const origin = call.origin;
  if (origin === undefined) return undefined;
  const distribution = distributionOf(origin.module);
  const fileHash = module.contentHash as Sha256Hex;
  return {
    area: `${distribution}.${exported} is constructed at ${module.file}:${call.location.startLine} and no adapter claims that distribution`,
    kind: 'unclaimed_imported_construction',
    reason: `${origin.module}.${exported} is imported from a distribution no adapter claims and is constructed with a tools-shaped argument and a model-shaped argument. This build does not treat that silence as an empty repository, and it does not invent an agent identity from those argument names.`,
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

export const findUnclaimedImportedConstructions = (input: {
  readonly modules: readonly ModuleFacts[];
  readonly claimedPackages: readonly string[];
}): readonly UnsupportedArea[] => {
  const local = localModules(input.modules);
  const areas: UnsupportedArea[] = [];

  for (const module of input.modules) {
    if (isTestFile(module.file)) continue;
    for (const call of module.calls) {
      const exported = exportedUnclaimedConstruction(module, call, local, input.claimedPackages);
      if (exported === undefined) continue;
      const area = areaFor(module, call, exported);
      if (area !== undefined) areas.push(area);
    }
  }

  areas.sort((left, right) => constructionKey(left).localeCompare(constructionKey(right)));
  if (areas.length <= SAMPLE_CEILING) return areas;

  const sampled = areas.slice(0, SAMPLE_CEILING);
  const omitted = areas.length - SAMPLE_CEILING;
  return [
    ...sampled,
    {
      area: `${omitted} further unclaimed imported construction(s) omitted from this sample`,
      kind: 'unclaimed_imported_construction',
      reason: `This scan recorded ${areas.length} imported constructions whose distribution no adapter claims and whose arguments carry both a tools-shaped name and a model-shaped name. The sample above is capped at ${SAMPLE_CEILING}.`,
      remediation:
        'Declare the components in .orchescope/manifest.yaml so they appear in the graph. If the repository does declare components in source, report the form so an adapter can read it.',
    },
  ];
};
