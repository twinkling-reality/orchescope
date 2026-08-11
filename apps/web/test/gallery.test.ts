/// <reference types="node" />

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GALLERY_ELEMENT_ID,
  type GallerySource,
  readGallery,
} from '../src/presentation/gallery.ts';

const source = (textContent: string | null): GallerySource => ({
  getElementById: (id) => (id === GALLERY_ELEMENT_ID ? { textContent } : null),
});

const empty: GallerySource = { getElementById: () => null };

const entry = (overrides: Record<string, unknown> = {}) => ({
  page: 'crewai.html',
  project: 'crewai',
  components: 987,
  runs: 0,
  current: false,
  ...overrides,
});

describe('readGallery', () => {
  it('finds nothing in a report the real command produced', () => {
    assert.deepEqual(readGallery(empty), []);
  });

  it('reads the list a gallery page carries', () => {
    const entries = readGallery(source(JSON.stringify([entry(), entry({ current: true })])));
    assert.equal(entries.length, 2);
    assert.equal(entries[0]?.project, 'crewai');
    assert.equal(entries[1]?.current, true);
  });

  it('returns nothing rather than a partial list when one entry is malformed', () => {
    // A picker missing half its entries reads as a complete answer, which is worse than no picker.
    assert.deepEqual(readGallery(source(JSON.stringify([entry(), { page: 'x.html' }]))), []);
  });

  it('returns nothing for content that is not JSON at all', () => {
    assert.deepEqual(readGallery(source('not json')), []);
  });

  it('returns nothing for an empty or absent element body', () => {
    assert.deepEqual(readGallery(source('')), []);
    assert.deepEqual(readGallery(source(null)), []);
  });

  it('returns nothing for JSON that is not a list', () => {
    assert.deepEqual(readGallery(source(JSON.stringify({ page: 'a.html' }))), []);
  });

  it('refuses a page reference that is not a sibling file', () => {
    for (const page of [
      '../secrets.html',
      'nested/report.html',
      'https://example.com/x.html',
      'javascript:alert(1)',
      '',
    ]) {
      assert.deepEqual(
        readGallery(source(JSON.stringify([entry({ page })]))),
        [],
        `${page} was accepted as a sibling page`,
      );
    }
  });

  it('accepts a list with nothing in it', () => {
    assert.deepEqual(readGallery(source('[]')), []);
  });
});
