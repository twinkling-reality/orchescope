import { type Language, readsAsCode } from './language.ts';

/**
 * Whether a file was written by a program rather than by a person.
 *
 * A pattern matcher fed bundler output finds patterns. Across a sweep of thirty six repositories the
 * retry rules fired in three, and two of those three matched inside build artifacts: a documentation
 * bundle and a packaged extension asset. Minified code is pathologically good at tripping a matcher that
 * looks for a loop around a `try` around an `await`, because a bundle concentrates the whole of a
 * dependency tree into one file, and the components it raises are minifier symbols. `entrypoint:jy`
 * entered a component graph, was counted in the inventory and was named in a finding.
 *
 * The default exclusion list is by directory name and will always lose this race: it does not know about
 * `.docs-out`, or `packages/extension/media/assets`, and the one bundle it did miss escaped only because
 * it tripped the file size ceiling. So this asks the file rather than the path. It runs once, before any
 * analyser sees the text, which is what makes it hold for every adapter and every rule at once rather
 * than for the two rules that happened to be reported.
 *
 * The bar is deliberately high in one direction. Skipping a person's source silently removes their system
 * from the audit, which is worse than the false positives this exists to remove, so every signal here is
 * one that hand written code essentially never produces, and the shape signals must agree before a file
 * is set aside.
 */

/** The strings a generator writes into a header, spelled out so the matcher is anchored to a comment. */
const AUTHORSHIP_MARKER = /@generated\b/;
const IMMUTABILITY_MARKER = /\bdo not edit\b/i;
const GENERATION_WORD = /\bgenerated\b/i;

/** A line that opens or continues a comment in any of the languages this build reads. */
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*|#)/;

/** A source map trailer, which a compiler or a bundler appends and a person does not write. */
const SOURCE_MAP_TRAILER = /^\s*(\/\/|\/\*)#\s*sourceMappingURL=/;

/** Header lines a generator's notice appears within. Past this a file is describing something else. */
const HEADER_LINES = 20;

/** Trailing lines a source map reference appears within, allowing for a final newline and a blank. */
const TRAILER_LINES = 5;

/**
 * Below this a file is too small for its shape to mean anything. One dense line of real code averages
 * well over the thresholds below and says nothing about the file it sits in.
 */
const MINIMUM_BYTES_FOR_SHAPE = 512;

/**
 * Mean characters per non empty line.
 *
 * Measured across this repository's own source and four published bundles: hand written files average
 * between 40 and 44 characters a line whatever the formatter, and the bundles average from 166 for one
 * that kept its statement breaks to 31,616 for one packed onto a single line. A hundred and twenty sits
 * in the empty space between them with room for a project whose formatter is set wider than most.
 */
const MINIFIED_LINE_LENGTH = 120;

/**
 * Share of identifier tokens no longer than two characters.
 *
 * The same measurement: nine to twelve percent in hand written source, thirty to fifty in the bundles. A
 * minifier renames what it can from a two character alphabet and leaves the rest, so this counts what it
 * renamed rather than looking for names it could not touch.
 */
const MINIFIED_SHORT_NAME_SHARE = 0.25;

/** Identifiers no longer than this are what a minifier assigns. */
const SHORT_NAME_LENGTH = 2;

/** How much of a file is read for its identifier shape, so a large file costs a bounded amount. */
const SHAPE_SAMPLE_BYTES = 64 * 1024;

const IDENTIFIER = /[A-Za-z_$][A-Za-z0-9_$]*/g;

const meanOf = (total: number, count: number): number => (count === 0 ? 0 : total / count);

/** The index just past a line comment that starts at `from`. */
const pastLineComment = (text: string, from: number): number => {
  let index = from;
  while (index < text.length && text[index] !== '\n') index += 1;
  return index;
};

/** The index just past a block comment that starts at `from`. */
const pastBlockComment = (text: string, from: number): number => {
  let index = from + 2;
  while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index += 1;
  return index + 2;
};

/**
 * The index just past a quoted literal that opens at `from`, and the newlines it spanned.
 *
 * The newlines come back so that stripping a literal does not join the lines around it, which would make
 * a file of short lines look like a file of long ones.
 */
