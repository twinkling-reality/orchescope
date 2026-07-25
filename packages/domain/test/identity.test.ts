import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assignComponentIds,
  buildIdentity,
  componentId,
  configNamespace,
  edgeId,
  identitiesEqual,
  identityFingerprint,
  identityKey,
  isRenameOf,
  moduleNamespace,
  normalizeLocalName,
  runtimeIdentity,
} from '../src/index.ts';

describe('module namespace', () => {
  it('strips the extension and normalises separators', () => {
    assert.equal(moduleNamespace('src/agents/orchestrator.ts'), 'src/agents/orchestrator');
    assert.equal(moduleNamespace('./src/agents/orchestrator.tsx'), 'src/agents/orchestrator');
    assert.equal(moduleNamespace('src\\agents\\worker.py'), 'src/agents/worker');
    assert.equal(moduleNamespace('src/tools/refund.mjs'), 'src/tools/refund');
  });

  it('keeps a dotted directory name that is not an extension', () => {
    assert.equal(moduleNamespace('packages/app.core/src/index.ts'), 'packages/app.core/src/index');
  });

  it('rejects a path that reduces to nothing', () => {
    assert.throws(() => moduleNamespace('.ts'), /namespace cannot be empty/);
  });
});

describe('local name normalisation', () => {
  it('lowercases and replaces unsupported characters', () => {
    assert.equal(normalizeLocalName('Lookup Account'), 'lookup-account');
    assert.equal(normalizeLocalName('"refund"'), 'refund');
    assert.equal(normalizeLocalName('openai/gpt-4o-mini'), 'openai/gpt-4o-mini');
    assert.equal(normalizeLocalName('lookup_account'), 'lookup_account');
    assert.equal(normalizeLocalName('@scope/pkg'), '@scope/pkg');
  });

  it('never produces an empty name', () => {
    assert.equal(normalizeLocalName('   '), 'unnamed');
    assert.equal(normalizeLocalName('***'), 'unnamed');
  });

  it('produces identifiers that satisfy the schema pattern', () => {
    const pattern = /^[a-z_]+:[a-z0-9@][a-z0-9_.@/-]*(?:~[0-9a-f]{6})?$/;
    const names = [
      'Lookup Account',
      '  spaced  ',
      'UPPER_CASE',
      'openai/gpt-4o-mini',
      '@scope/pkg',
      '***weird***',
      'trailing---',
      'a'.repeat(200),
    ];
    for (const name of names) {
      const identity = buildIdentity('tool', 'src/tools/x', name);
      assert.match(componentId(identity), pattern, `plain id for ${name}`);
      assert.match(componentId(identity, true), pattern, `disambiguated id for ${name}`);
    }
  });
});

describe('identity stability', () => {
  it('is unchanged when the line number moves', () => {
    const first = buildIdentity(
      'agent',
      moduleNamespace('src/agents/orchestrator.ts'),
      'orchestrator',
    );
    const second = buildIdentity(
      'agent',
      moduleNamespace('src/agents/orchestrator.ts'),
      'orchestrator',
    );
    assert.equal(identityKey(first), identityKey(second));
    assert.equal(identityFingerprint(first), identityFingerprint(second));
    assert.equal(componentId(first), 'agent:orchestrator');
  });

  it('detects a rename when only the namespace changes', () => {
    const before = buildIdentity('tool', 'src/tools/refund', 'refund');
    const after = buildIdentity('tool', 'src/domain/refund', 'refund');
    assert.ok(isRenameOf(after, before));
    assert.ok(!identitiesEqual(after, before));
  });

  it('does not treat a different kind as a rename', () => {
    const before = buildIdentity('tool', 'src/tools/refund', 'refund');
    const after = buildIdentity('agent', 'src/agents/refund', 'refund');
    assert.ok(!isRenameOf(after, before));
  });

  it('gives runtime only components the runtime namespace', () => {
    const identity = runtimeIdentity('tool', 'lookup_account');
    assert.equal(identity.namespace, 'runtime');
    assert.equal(componentId(identity), 'tool:lookup_account');
  });

  it('uses the configuration file as the namespace for configured components', () => {
    assert.equal(configNamespace('./.mcp.json'), '.mcp.json');
  });
});

describe('identifier assignment', () => {
  it('leaves a unique name unsuffixed', () => {
    const identities = [
      buildIdentity('agent', 'src/a', 'alpha'),
      buildIdentity('agent', 'src/b', 'beta'),
    ];
    const assigned = assignComponentIds(identities);
    assert.equal(assigned.get(identityKey(identities[0]!)), 'agent:alpha');
    assert.equal(assigned.get(identityKey(identities[1]!)), 'agent:beta');
  });

  it('suffixes every member of a colliding group, independent of order', () => {
    const left = buildIdentity('tool', 'src/tools/one', 'refund');
    const right = buildIdentity('tool', 'src/tools/two', 'refund');
    const forward = assignComponentIds([left, right]);
    const backward = assignComponentIds([right, left]);
    for (const identity of [left, right]) {
      const id = forward.get(identityKey(identity));
      assert.match(String(id), /^tool:refund~[0-9a-f]{6}$/);
      assert.equal(id, backward.get(identityKey(identity)), 'assignment must not depend on order');
    }
    assert.notEqual(forward.get(identityKey(left)), forward.get(identityKey(right)));
  });

  it('treats a repeated identity as one component', () => {
    const identity = buildIdentity('tool', 'src/tools/one', 'refund');
    const assigned = assignComponentIds([identity, { ...identity }]);
    assert.equal(assigned.size, 1);
    assert.equal(assigned.get(identityKey(identity)), 'tool:refund');
  });
});

describe('edge identifiers', () => {
  it('are deterministic and direction sensitive', () => {
    const forward = edgeId('calls_tool', 'agent:a', 'tool:b');
    assert.equal(forward, edgeId('calls_tool', 'agent:a', 'tool:b'));
    assert.notEqual(forward, edgeId('calls_tool', 'tool:b', 'agent:a'));
    assert.notEqual(forward, edgeId('hands_off_to', 'agent:a', 'tool:b'));
    assert.match(forward, /^calls_tool:[0-9a-f]{16}$/);
  });
});
