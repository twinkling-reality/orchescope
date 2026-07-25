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
import { analyzePython } from './python/analyze.ts';

/**
 * The analyser: read, parse and reduce a file set to facts, with bounded concurrency and a cache keyed
 * by content.
 *
 * The cache key is the file digest plus the analyser version, so editing one file in a large repository
 * reanalyses one file, and changing the analyser invalidates everything it produced. Nothing is reused
 * across an analyser change, because silently serving stale analysis is worse than being slow.
 */

export const ANALYZER_VERSION = '1';

export type FactCache = {
  readonly get: (key: string) => ModuleFacts | undefined;
  readonly set: (key: string, facts: ModuleFacts) => void;
};

export const inMemoryFactCache = (): FactCache & { readonly size: () => number } => {
  const entries = new Map<string, ModuleFacts>();
  return {
    get: (key) => entries.get(key),
    set: (key, facts) => {
      entries.set(key, facts);
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
};

/**
 * Analyses every parseable file in a file set. Files that cannot be read or parsed become recorded
 * skips: one unparseable file never ends a scan, and the reason reaches the coverage report.
 */
export const analyzeFileSet = async (
  fileSet: FileSet,
  options: AnalyzeOptions,
): Promise<AnalysisResult> => {
  const parseable = fileSet.files.filter(
    (file) =>
      file.language === 'typescript' ||
      file.language === 'javascript' ||
      file.language === 'python',
  );

  const settled = await settleWithConcurrency(
    parseable,
    { concurrency: options.concurrency, deadline: options.deadline, what: 'source analysis' },
    (file) => {
      const contents = readSource(file);
      return isSkipped(contents)
        ? Promise.resolve({ skipped: contents, facts: undefined, cached: false })
        : Promise.resolve(analyzeOne(contents, options.cache));
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
