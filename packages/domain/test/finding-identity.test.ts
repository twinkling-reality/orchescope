import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Finding, Goal } from '@orchescope/schema';
import {
  assertNoFindingIdentityCollisions,
  findingIdentity,
  findingsShareIdentity,
} from '../src/finding-identity.ts';

const semantic = (overrides: Partial<Parameters<typeof findingIdentity>[0]> = {}) =>
  findingIdentity({
    ruleId: 'model-call-without-timeout',
    polarity: 'risk',
    situation: 'model-call-without-timeout',
    remediation: 'client',
    subject: {
      kind: 'entities',
      components: ['model:primary', 'agent:planner'],
      edges: ['invokes_model:planner-primary'],
    },
    ...overrides,
  });

describe('semantic finding identity', () => {
  it('projects SHA-256 into the accepted version-1 grammar', () => {
    const identity = semantic();
    assert.match(identity.id, /^OSC-[A-Z]{5}-\d{4}$/);
    assert.match(identity.semanticKeyDigest, /^[0-9a-f]{64}$/);
    assert.match(identity.semanticSubjectDigest, /^[0-9a-f]{64}$/);
  });

  it('canonicalises complete component and edge subjects', () => {
    const reordered = semantic({
      subject: {
        kind: 'entities',
        components: ['agent:planner', 'model:primary', 'agent:planner'],
        edges: ['invokes_model:planner-primary'],
      },
    });
    assert.equal(reordered.id, semantic().id);
    assert.equal(reordered.semanticKeyDigest, semantic().semanticKeyDigest);
  });

  it('separates polarity, situation, remediation and explicit discriminators', () => {
    const base = semantic().id;
    assert.notEqual(semantic({ polarity: 'strength' }).id, base);
    assert.notEqual(semantic({ situation: 'all-model-calls-declare-timeout' }).id, base);
    assert.notEqual(semantic({ remediation: 'request-abort-signal' }).id, base);
    assert.notEqual(semantic({ discriminator: 'scenario-a' }).id, base);
  });

  it('refuses two semantic keys projected to one displayed token', () => {
    const colliding = [
      { id: 'OSC-AAAAA-0001', canonicalKey: '{"ruleId":"first"}' },
      { id: 'OSC-AAAAA-0001', canonicalKey: '{"ruleId":"second"}' },
    ] as const;
    for (const assignments of [colliding, colliding.toReversed()]) {
      assert.throws(
        () => assertNoFindingIdentityCollisions(assignments),
        /collision at OSC-AAAAA-0001/,
      );
    }
  });

  it('uses rule, polarity and canonical subject for version-1 compatibility', () => {
    const legacy = (ruleId: string, polarity: 'risk' | 'strength', component: string) => ({
      ruleId,
      polarity,
      components: [component],
      edges: [],
      metadata: {},
    });
    assert.equal(
      findingsShareIdentity(
        legacy('model-call-without-timeout', 'risk', 'model:primary'),
        legacy('model-call-without-timeout', 'risk', 'model:primary'),
      ),
      true,
    );
    assert.equal(
      findingsShareIdentity(
        legacy('model-call-without-timeout', 'risk', 'model:primary'),
        legacy('model-call-without-timeout', 'risk', 'model:secondary'),
      ),
      false,
    );
  });

  it('leaves a stored sequential version-1 handle inside the accepted grammar', () => {
    const pattern = Finding.properties.id.pattern;
    assert.ok(pattern !== undefined);
    assert.match('OSC-REL-0003', new RegExp(pattern));
    const goalPattern = Goal.properties.findingId.pattern;
    assert.ok(goalPattern !== undefined);
    assert.match('OSC-REL-0003', new RegExp(goalPattern));
  });
});
