import { CONFIDENCE_BANDS, identityKey, sha256Hex } from '@orchescope/domain';
import type { SystemGraphBuilder } from '@orchescope/graph';
import type { TextFact } from '@orchescope/source-analysis';
import type { AdapterFindings, AgentSystemAdapter, DiscoveryContext } from '../adapter.ts';
import { createDrafts, sourceIdentity } from '../drafts.ts';

/**
 * Prompt discovery.
 *
 * A prompt is a long string literal or template that reaches a model. The adapter records the digest and
 * the size rather than the text, so a graph can be shared without shipping the repository's prompts, and
 * it marks a template with substitutions as a place where untrusted input can enter the prompt. That
 * marking is a boundary, not a verdict: whether the substituted value is untrusted cannot be established
 * from syntax, and the finding rules say so.
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
        interpolatesUntrustedInput: text.hasSubstitutions,
      },
      metadata: { characters: text.value.length, hasSubstitutions: text.hasSubstitutions },
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
  version: '1',
  ecosystem: 'javascript',
  appliesTo: (context) => context.modules.some((module) => module.texts.length > 0),
  discover: (context, builder): AdapterFindings => {
    let components = 0;
    let edges = 0;
    const files = new Set<string>();

    for (const module of context.modules) {
      for (const text of module.texts) {
        if (text.approximateTokens < PROMPT_MIN_TOKENS) continue;
        if (!looksLikePrompt(text.value)) continue;
        const added = addPrompt(context, builder, module.file, text);
        components += 1;
        edges += added.edges;
        files.add(module.file);
      }
    }

    return { componentsFound: components, edgesFound: edges, filesInspected: files.size };
  },
};