const pastLiteral = (
  text: string,
  from: number,
  quote: string,
  spansLines: boolean,
): { readonly index: number; readonly newlines: number } => {
  let index = from + 1;
  let newlines = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === quote) return { index: index + 1, newlines };
    if (char === '\n') {
      if (!spansLines) return { index, newlines };
      newlines += 1;
    }
    index += 1;
  }
  return { index, newlines };
};

/**
 * The code with its text taken out, which is what the shape signals are about.
 *
 * Measuring the raw file counts what is written inside strings, and that is where this first went wrong.
 * An icon component in the corpus is one hand written React function wrapping a path attribute, and the
 * single letter drawing commands inside that attribute made sixty one percent of its apparent identifiers
 * two characters or shorter, on lines averaging a hundred and thirty three characters. Both signals fired
 * on a file a person wrote, which is the failure this whole check has to avoid.
 *
 * Scanning rather than matching, because a string that ends in an escaped quote is common and a regular
 * expression that tries to know where a literal ends is how a file becomes unreadable. What survives here
 * is an approximation: a regular expression literal in JavaScript keeps its contents, which costs a little
 * accuracy on code full of patterns and never the other way.
 */
const withoutText = (text: string, language: Language): string => {
  const hashComments = language === 'python';
  const out: string[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index] as string;
    const next = text[index + 1];
    if ((char === '/' && next === '/' && !hashComments) || (char === '#' && hashComments)) {
      index = pastLineComment(text, index);
      continue;
    }
    if (char === '/' && next === '*' && !hashComments) {
      index = pastBlockComment(text, index);
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      const consumed = pastLiteral(text, index, char, char === '`' || hashComments);
      out.push('\n'.repeat(consumed.newlines));
      index = consumed.index;
      continue;
    }
    out.push(char);
    index += 1;
  }
  return out.join('');
};

const meanLineLength = (lines: readonly string[]): number => {
  let total = 0;
  let counted = 0;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    total += line.length;
    counted += 1;
  }
  return meanOf(total, counted);
};

const shortNameShare = (code: string): number => {
  let short = 0;
  let counted = 0;
  for (const match of code.matchAll(IDENTIFIER)) {
    if (match[0].length <= SHORT_NAME_LENGTH) short += 1;
    counted += 1;
  }
  return meanOf(short, counted);
};

const declaresItsOwnGeneration = (lines: readonly string[]): boolean => {
  const header = lines.slice(0, HEADER_LINES).filter((line) => COMMENT_LINE.test(line));
  if (header.some((line) => AUTHORSHIP_MARKER.test(line))) return true;
  const joined = header.join('\n');
  return IMMUTABILITY_MARKER.test(joined) && GENERATION_WORD.test(joined);
};

const carriesSourceMapTrailer = (lines: readonly string[]): boolean =>
  lines
    .filter((line) => line.trim().length > 0)
    .slice(-TRAILER_LINES)
    .some((line) => SOURCE_MAP_TRAILER.test(line));

/** The reason a file was set aside, or undefined when it reads as something a person wrote. */
export type GenerationSignal = 'declared' | 'source_map' | 'minified';

export const generationSignal = (
  text: string,
  language: Language,
): GenerationSignal | undefined => {
  if (!readsAsCode(language)) return undefined;
  const lines = text.split('\n');
  if (declaresItsOwnGeneration(lines)) return 'declared';
  if (carriesSourceMapTrailer(lines)) return 'source_map';
  if (text.length < MINIMUM_BYTES_FOR_SHAPE) return undefined;
  /*
   * Both shape signals have to agree, and both are measured on the code rather than on the file. A file of
   * one enormous encoded string has long lines and ordinary names; a file of dense numerical work has short
   * names and ordinary lines. Only output that was packed for a machine to read has both.
   */
  const code = withoutText(text.slice(0, SHAPE_SAMPLE_BYTES), language);
  if (
    meanLineLength(code.split('\n')) >= MINIFIED_LINE_LENGTH &&
    shortNameShare(code) >= MINIFIED_SHORT_NAME_SHARE
  ) {
    return 'minified';
  }
  return undefined;
};

export const generationDetail = (signal: GenerationSignal): string => {
  if (signal === 'declared') return 'the file header says a program wrote it';
  if (signal === 'source_map')
    return 'the file ends in a source map reference, so it is build output';
  return 'the line lengths and identifier names are what a minifier produces';
};
