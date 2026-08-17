import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Command } from 'commander';
import { commandPaths, nearestCommand, typedCommandIn } from '../src/unknown-command.ts';

/**
 * What the interface says when a caller names a command that does not exist.
 *
 * `orchescope validate <goal>` answered with the entire top level help and no suggestion, leaving the
 * reader to notice that the command they wanted is `orchescope goal validate`. A nested command is the
 * case a suggestion is most needed for and the one a parser that only searches its own level cannot
 * make.
 */

const program = (): Command => {
  const root = new Command('orchescope');
  root.command('audit');
  root.command('trace');
  const goal = root.command('goal');
  goal.command('create');
  goal.command('validate');
  const mcp = root.command('mcp');
  mcp.command('serve');
  return root;
};

describe('the commands a caller can name', () => {
  it('includes the nested ones, which is where the suggestion has to come from', () => {
    assert.deepEqual([...commandPaths(program())].sort(), [
      'audit',
      'goal',
      'goal create',
      'goal validate',
      'mcp',
      'mcp serve',
      'trace',
    ]);
  });
});

describe('the nearest command to a word that is not one', () => {
  const paths = commandPaths(program());

  it('finds a nested command whose last word is what the caller typed', () => {
    assert.equal(nearestCommand('validate', paths), 'goal validate');
  });

  it('forgives a typo', () => {
    assert.equal(nearestCommand('audti', paths), 'audit');
  });

  /* Two edits on a short word is where a suggestion stops being one and starts being a guess. */
  it('offers nothing rather than something wrong', () => {
    assert.equal(nearestCommand('frobnicate', paths), undefined);
  });

  it('prefers the shallower command when two are equally near', () => {
    assert.equal(nearestCommand('goal', paths), 'goal');
  });
});

describe('the word the parser could not resolve', () => {
  it('is read from the message the parser already wrote', () => {
    assert.equal(typedCommandIn("error: unknown command 'validate'"), 'validate');
  });

  it('is absent for a failure that names no command', () => {
    assert.equal(typedCommandIn("error: unknown option '--nope'"), undefined);
  });
});
