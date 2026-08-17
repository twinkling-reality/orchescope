import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { noIgnoreRules } from '../src/ignore-rules.ts';

/**
 * The pattern language, checked against what git actually does with each shape.
 *
 * Traversal excluded a fixed list of directory names, which is a guess at what an ignore file says. The
 * guess is wrong in both directions: it misses build output a project puts somewhere else, and it reads
 * nothing at all about the local artefacts a working checkout accumulates.
 */

const atRoot = (...lines: readonly string[]) => noIgnoreRules().extendedWith('', lines.join('\n'));

describe('ignore rules', () => {
  it('ignores blank lines and comments', () => {
    const rules = atRoot('', '# a comment', 'dist');
    assert.equal(rules.excludedBy('dist', true) !== undefined, true);
    assert.equal(rules.excludedBy('a comment', false), undefined);
  });

  it('matches a bare name at any depth', () => {
    const rules = atRoot('coverage');
    assert.ok(rules.excludedBy('coverage', true));
    assert.ok(rules.excludedBy('packages/web/coverage', true));
  });

  it('anchors a pattern that carries a separator', () => {
    const rules = atRoot('/build');
    assert.ok(rules.excludedBy('build', true));
    assert.equal(rules.excludedBy('packages/web/build', true), undefined);
  });

  it('excludes everything under a match, since traversal stops at the directory', () => {
    const rules = atRoot('dist');
    assert.ok(rules.excludedBy('dist/index.js', false));
    assert.ok(rules.excludedBy('packages/web/dist/deep/thing.js', false));
  });

  it('applies a trailing slash to a directory and not to a file of the same name', () => {
    const rules = atRoot('tmp/');
    assert.ok(rules.excludedBy('tmp', true));
    assert.equal(rules.excludedBy('tmp', false), undefined);
  });

  it('stops a wildcard at a separator and lets a double wildcard cross one', () => {
    assert.equal(atRoot('*.d.ts').excludedBy('src/thing.d.ts', false) !== undefined, true);
    assert.equal(atRoot('src/*.ts').excludedBy('src/deep/thing.ts', false), undefined);
    assert.ok(atRoot('src/**/thing.ts').excludedBy('src/deep/down/thing.ts', false));
  });

  it('lets a later negation re-include what an earlier pattern excluded', () => {
    const rules = atRoot('*.d.ts', '!vite-env.d.ts');
    assert.ok(rules.excludedBy('src/thing.d.ts', false));
    assert.equal(rules.excludedBy('vite-env.d.ts', false), undefined);
  });

  /*
   * A nested file speaks about its own directory. Reading its patterns against the repository root would
   * apply one package's exclusions to every other package that happens to share a directory name.
   */
  it('reads a nested ignore file relative to the directory that declares it', () => {
    const rules = atRoot('coverage').extendedWith('packages/web', 'build/\n');
    assert.ok(rules.excludedBy('packages/web/build', true));
    assert.equal(rules.excludedBy('packages/api/build', true), undefined);
    assert.match(rules.excludedBy('packages/web/build', true) ?? '', /packages\/web\/\.gitignore/);
  });

  it('names the file that excluded a path, so a reader can disagree with it', () => {
    assert.equal(atRoot('dist').excludedBy('dist', true), '.gitignore');
  });

  it('excludes nothing when there are no rules', () => {
    assert.equal(noIgnoreRules().excludedBy('src/main.ts', false), undefined);
  });
});
