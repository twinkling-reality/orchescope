import type { MemoryStore } from './context.ts';
import { sleep } from './failures.ts';
import { ATTR, SPAN_KIND_INTERNAL, sourceFile, type Trace } from './telemetry.ts';

/**
 * Per conversation memory.
 *
 * An in process store, one instance per request, with a read operation and a write operation that are both
 * traced. Reads report `search_memory` and writes report `update_memory`, which is the vocabulary Orchescope
 * maps onto a memory component.
 */

const site = sourceFile('apps/demo/src/memory.ts');
const COMPONENT = 'conversation-memory';
const MAX_ENTRIES_PER_KEY = 32;

export const createMemory = (trace: Trace, conversationId: string): MemoryStore => {
  const entries = new Map<string, string[]>();
  const attributes = { [ATTR.component]: COMPONENT, [ATTR.conversationId]: conversationId };

  return {
    recall: (parent, key) =>
      trace.run(
        {
          name: `search_memory ${COMPONENT}`,
          kind: SPAN_KIND_INTERNAL,
          site: site('recall', 27),
          attributes: { ...attributes, [ATTR.operationName]: 'search_memory' },
        },
        parent,
        async () => {
          await sleep(0);
          return [...(entries.get(key) ?? [])];
        },
      ),
    remember: (parent, key, value) =>
      trace.run(
        {
          name: `update_memory ${COMPONENT}`,
          kind: SPAN_KIND_INTERNAL,
          site: site('remember', 41),
          attributes: { ...attributes, [ATTR.operationName]: 'update_memory' },
        },
        parent,
        async () => {
          await sleep(0);
          const existing = entries.get(key) ?? [];
          if (existing.length < MAX_ENTRIES_PER_KEY) existing.push(value);
          entries.set(key, existing);
        },
      ),
  };
};
