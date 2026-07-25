import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRedactor, DEFAULT_RULES, redactDeep } from '../src/redact.ts';

/**
 * Redaction tests.
 *
 * These assert the two properties the rest of the system depends on: a matched secret never survives in the output,
 * and the shape of what was removed is still visible so a reader is not left guessing. The cases use values with
 * credential shapes that are not real credentials.
 */

const OPENAI = 'sk-abcdefghijklmnopqrstuvwxyz0123';
const ANTHROPIC = 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAA';
const AWS = 'AKIAIOSFODNN7EXAMPLE';
const GITHUB = 'ghp_0123456789abcdefghijABCDEFGHIJKLMN';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r'; // gitleaks:allow the shape is the point of the test, and the value signs nothing

describe('createRedactor', () => {
  it('removes the value and keeps the kind and the length', () => {
    const redactor = createRedactor();
    const output = redactor.text(`authorization: ${OPENAI}`);
    assert.equal(output.includes(OPENAI), false);
    assert.equal(output, `authorization: [redacted:openai-api-key:${OPENAI.length}]`);
  });

  it('prefers the most specific rule for a value two rules can match', () => {
    const redactor = createRedactor();
    const output = redactor.text(ANTHROPIC);
    assert.match(output, /anthropic-api-key/);
    assert.equal(output.includes(ANTHROPIC), false);
  });

  it('handles every documented credential shape it claims to', () => {
    const redactor = createRedactor();
    for (const value of [OPENAI, ANTHROPIC, AWS, GITHUB, JWT, 'xoxb-1234567890-abcdefghij']) {
      const output = redactor.text(`value=${value}`);
      assert.equal(output.includes(value), false, `${value} survived redaction`);
    }
  });

  it('keeps the scheme and the host of a url but removes the credentials', () => {
    const redactor = createRedactor();
    const output = redactor.text('postgres://admin:hunter2@db.internal:5432/orders');
    assert.equal(output, 'postgres://[redacted:url-credentials]@db.internal:5432/orders');
  });

  it('removes a whole private key block rather than one line of it', () => {
    const redactor = createRedactor();
    const block = ['-----BEGIN PRIVATE KEY-----', 'AAAA', 'BBBB', '-----END PRIVATE KEY-----'].join(
      '\n',
    );
    const output = redactor.text(`key:\n${block}\nrest`);
    assert.equal(output.includes('AAAA'), false);
    assert.equal(output.includes('BBBB'), false);
    assert.match(output, /rest$/);
  });

  it('does not leak state between calls', () => {
    const redactor = createRedactor();
    const first = redactor.text(`a ${OPENAI} b ${OPENAI}`);
    const second = redactor.text(`a ${OPENAI} b ${OPENAI}`);
    assert.equal(first, second);
    assert.equal(first.match(/redacted/g)?.length, 2);
  });

  it('counts what it removed, per rule', () => {
    const redactor = createRedactor();
    redactor.text(`${OPENAI} ${GITHUB} ${GITHUB}`);
    assert.deepEqual(redactor.counts(), { 'openai-key': 1, 'github-token': 2 });
    assert.equal(redactor.totalRedactions(), 3);
  });

  it('leaves ordinary text alone', () => {
    const redactor = createRedactor();
    const text = 'The orchestrator calls issue_refund with orderId 1234 and waits 30000 ms.';
    assert.equal(redactor.text(text), text);
    assert.equal(redactor.totalRedactions(), 0);
  });

  it('masks a value whose name looks sensitive whatever its shape', () => {
    const redactor = createRedactor();
    assert.equal(redactor.environmentValue('DEMO_API_KEY', 'plain'), '[redacted:environment:5]');
    assert.equal(redactor.environmentValue('SESSION_ID', 'abc'), '[redacted:environment:3]');
    assert.equal(redactor.environmentValue('ORCHESCOPE_WORKERS', '4'), '4');
  });

  it('accepts a configured pattern and ignores one that does not compile', () => {
    const redactor = createRedactor({ extraPatterns: ['ACME-[0-9]{4}', '([unclosed'] });
    assert.equal(redactor.text('id ACME-1234'), 'id [redacted:configured-secret:9]');
  });

  it('ignores a configured pattern long enough to be a denial of service risk', () => {
    const redactor = createRedactor({ extraPatterns: ['a'.repeat(500)] });
    assert.equal(redactor.text('aaaa'), 'aaaa');
  });

  it('every default rule is global, so a second occurrence on a line is not missed', () => {
    for (const rule of DEFAULT_RULES) {
      assert.ok(rule.pattern.flags.includes('g'), `${rule.id} is not global`);
    }
  });
});

describe('redactDeep', () => {
  it('walks a structure and preserves it', () => {
    const redactor = createRedactor();
    const input = {
      env: { OPENAI_API_KEY: OPENAI, WORKERS: '4' },
      spans: [{ name: 'chat', attributes: { 'gen_ai.request.model': 'demo-small' } }],
      note: `token ${GITHUB}`,
      count: 3,
      missing: null,
    };
    const output = redactDeep(input, redactor);
    assert.equal(output.env.OPENAI_API_KEY, `[redacted:environment:${OPENAI.length}]`);
    assert.equal(output.env.WORKERS, '4');
    assert.equal(output.spans[0]?.attributes['gen_ai.request.model'], 'demo-small');
    assert.equal(output.note.includes(GITHUB), false);
    assert.equal(output.count, 3);
    assert.equal(output.missing, null);
  });

  it('stops at a depth limit rather than recursing without bound', () => {
    const redactor = createRedactor();
    type Nested = { next?: Nested; leak?: string };
    const root: Nested = {};
    let current = root;
    for (let index = 0; index < 100; index += 1) {
      const next: Nested = {};
      current.next = next;
      current = next;
    }
    current.leak = OPENAI;
    const output = redactDeep(root, redactor);
    assert.ok(output.next !== undefined);
  });
});
