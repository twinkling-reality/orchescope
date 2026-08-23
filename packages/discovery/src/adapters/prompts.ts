import { CONFIDENCE_BANDS, identityKey, isTestFile, sha256Hex } from '@orchescope/domain';
import type { SystemGraphBuilder } from '@orchescope/graph';
import type { ArgumentFact, ModuleFacts, TextFact } from '@orchescope/source-analysis';

import type { AdapterFindings, AgentSystemAdapter, DiscoveryContext } from '../adapter.ts';
import { createDrafts, sourceIdentity } from '../drafts.ts';

/**
 * Prompt discovery.
 *
 * A prompt is a long string literal or template **that reaches a model**, and both halves of that sentence are
 * enforced. The length and the phrasing are what a literal looks like; a model or an agent somewhere in the graph
 * is what makes it a prompt rather than a paragraph. Without that second half, phrases as ordinary as "system",
 * "answer" and "never" turn every long string in a repository into a component: on one real 924 file codebase
 * with no model call in it, that was 285 of them.
 *
 * The adapter records the digest and the size rather than the text, so a graph can be shared without shipping the
 * repository's prompts, and it marks a template with substitutions as a place where untrusted input can enter the
 * prompt. That marking is a boundary, not a verdict: whether the substituted value is untrusted cannot be
 * established from syntax, and the finding rules say so.
 */

const ADAPTER_ID = 'adapter:prompts';
const drafts = createDrafts(ADAPTER_ID);

/** A literal has to be at least this long before it is treated as a prompt rather than a message. */
const PROMPT_MIN_TOKENS = 15;

const PROMPT_HINTS = [
  'you are',
  'your task',
  'instructions',
  'respond',
  'answer',
  'system',
  'assistant',
  'user:',
  'do not',
  'always',
  'never',
  'step by step',
];

const looksLikePrompt = (text: string): boolean => {
  const lowered = text.toLowerCase();
  return PROMPT_HINTS.some((hint) => lowered.includes(hint));
};

/**
 * The names a template splices in beside at least one other value.
 *
 * One name and nothing else is the same value under another name, and nothing enters it.
 */
const splicedAlongsideAnother = (argument: ArgumentFact): readonly string[] => {
  if (argument.kind !== 'template' || !argument.hasSubstitutions) return [];
  const names = argument.substitutedNames ?? [];
  return names.length > 1 ? names : [];
};

/** Arguments written inside this one, which is where a message sits: an array holding objects. */
const nestedArguments = (argument: ArgumentFact): readonly ArgumentFact[] => {
  if (argument.kind === 'object') return argument.entries.map((entry) => entry.value);
  if (argument.kind === 'array') return argument.items;
  if (argument.kind === 'call') return argument.args;
  return [];
};

/**
 * Prompts this module assembles with something else at the point of use.
 *
 * A prompt is as often written as a constant and spliced into a message as it is written where it is sent,
 * and reading each literal on its own loses the join: the constant interpolates nothing and the template
 * that puts the untrusted value beside it is twenty characters long, so it is not a prompt and is not even
 * recorded as a text. The prompt was reported as one that takes no run time value while the value went in
 * four lines away, and the rule that asks about exactly that said no such prompt had been discovered.
 *
 * The template has to name something besides the prompt. `` `${SYSTEM}` `` is the same prompt under
 * another name and nothing enters it; `` `${SYSTEM}\n\n${retrieved}` `` is the shape this is looking for.
 *
 * Read from call arguments rather than from the text list, because that is where such a template is: it is
 * an argument to the request that sends it, and it is too short to be recorded as a text of its own.
 */
const splicedWithOtherValues = (module: ModuleFacts): ReadonlySet<string> => {
  /*
   * Only a name whose whole value is the text. A prompt is named for whatever holds it, which is a
   * constant holding the string in the shape this is looking for and is the enclosing function or the
   * object around it otherwise. `const agent = new Agent({ instructions: '...' })` names its prompt
   * `agent`, and a template that splices `agent` into a log line puts nothing into the instructions;
   * a docstring inside `def tool(...)` is named `tool` and is not a value anyone splices at all.
   * A definition with no initialising call is the one whose value is the literal itself. An object
   * literal assigned to a constant is not told apart from a string by that test, and the corpus produced
   * none: the shapes it produced were an initialising call and a docstring inside a function.
   */
  const holdsTheTextItself = new Set(
    module.definitions
      .filter(
        (definition) => definition.kind === 'variable' && definition.initializer === undefined,
      )
      .map((definition) => definition.name),
  );
  const spliced = new Set<string>();
  const walk = (argument: ArgumentFact): void => {
    for (const name of splicedAlongsideAnother(argument)) {
      if (holdsTheTextItself.has(name)) spliced.add(name);
    }
    for (const nested of nestedArguments(argument)) walk(nested);
  };
  for (const call of module.calls) for (const argument of call.args) walk(argument);
  return spliced;
};

