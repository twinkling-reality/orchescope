import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, describe, it } from 'node:test';
import { isOrchescopeError } from '@orchescope/domain';
import type { FaultPlan, FaultSpec } from '@orchescope/schema';
import { proxyCapableFaults, startFaultProxy } from '../src/fault-proxy.ts';

/**
 * The fault proxy's refusals.
 *
 * No runner starts this proxy in this build, which is why it had no test: nothing exercised it end to end and
 * the gap was invisible. That is backwards for this file in particular. Its safety properties are claims the
 * threat model makes in prose — binds to loopback, never becomes an open proxy, refuses a non loopback
 * upstream unless outbound access was granted — and an unstarted server is exactly the kind that acquires a
 * hole while nobody is watching. These assert the refusals directly, so the properties hold on the day
 * something does wire it up rather than being rechecked by hand then.
 */

const plan = (faults: readonly FaultSpec[]): FaultPlan => ({
  id: 'fp_0123456789abcdef',
  seed: 42,
  faults: [...faults] as FaultPlan['faults'],
});

const fault = (over: Partial<FaultSpec> = {}): FaultSpec =>
  ({
    kind: 'model_rate_limited',
    target: '*',
    delivery: 'proxy',
    probability: 1,
    ...over,
  }) as FaultSpec;

const started: { close: () => Promise<void> }[] = [];
const upstreams: Server[] = [];

after(async () => {
  for (const handle of started) await handle.close();
  for (const server of upstreams) await new Promise<void>((r) => server.close(() => r()));
});

/** A loopback upstream that records what reached it, so "forwarded" is observed rather than assumed. */
const upstream = async (): Promise<{ url: string; hits: string[] }> => {
  const hits: string[] = [];
  const server = createServer((request, response) => {
    hits.push(request.url ?? '');
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
  });
  upstreams.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${address.port}`, hits };
};

describe('the fault proxy', () => {
  it('refuses an upstream that is not an absolute url, rather than guessing one', async () => {
    await assert.rejects(
      () =>
        startFaultProxy({
          plan: plan([fault()]),
          upstreamBaseUrl: '/v1/messages',
          allowOutboundNetwork: false,
          host: '127.0.0.1',
          port: 0,
          maxRequestBytes: 1024,
        }),
      (error: unknown) => {
        assert.ok(isOrchescopeError(error));
        assert.equal(error.code, 'INVALID_ARGUMENT');
        return true;
      },
    );
  });

  it('refuses a non loopback upstream and names the setting that would grant it', async () => {
    await assert.rejects(
      () =>
        startFaultProxy({
          plan: plan([fault()]),
          upstreamBaseUrl: 'https://api.example.com',
          allowOutboundNetwork: false,
          host: '127.0.0.1',
          port: 0,
          maxRequestBytes: 1024,
        }),
      (error: unknown) => {
        assert.ok(isOrchescopeError(error));
        assert.equal(error.code, 'POLICY_DENIED');
        assert.match(error.remediation ?? '', /allowOutboundNetwork/);
        return true;
      },
    );
  });

  it('binds to loopback and says so in the url it hands back', async () => {
    const target = await upstream();
    const handle = await startFaultProxy({
      plan: plan([fault({ delivery: 'cooperative' })]),
      upstreamBaseUrl: target.url,
      allowOutboundNetwork: false,
      host: '127.0.0.1',
      port: 0,
      maxRequestBytes: 4096,
    });
    started.push(handle);
    assert.match(handle.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('counts only the faults it can express as a response, and only those asking for it', () => {
    const capable = proxyCapableFaults(
      plan([
        fault({ kind: 'model_rate_limited', delivery: 'proxy' }),
        // Asks for the proxy, but a tool raising inside the target is not an HTTP response.
        fault({ kind: 'tool_timeout', delivery: 'proxy' }),
        // Expressible as a response, but this one asked the target to apply it.
        fault({ kind: 'model_server_error', delivery: 'cooperative' }),
      ]),
    );
    assert.equal(capable.length, 1);
    assert.equal(capable[0]?.kind, 'model_rate_limited');
  });

  it('injects the declared fault instead of forwarding, and forwards when none matches', async () => {
    const target = await upstream();
    const handle = await startFaultProxy({
      plan: plan([fault({ kind: 'model_rate_limited', target: 'messages' })]),
      upstreamBaseUrl: target.url,
      allowOutboundNetwork: false,
      host: '127.0.0.1',
      port: 0,
      maxRequestBytes: 4096,
    });
    started.push(handle);

    const injected = await fetch(`${handle.url}/v1/messages`, { method: 'POST', body: '{}' });
    assert.equal(injected.status, 429);
    assert.equal(handle.applied().length, 1);
    assert.equal(handle.applied()[0]?.kind, 'model_rate_limited');
    assert.ok(!target.hits.includes('/v1/messages'), 'an injected request still reached upstream');

    const forwarded = await fetch(`${handle.url}/v1/models`, { method: 'POST', body: '{}' });
    assert.equal(forwarded.status, 200);
    assert.ok(target.hits.includes('/v1/models'), 'a request with no matching fault never arrived');
    assert.equal(handle.forwardedCount(), 1);
  });
});
