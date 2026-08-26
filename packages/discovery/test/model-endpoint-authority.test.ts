import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { modelEndpointForHost } from '@orchescope/traces/model-endpoints';
import { hostOf, hostToAskAbout } from '../src/request-address.ts';

/**
 * The two halves of the join have to read one address the same way.
 *
 * `hostOf` returns the whole authority, because that is the name a reader recognises and where
 * `external_service:localhost-11434` comes from. The instrumentation shim asks the provider table with
 * `url.hostname`, which carries neither credentials nor a port. Nothing reconciled the two, so a
 * repository whose source writes an explicit port was an unrecognised host to the scan and a named
 * provider to the run, and the delta between them was manufactured here rather than found in the
 * repository.
 *
 * Every case below is a FALSIFIER against the revision before this: each returned undefined.
 */
describe('the host a provider table is asked about', () => {
  const askedAbout = (url: string): string | undefined => {
    const host = hostOf(url);
    return host === undefined ? undefined : hostToAskAbout(host);
  };

  it('drops an explicit port, which the running shim never sees', () => {
    const url = 'https://api.openai.com:443/v1/chat/completions';
    assert.equal(hostOf(url), 'api.openai.com:443');
    assert.equal(askedAbout(url), 'api.openai.com');
    /* The authority as written is not a host the table knows, and the hostname is. */
    assert.equal(modelEndpointForHost('api.openai.com:443'), undefined);
    assert.deepEqual(modelEndpointForHost(askedAbout(url) ?? ''), {
      system: 'openai',
      provider: 'openai',
    });
  });

  it('drops credentials, which belong in neither a component name nor a permission scope', () => {
    const url = 'https://key:secret@api.anthropic.com/v1/messages';
    assert.equal(askedAbout(url), 'api.anthropic.com');
    assert.deepEqual(modelEndpointForHost(askedAbout(url) ?? ''), {
      system: 'anthropic',
      provider: 'anthropic',
    });
  });

  it('keeps an IPv6 literal whole while dropping the port beside it', () => {
    assert.equal(hostToAskAbout('[::1]:11434'), '[::1]');
    assert.equal(hostToAskAbout('[2001:db8::1]'), '[2001:db8::1]');
  });

  it('still reads a wildcard label, and still returns the whole authority from hostOf', () => {
    assert.equal(hostToAskAbout('*.openai.azure.com'), 'label.openai.azure.com');
    assert.equal(hostOf('http://127.0.0.1:11434/api/chat'), '127.0.0.1:11434');
  });
});
