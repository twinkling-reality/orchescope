import type { Deadline } from '@orchescope/domain';
import { settleWithConcurrency } from '@orchescope/domain';
import type { SkippedFile } from '@orchescope/schema';
import type { ModuleFacts } from './facts.ts';
import {
  type FileContents,
  type FileSet,
  isSkipped,
  readSource,
  type SourceFile,
} from './file-set.ts';
import { analyzeJavaScript } from './javascript/analyze.ts';
import { type Language, readsAsCode } from './language.ts';
import { analyzePython } from './python/analyze.ts';

/**
 * The analyser: read, parse and reduce a file set to facts, with bounded concurrency and a cache keyed
 * by content.
 *
 * The cache key is the file digest plus the analyser version, so editing one file in a large repository
 * reanalyses one file, and changing the analyser invalidates everything it produced. Nothing is reused
 * across an analyser change, because silently serving stale analysis is worse than being slow.
 */

export const ANALYZER_VERSION = '6';

export type FactCache = {
  readonly get: (key: string) => ModuleFacts | undefined;
  readonly set: (key: string, facts: ModuleFacts) => void;
};

/**
 * A cache for a process that scans one repository more than once, bounded by how many files a scan may hold.
 *
 * The bound is the caller's `analysis.maxFiles`, which is the same number that bounds a traversal, so one
 * whole scan always fits and nothing older than one scan survives. A long lived server watching a
 * repository being edited would otherwise keep a copy of every version of every file it ever parsed, which
 * is a queue with no ceiling wearing a cache's name. Oldest first, by insertion, because what is worth
 * keeping is the revision on disk and the revisions before it are what the editing produced.
 */
export const inMemoryFactCache = (
  capacity: number,
): FactCache & { readonly size: () => number } => {
  const entries = new Map<string, ModuleFacts>();
  return {
    get: (key) => entries.get(key),
    set: (key, facts) => {
      entries.set(key, facts);
      while (entries.size > capacity) {
        const oldest = entries.keys().next();
        if (oldest.done === true) break;
        entries.delete(oldest.value);
      }
    },
    size: () => entries.size,
  };
};

export const cacheKey = (file: SourceFile, contentHash: string): string =>
  `${ANALYZER_VERSION}:${file.language}:${file.path}:${contentHash}`;

/**
 * Diagnostic used by the doctor command. The JavaScript parser ships as a platform specific binding, so a broken or
 * missing binding has to be reported before an audit rather than during one.
 */
export const probeJavaScriptParser = (): { readonly ok: boolean; readonly detail: string } => {
  try {
    const facts = analyzeJavaScript({
      file: 'probe.ts',
      text: 'export const probe = (value: number): number => value + 1;\n',
      contentHash: '0'.repeat(64),
      language: 'typescript',
    });
    return facts.parseErrors.length === 0
      ? { ok: true, detail: 'oxc-parser loaded and parsed a probe file' }
      : {
          ok: false,
          detail: `the parser reported ${facts.parseErrors.length} error(s) on a valid file`,
        };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : 'the JavaScript parser could not be loaded',
    };
  }
};

/**
 * The languages this build reads. Everything else is discovered, counted and never parsed.
 *
 * One definition, in `language.ts` where a fact about a language belongs. This name is what the rest of
 * the workspace asks by, and it existed here as a second copy of the same three comparisons.
 */
export const isSupportedLanguage = (language: Language): boolean => readsAsCode(language);

export type AnalysisResult = {
  readonly facts: readonly ModuleFacts[];
  readonly skipped: readonly SkippedFile[];
  readonly bytesParsed: number;
  readonly cacheHits: number;
  readonly languages: readonly { readonly language: string; readonly fileCount: number }[];
};

const analyzeOne = async (
  contents: FileContents,
  cache: FactCache | undefined,
): Promise<{
  facts: ModuleFacts | undefined;
  skipped: SkippedFile | undefined;
  cached: boolean;
}> => {
  const key = cacheKey(contents.file, contents.hash);
  const cached = cache?.get(key);
  if (cached !== undefined) return { facts: cached, skipped: undefined, cached: true };

  const language = contents.file.language;
  let facts: ModuleFacts;
  try {
    if (language === 'typescript' || language === 'javascript') {
      facts = analyzeJavaScript({
        file: contents.file.path,
        text: contents.text,
        contentHash: contents.hash,
        language,
      });
    } else if (language === 'python') {
      facts = await analyzePython({
        file: contents.file.path,
        text: contents.text,
        contentHash: contents.hash,
      });
    } else {
      return { facts: undefined, skipped: undefined, cached: false };
    }
  } catch (error) {
    return {
      facts: undefined,
      skipped: {
        file: contents.file.path,
        reason: 'parse_error',
        detail: error instanceof Error ? error.message : 'the parser failed',
      },
      cached: false,
    };
  }
  cache?.set(key, facts);
  return { facts, skipped: undefined, cached: false };
};

export type AnalyzeOptions = {
  readonly deadline: Deadline;
  readonly concurrency: number;
  readonly cache?: FactCache;
  /**
   * Called once per parsed file, with how many are done and how many there are.
   *
   * Reading a file and parsing it are both synchronous, so this phase holds the event loop for as long
   * as it runs and nothing on a timer can paint while it does: measured on `crewai`, 2.8 seconds of
   * parsing drew two spinner frames. This is the only moment the work hands control back, which makes
   * it the only place a caller can be told anything at all. The total is known here, so a caller can
   * show a real count rather than inventing a percentage.
   */
  readonly onFileParsed?: (completed: number, total: number) => void;
};

/**
 * Analyses every parseable file in a file set. Files that cannot be read or parsed become recorded
 * skips: one unparseable file never ends a scan, and the reason reaches the coverage report.
 */
export const analyzeFileSet = async (
  fileSet: FileSet,
  options: AnalyzeOptions,
): Promise<AnalysisResult> => {
  const parseable = fileSet.files.filter((file) => isSupportedLanguage(file.language));

  let parsed = 0;
  const settled = await settleWithConcurrency(
    parseable,
    { concurrency: options.concurrency, deadline: options.deadline, what: 'source analysis' },
    (file) => {
      const contents = readSource(file);
      const result = isSkipped(contents)
        ? { skipped: contents, facts: undefined, cached: false }
        : analyzeOne(contents, options.cache);
      parsed += 1;
      options.onFileParsed?.(parsed, parseable.length);
      return Promise.resolve(result);
    },
  );

  const facts: ModuleFacts[] = [];
  const skipped: SkippedFile[] = [...fileSet.skipped];
  let bytesParsed = 0;
  let cacheHits = 0;
  const languageCounts = new Map<string, number>();

  for (const entry of settled) {
    if (!entry.ok) {
      skipped.push({
        file: entry.item.path,
        reason: 'parse_error',
        detail: entry.error instanceof Error ? entry.error.message : 'analysis failed',
      });
      continue;
    }
    if (entry.value.skipped !== undefined) {
      skipped.push(entry.value.skipped);
      continue;
    }
    if (entry.value.facts === undefined) continue;
    facts.push(entry.value.facts);
    bytesParsed += entry.item.byteLength;
    if (entry.value.cached) cacheHits += 1;
    languageCounts.set(entry.item.language, (languageCounts.get(entry.item.language) ?? 0) + 1);
  }

  return {
    facts,
    skipped,
    bytesParsed,
    cacheHits,
    languages: [...languageCounts].map(([language, fileCount]) => ({ language, fileCount })),
  };
};
