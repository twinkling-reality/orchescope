import { CONFIDENCE_BANDS, sha256Hex } from '@orchescope/domain';
import type { AdapterFindings, AgentSystemAdapter } from '../adapter.ts';
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
        const name = text.enclosing ?? `prompt-line-${text.location.startLine}`;
        const identity = sourceIdentity('prompt', module.file, name);
        builder.addComponent(
          drafts.sourceComponent({
            kind: 'prompt',
            file: module.file,
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
            metadata: {
              characters: text.value.length,
              hasSubstitutions: text.hasSubstitutions,
            },
            tags: ['prompt'],
          }),
        );
        components += 1;
        files.add(module.file);

        // Attribute the prompt to the component the enclosing scope produced, when there is one.
        const owner =
          text.enclosing === undefined
            ? undefined
            : context.bindings.lookup(module.file, text.enclosing);
        if (owner !== undefined) {
          builder.addEdge(
            drafts.edge({
              kind: 'uses_prompt',
              from: owner,
              to: identity,
              location: text.location,
              symbol: 'prompt literal',
              confidence: CONFIDENCE_BANDS.heuristic,
            }),
          );
          edges += 1;
        }
        context.bindings.register(module.file, name, identity);
      }
    }

    return { componentsFound: components, edgesFound: edges, filesInspected: files.size };
  },
};
