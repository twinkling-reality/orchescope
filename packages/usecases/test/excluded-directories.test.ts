import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_EXCLUDED_DIRECTORIES as TRAVERSAL_DEFAULTS } from '@orchescope/source-analysis';
import { DEFAULT_EXCLUDED_DIRECTORIES as CONFIG_DEFAULTS } from '@orchescope/workspace';

/**
 * The list of directories analysis never enters is stated twice on purpose: the traversal owns one, and the workspace
 * writes the other into a configuration file a user may edit, so that removing an entry there has the effect the user
 * asked for rather than being silently restored.
 *
 * The comment beside the second copy said the two were kept in step by a test. There was no such test, and the first
 * time one list gained an entry the other did not, which is how a repository with an iOS target came to have eight and
 * a half thousand vendored symbolic links walked and reported. This is that test, written after the thing it was
 * supposed to prevent had already happened once.
 *
 * It lives here because this is the layer where the two meet: the traversal is a core package, the workspace is
 * assembly, and the use cases compose both. Neither of them may import the other, which is the reason the duplication
 * exists at all.
 */

describe('the directories analysis never enters', () => {
  it('are the same list wherever they are stated', () => {
    assert.deepEqual(
      [...CONFIG_DEFAULTS].sort(),
      [...TRAVERSAL_DEFAULTS].sort(),
      'the traversal default and the configuration default have drifted apart',
    );
  });

  it('name a directory rather than a path, because they are matched against one path segment', () => {
    for (const entry of TRAVERSAL_DEFAULTS) {
      assert.equal(entry.includes('/'), false, `${entry} is a path rather than a directory name`);
      assert.notEqual(entry, '', 'an empty entry would exclude everything');
    }
  });
});
