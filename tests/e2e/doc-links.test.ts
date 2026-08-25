import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  brokenInternalLinks,
  documentationFiles,
  internalTargets,
  proseOf,
} from '../../scripts/check-doc-links.mjs';

describe('internal documentation links', () => {
  it('does not treat a call or a grep pattern inside code as a hyperlink', () => {
    assert.deepEqual(internalTargets('so `listeners[i](1)` is recorded'), []);
    assert.deepEqual(
      internalTargets(
        '```\ngrep -rhoE "from [\'\\"](@langchain/[a-z-]+|@modelcontextprotocol/[a-z-]+)"\n```\n',
      ),
      [],
    );
    assert.equal(proseOf('`listeners[i](1)`').includes(']('), false);
  });

  it('still reports a prose link whose target is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'orchescope-doc-links-'));
    const file = join(root, 'note.md');
    writeFileSync(file, 'See [missing](absent.md) and `keep[i](1)`.\n');
    assert.deepEqual(brokenInternalLinks([file]), [`${file} -> absent.md`]);
  });

  it('accepts a prose link whose target exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'orchescope-doc-links-'));
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'docs', 'target.md'), 'ok\n');
    const file = join(root, 'note.md');
    writeFileSync(file, 'See [target](docs/target.md).\n');
    assert.deepEqual(brokenInternalLinks([file]), []);
  });

  it('finds no broken prose links in this repository', () => {
    const root = join(import.meta.dirname, '../..');
    const files = documentationFiles(root);
    assert.ok(files.length > 0);
    assert.deepEqual(brokenInternalLinks(files), []);
  });
});
