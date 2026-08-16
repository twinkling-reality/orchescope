import { ignoreRuleFor } from './git.ts';
import { ORCHESCOPE_DIRECTORY } from './paths.ts';

/**
 * Whether the configuration a project grants can be committed, and what to change when it cannot.
 *
 * `orchescope init` says `.orchescope/config.json` is meant to be committed, and writes a `.gitignore`
 * inside `.orchescope` saying which siblings are not. Git never consults a `.gitignore` inside a
 * directory an ancestor rule has already excluded, so a host repository whose root file carries
 * `/.orchescope/` gets the sentence and not the behaviour: the permissions that project grants stay out
 * of its own history and nothing says so.
 *
 * The fix is not the one that first suggests itself. Adding `!/.orchescope/config.json` beneath the
 * existing rule does nothing, because git will not re-include a file whose parent directory is excluded;
 * that was measured against git rather than reasoned about. What works is excluding the directory's
 * contents instead of the directory, so the negation has an entry to apply to.
 */

export type ExcludedConfig = {
  /** The rule as git reports it: source, line and pattern. */
  readonly rule: string;
  /** The lines that replace the excluding pattern, in the file that carries it. */
  readonly fix: readonly string[];
};

const CONFIG_PATH = `${ORCHESCOPE_DIRECTORY}/config.json`;

/** Splits `path/to/.gitignore:12:/pattern/` from the right, since a line number is the one field of known shape. */
const PRINTED_RULE = /^(.*):(\d+):(.*)$/;

/**
 * The replacement for a pattern that excludes a whole directory.
 *
 * Derived from the pattern git named so the lines can be pasted into the file git named. A pattern of
 * another shape, for example one excluding a distant ancestor, gets the canonical pair instead: it still
 * says what has to be true, and inventing a rewrite for a rule this cannot read would be a guess printed
 * as an instruction.
 */
const fixFor = (pattern: string): readonly string[] =>
  pattern.endsWith('/')
    ? [`${pattern}*`, `!${pattern}config.json`]
    : [`/${ORCHESCOPE_DIRECTORY}/*`, `!/${CONFIG_PATH}`];

export const excludedConfig = (root: string): ExcludedConfig | undefined => {
  const rule = ignoreRuleFor(root, CONFIG_PATH);
  if (rule === undefined) return undefined;
  const pattern = PRINTED_RULE.exec(rule)?.[3];
  return { rule, fix: fixFor(pattern ?? '') };
};
