import type { Command } from 'commander';

/**
 * What to say when the caller names a command that does not exist.
 *
 * The argument parser printed the whole top level help and no suggestion, so `orchescope validate <goal>`
 * answered with fourteen commands and left the reader to notice that the one they wanted is
 * `orchescope goal validate`. A nested command is the case a suggestion is most needed for and the one a
 * parser that only knows its own level cannot make: `validate` is not a top level command and is an exact
 * match for the last segment of one.
 *
 * It also ignored `--json`, in an interface whose help promises that every command accepts it and then
 * writes exactly one document, including on failure. A caller that scripts against this got help text on
 * standard error and nothing to parse.
 */

/** Every command a caller can name, as the words they would type, deepest first. */
export const commandPaths = (program: Command): readonly string[] => {
  const paths: string[] = [];
  const walk = (command: Command, prefix: readonly string[]): void => {
    for (const child of command.commands) {
      const here = [...prefix, child.name()];
      paths.push(here.join(' '));
      walk(child, here);
    }
  };
  walk(program, []);
  return paths;
};

/**
 * How near two words are, counted as single character edits.
 *
 * Bounded by the length of the two words, which is what makes this safe to run against every command
 * path: the vocabulary is a closed list this binary declares and the typed word is one argument.
 */
const editDistance = (left: string, right: string): number => {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      const substitution =
        (previous[column - 1] as number) + (left[row - 1] === right[column - 1] ? 0 : 1);
      current.push(
        Math.min(
          substitution,
          (previous[column] as number) + 1,
          (current[column - 1] as number) + 1,
        ),
      );
    }
    previous = current;
  }
  return previous[right.length] as number;
};

/**
 * A typed word is close enough when it is the last segment of a command path, or within one or two edits
 * of one. Two edits on a short word is where a suggestion stops being a suggestion and starts being a
 * guess, so nothing is offered rather than something wrong.
 */
const MAX_EDITS = 2;

export const nearestCommand = (typed: string, paths: readonly string[]): string | undefined => {
  const word = typed.toLowerCase();
  const scored = paths
    .map((path) => {
      const last = (path.split(' ').at(-1) ?? path).toLowerCase();
      return { path, distance: last === word ? 0 : editDistance(word, last) };
    })
    .filter((candidate) => candidate.distance <= MAX_EDITS)
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        left.path.split(' ').length - right.path.split(' ').length ||
        left.path.localeCompare(right.path),
    );
  return scored[0]?.path;
};

/**
 * The name the caller typed, taken from the message rather than from the arguments.
 *
 * The parser has already decided which word it could not resolve, and re-deriving that from `argv` would
 * mean reimplementing its option parsing to know which words are values.
 */
export const typedCommandIn = (message: string): string | undefined =>
  /unknown command '([^']+)'/.exec(message)?.[1];
