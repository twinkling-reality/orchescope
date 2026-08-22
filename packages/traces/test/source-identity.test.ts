import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NormalizedSpan } from '@orchescope/schema';
import { sourceIdentityOf } from '../src/source-identity.ts';

const revision = 'a'.repeat(40);

const span = (attributes: NormalizedSpan['attributes']): NormalizedSpan => ({
  traceId: '1'.repeat(32),
  spanId: '2'.repeat(16),
  name: 'invoke_agent support',
  kind: 'internal',
  operation: 'invoke_agent',
  startTimeUnixNano: '1',
  endTimeUnixNano: '2',
  durationMs: 0.000001,
  status: 'ok',
  attributes,
  events: [],
  serviceName: 'support',
});

const completeAttributes = {
  'code.file.path': '/checkout/src/support.py',
  'code.line.number': 17,
  'code.function.name': 'SupportCrew.support_agent',
  'orchescope.code.repository.path': 'src/support.py',
  'vcs.repository.url.full': 'https://github.com/example/support.git',
  'vcs.ref.head.revision': revision,
};

describe('runtime source identity', () => {
  it('keeps every accepted field tied to the attribute that supplied it', () => {
    const result = sourceIdentityOf(span(completeAttributes));
    assert.deepEqual(result.observedSource, {
      identity: {
        repositoryUrl: 'https://github.com/example/support',
        revision,
        file: 'src/support.py',
        line: 17,
        function: 'SupportCrew.support_agent',
      },
      provenance: {
        repositoryUrl: {
          attributes: ['vcs.repository.url.full'],
          spanFields: [],
        },
        revision: { attributes: ['vcs.ref.head.revision'], spanFields: [] },
        file: {
          attributes: ['code.file.path', 'orchescope.code.repository.path'],
          spanFields: [],
        },
        line: { attributes: ['code.line.number'], spanFields: [] },
        function: { attributes: ['code.function.name'], spanFields: [] },
      },
    });
    assert.deepEqual(result.refusals, []);
  });

  it('retains a relative legacy location without calling it complete source identity', () => {
    const result = sourceIdentityOf(span({ 'code.file.path': 'src/support.py' }));
    assert.deepEqual(result.codeLocation, { file: 'src/support.py' });
    assert.equal(result.observedSource, undefined);
    assert.deepEqual(
      result.refusals.map((entry) => [entry.attribute, entry.reason]),
      [
        ['orchescope.code.repository.path', 'missing'],
        ['vcs.repository.url.full', 'missing'],
        ['vcs.ref.head.revision', 'missing'],
      ],
    );
  });

  it('decodes an unambiguous file URL and refuses a non-file URL', () => {
    const accepted = sourceIdentityOf(
      span({ ...completeAttributes, 'code.file.path': 'file:///checkout/src/support.py' }),
    );
    assert.equal(accepted.observedSource?.identity.file, 'src/support.py');

    const refused = sourceIdentityOf(
      span({ ...completeAttributes, 'code.file.path': 'https://example.com/src/support.py' }),
    );
    assert.equal(refused.observedSource, undefined);
    assert.ok(
      refused.refusals.some(
        (entry) => entry.attribute === 'code.file.path' && entry.reason === 'invalid_path',
      ),
    );
  });

  it('refuses conflicting span and resource repository coordinates', () => {
    const target = span(completeAttributes);
    const result = sourceIdentityOf({
      ...target,
      resourceAttributes: {
        'vcs.repository.url.full': 'https://github.com/example/other',
      },
    });
    assert.equal(result.observedSource, undefined);
    assert.ok(
      result.refusals.some(
        (entry) =>
          entry.attribute === 'vcs.repository.url.full' &&
          entry.reason === 'conflicting_attributes',
      ),
    );
  });

  it('refuses a generated path that does not resolve to the emitted repository path', () => {
    const result = sourceIdentityOf(
      span({
        ...completeAttributes,
        'code.file.path': '/checkout/dist/support.js',
        'orchescope.code.repository.path': 'src/support.ts',
      }),
    );
    assert.equal(result.observedSource, undefined);
    assert.ok(
      result.refusals.some(
        (entry) =>
          entry.attribute === 'orchescope.code.repository.path' && entry.reason === 'invalid_path',
      ),
    );
  });
});