/**
 * Records one prompt and, when the enclosing scope produced a component, the relation from that component to it.
 *
 * A second prompt inside the same scope resolves to the first prompt rather than to an owner, so the identity is
 * compared before an edge is drawn: a component cannot use itself as a prompt. The prompt claims the name only when
 * nothing else has, so a prompt literal inside an agent definition cannot shadow the agent it belongs to.
 */
const addPrompt = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  file: string,
  text: TextFact,
  spliced: ReadonlySet<string>,
): { readonly edges: number } => {
  const name = text.enclosing ?? `prompt-line-${text.location.startLine}`;
  const identity = sourceIdentity('prompt', file, name);
  builder.addComponent(
    drafts.sourceComponent({
      kind: 'prompt',
      file,
      name,
      location: text.location,
      symbol: text.enclosing ?? 'literal',
      confidence: CONFIDENCE_BANDS.heuristic,
      details: {
        for: 'prompt',
        textHash: sha256Hex(text.value),
        approximateTokens: text.approximateTokens,
        /*
         * Either the literal takes a value itself, or something splices it together with one. Both are a
         * run time value entering this prompt, and only the first was read.
         */
        interpolatesUntrustedInput:
          text.hasSubstitutions || (text.enclosing !== undefined && spliced.has(text.enclosing)),
      },
      metadata: {
        characters: text.value.length,
        hasSubstitutions: text.hasSubstitutions,
        ...(text.enclosing !== undefined && spliced.has(text.enclosing)
          ? { assembledElsewhere: true }
          : {}),
      },
      tags: ['prompt'],
    }),
  );

  const candidate =
    text.enclosing === undefined ? undefined : context.bindings.lookup(file, text.enclosing);
  if (candidate === undefined) {
    context.bindings.register(file, name, identity);
    return { edges: 0 };
  }
  if (identityKey(candidate) === identityKey(identity)) return { edges: 0 };

  builder.addEdge(
    drafts.edge({
      kind: 'uses_prompt',
      from: candidate,
      to: identity,
      location: text.location,
      symbol: 'prompt literal',
      confidence: CONFIDENCE_BANDS.heuristic,
    }),
  );
  return { edges: 1 };
};

export const promptsAdapter: AgentSystemAdapter = {
  id: ADAPTER_ID,
  version: '2',
  // A prompt literal belongs to no package.
  packages: [],
  appliesTo: (context) => context.modules.some((module) => module.texts.length > 0),
  discover: (context, builder): AdapterFindings => {
    // Adapters that find models and agents run first, so this is the question of whether a prompt has anywhere
    // to go. A repository with none of them has no prompts in it, however instructive its strings read.
    if (!builder.hasAnyOfKind(['model', 'agent', 'agent_group'])) {
      return {
        componentsFound: 0,
        edgesFound: 0,
        filesInspected: [],
        note: 'no model or agent was discovered, so no string literal was treated as a prompt',
      };
    }

    let components = 0;
    let edges = 0;
    const files = new Set<string>();

    for (const module of context.modules) {
      /*
       * A developer's tooling is not the system under audit, and a test file is full of the one thing this
       * adapter looks for: fixtures, mocked model replies and assertion messages all read as long text with
       * values spliced into it. Every other adapter that reads source already declines these and this one
       * did not, so `prompt-injection-boundary` reported a security boundary over a population that was
       * sixteen of eighteen test fixtures on one pinned repository. A prompt only a test writes can never
       * reach a model in a run, which is the same reason the clients a harness constructs are left out.
       */
      if (isTestFile(module.file)) continue;
      const spliced = splicedWithOtherValues(module);
      for (const text of module.texts) {
        if (text.approximateTokens < PROMPT_MIN_TOKENS) continue;
        if (!looksLikePrompt(text.value)) continue;
        const added = addPrompt(context, builder, module.file, text, spliced);
        components += 1;
        edges += added.edges;
        files.add(module.file);
      }
    }

    return { componentsFound: components, edgesFound: edges, filesInspected: [...files] };
  },
};
