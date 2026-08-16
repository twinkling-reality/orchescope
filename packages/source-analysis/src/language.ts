/**
 * What language a path is written in, decided by its extension.
 *
 * This is the one fact both traversal and the content checks need before either can do anything, and it
 * is a fact about a name rather than about a file, so it lives on its own. An extension nothing here maps
 * is `other`: it is still counted, so that coverage can say a repository also contains Go, and it is
 * never parsed.
 */

export type Language = 'javascript' | 'typescript' | 'python' | 'json' | 'yaml' | 'toml' | 'other';

const EXTENSION_LANGUAGE: Readonly<Record<string, Language>> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.pyi': 'python',
  '.json': 'json',
  '.jsonc': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
};

export const languageOf = (path: string): Language => {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return 'other';
  return EXTENSION_LANGUAGE[path.slice(dot).toLowerCase()] ?? 'other';
};

/**
 * The languages that reach a parser.
 *
 * Everything else is discovered, counted and read only for what it declares. A configuration document is
 * not analysed for shapes, which is why a content check that judges code has to ask this first.
 */
export const readsAsCode = (language: Language): boolean =>
  language === 'javascript' || language === 'typescript' || language === 'python';
