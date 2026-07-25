import type { ComponentIdentity } from '@orchescope/schema';
import type { SymbolIndex } from './symbol-index.ts';

/**
 * The binding registry maps a local variable to the component it produced.
 *
 * An agent lists its tools by variable name, and the tool's component identity is built from the
 * tool's declared name, which is usually different. Without this registry an adapter would have to
 * guess, and the graph would grow duplicate tool components with two spellings of the same name.
 *
 * Lookups follow the symbol index across modules, so a tool defined in one file and referenced in
 * another resolves to a single component.
 */
export type BindingRegistry = {
  readonly register: (file: string, localName: string, identity: ComponentIdentity) => void;
  readonly lookup: (file: string, localName: string) => ComponentIdentity | undefined;
  readonly size: () => number;
};

const key = (file: string, localName: string): string => `${file}::${localName}`;

export const createBindingRegistry = (symbols: SymbolIndex): BindingRegistry => {
  const entries = new Map<string, ComponentIdentity>();
  return {
    register: (file, localName, identity) => {
      entries.set(key(file, localName), identity);
    },
    lookup: (file, localName) => {
      const direct = entries.get(key(file, localName));
      if (direct !== undefined) return direct;
      const resolved = symbols.resolve(file, localName);
      if (resolved === undefined) return undefined;
      return entries.get(key(resolved.file, resolved.name));
    },
    size: () => entries.size,
  };
};
