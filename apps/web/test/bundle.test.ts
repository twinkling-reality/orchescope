/// <reference types="node" />

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isPlaceholder,
  parseBundleJson,
  REPORT_PLACEHOLDER,
  validateBundle,
} from '../src/bundle.ts';
import { bundle } from './fixture.ts';

describe('isPlaceholder', () => {
  it('recognises the untouched placeholder, with or without surrounding whitespace', () => {
    assert.equal(isPlaceholder(REPORT_PLACEHOLDER), true);
    assert.equal(isPlaceholder(`\n  ${REPORT_PLACEHOLDER}\n`), true);
  });

  it('does not recognise a substituted document', () => {
    assert.equal(isPlaceholder('{"schemaVersion":1}'), false);
    assert.equal(isPlaceholder(''), false);
  });

  it('spells the placeholder exactly as the build script writes it', () => {
    assert.equal(REPORT_PLACEHOLDER, '__ORCHESCOPE_REPORT__');
  });
});

describe('validateBundle', () => {
  it('accepts a structurally valid bundle and reports nothing repaired', () => {
    const result = validateBundle(bundle());
    assert.ok(result.ok);
    assert.deepEqual(result.repaired, []);
  });

  it('rejects anything that is not an object', () => {
    for (const value of [null, 42, 'text', [], undefined]) {
      const result = validateBundle(value);
      assert.equal(result.ok, false);
    }
  });

  it('names every missing identity field rather than failing on the first', () => {
    const result = validateBundle({ graph: {}, summary: {} });
    if (result.ok) {
      assert.fail('expected an empty object to be rejected');
    }
    for (const field of ['schemaVersion', 'reportId', 'projectName', 'generatedAt']) {
      assert.ok(
        result.problems.some((problem) => problem.includes(field)),
        `expected a problem naming ${field}`,
      );
    }
  });

  it('rejects a bundle whose graph is missing its component list', () => {
    const result = validateBundle({
      ...bundle(),
      graph: { edges: [], coverage: {}, provenance: {} },
    });
    if (result.ok) {
      assert.fail('expected a graph without components to be rejected');
    }
    assert.ok(result.problems.some((problem) => problem.includes('graph.components')));
  });

  it('rejects a bundle whose summary counts are not numbers', () => {
    const base = bundle();
    const result = validateBundle({
      ...base,
      summary: { ...base.summary, componentCount: 'many' },
    });
    if (result.ok) {
      assert.fail('expected a non numeric count to be rejected');
    }
    assert.ok(result.problems.some((problem) => problem.includes('summary.componentCount')));
  });

  it('defaults absent optional arrays to empty and names each one it repaired', () => {
    const omitted = new Set(['findings', 'goals', 'overlays', 'metadata']);
    const partial = Object.fromEntries(
      Object.entries(bundle()).filter(([key]) => !omitted.has(key)),
    );
    const result = validateBundle(partial);
    assert.ok(result.ok);
    assert.deepEqual(result.bundle.findings, []);
    assert.deepEqual(result.bundle.goals, []);
    assert.deepEqual(result.bundle.overlays, []);
    assert.deepEqual([...result.repaired].sort(), ['findings', 'goals', 'metadata', 'overlays']);
  });
});

describe('parseBundleJson', () => {
  it('parses a serialised bundle', () => {
    const result = parseBundleJson(JSON.stringify(bundle({ projectName: 'orchescope' })));
    assert.ok(result.ok);
    assert.equal(result.bundle.projectName, 'orchescope');
  });

  it('explains invalid JSON instead of throwing', () => {
    const result = parseBundleJson('{ not json');
    if (result.ok) {
      assert.fail('expected malformed JSON to be rejected');
    }
    assert.ok(result.problems[0]?.includes('not valid JSON'));
  });

  it('explains an empty document', () => {
    const result = parseBundleJson('   ');
    if (result.ok) {
      assert.fail('expected an empty document to be rejected');
    }
    assert.ok(result.problems[0]?.includes('empty'));
  });
});
