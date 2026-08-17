/**
 * The files a repository has already said are not part of it.
 *
 * Traversal excluded a fixed list of directory names, which is a guess at what `.gitignore` says and loses
 * to every project that puts its build output somewhere else. A repository was reported as containing dead
 * scaffolding and generated output its author had excluded years earlier, and the components that came
 * from it were true statements about files nobody considers part of the codebase.
 *
 * The name list stays. It covers `node_modules` and the toolchain directories that are excluded by
 * convention rather than by a rule, and a repository with no ignore file at all still needs it.
 *
 * What is implemented here is the pattern language, not git. The index is not read, so a file that is
 * ignored and tracked anyway is treated as ignored, which is the direction that omits rather than invents.
 * Coverage names every file this skips and the rule that skipped it, so the omission is visible.
 */

type IgnoreRule = {
  readonly negated: boolean;
  readonly directoryOnly: boolean;
  readonly matcher: RegExp;
  /** Where the rule was written, so a skipped file can name what excluded it. */
  readonly origin: string;
  /** Directory the rule was declared in, relative to the root, or the empty string at the root. */
  readonly base: string;
};

const REGEXP_SPECIAL = /[.+^${}()|[\]\\]/;

/**
 * One pattern as an expression over the path relative to the directory that declared it.
 *
 * The three wildcards differ in what they may cross. `*` and `?` stop at a separator, and `**` is the only
 * one that spans directories, which is why it is read before `*` rather than as two of them.
 */
const translate = (pattern: string): string => {
  let expression = '';
  let index = 0;
  while (index < pattern.length) {
    const character = pattern[index] ?? '';
    if (character === '*' && pattern[index + 1] === '*') {
      const precededBySlash = index === 0 || pattern[index - 1] === '/';
      const followedBySlash = pattern[index + 2] === '/';
      if (precededBySlash && followedBySlash) {
        expression += '(?:.*/)?';
        index += 3;
        continue;
      }
      expression += '.*';
      index += 2;
      continue;
    }
    if (character === '*') {
      expression += '[^/]*';
      index += 1;
      continue;
    }
    if (character === '?') {
      expression += '[^/]';
      index += 1;
      continue;
    }
    if (character === '[') {
      const close = pattern.indexOf(']', index + 1);
      if (close > index) {
        const body = pattern.slice(index + 1, close).replace('!', '^');
        expression += `[${body}]`;
        index = close + 1;
        continue;
      }
    }
    expression += REGEXP_SPECIAL.test(character) ? `\\${character}` : character;
    index += 1;
  }
  return expression;
};

/**
 * One line of an ignore file, or nothing when the line is not a rule.
 *
 * A pattern holding a separator anywhere but its end is anchored to the directory that declared it, and
 * one without is matched at any depth below it. That distinction is the whole difference between `build/`,
 * which excludes every such directory in the subtree, and `/build/`, which excludes one.
 */
const parseRule = (line: string, base: string, origin: string): IgnoreRule | undefined => {
  const trimmed = line.replace(/\s+$/, '');
  if (trimmed.length === 0 || trimmed.startsWith('#')) return undefined;
  const negated = trimmed.startsWith('!');
  let pattern = negated ? trimmed.slice(1) : trimmed;
  if (pattern.startsWith('\\#') || pattern.startsWith('\\!')) pattern = pattern.slice(1);
  const directoryOnly = pattern.endsWith('/');
  if (directoryOnly) pattern = pattern.slice(0, -1);
  if (pattern.length === 0) return undefined;
  const anchored = pattern.includes('/');
  if (pattern.startsWith('/')) pattern = pattern.slice(1);
  const body = translate(pattern);
  /*
   * Anything below a match is excluded too. Git tests directories as it walks and never enters an excluded
   * one, and this is asked about files as well, so the subtree has to be part of the expression.
   */
  const matcher = new RegExp(`^${anchored ? '' : '(?:.*/)?'}${body}(?:/.*)?$`);
  return { negated, directoryOnly, matcher, origin, base };
};

export type IgnoreRules = {
  /**
   * The rule excluding this path, or nothing.
   *
   * The last rule to match decides, which is what lets a later negation re-include something an earlier
   * pattern excluded. A negation cannot rescue a path inside an excluded directory, because traversal
   * never enters one, and that is git's behaviour rather than a simplification of it.
   */
  readonly excludedBy: (relativePath: string, isDirectory: boolean) => string | undefined;
  /** These rules with the ones declared in a directory folded in, for walking into it. */
  readonly extendedWith: (directory: string, contents: string) => IgnoreRules;
};

const rulesFrom = (rules: readonly IgnoreRule[]): IgnoreRules => ({
  excludedBy: (relativePath, isDirectory) => {
    let excluded: string | undefined;
    for (const rule of rules) {
      if (rule.directoryOnly && !isDirectory) continue;
      if (rule.base.length > 0 && !relativePath.startsWith(`${rule.base}/`)) continue;
      const within =
        rule.base.length === 0 ? relativePath : relativePath.slice(rule.base.length + 1);
      if (!rule.matcher.test(within)) continue;
      excluded = rule.negated ? undefined : rule.origin;
    }
    return excluded;
  },
  extendedWith: (directory, contents) =>
    rulesFrom([
      ...rules,
      ...contents
        .split('\n')
        .map((line) =>
          parseRule(
            line,
            directory,
            `${directory.length === 0 ? '' : `${directory}/`}.gitignore`.replace(/^\//, ''),
          ),
        )
        .filter((rule): rule is IgnoreRule => rule !== undefined),
    ]),
});

export const noIgnoreRules = (): IgnoreRules => rulesFrom([]);
