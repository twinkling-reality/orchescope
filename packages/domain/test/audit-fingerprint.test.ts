import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { auditFingerprint, stableJson } from '../src/index.ts';

describe('auditFingerprint', () => {
  it('strips timings and fresh identifiers so identical audits fingerprint equal', () => {
    const first = {
      ok: true,
      data: {
        coverage: { adapters: [{ id: 'adapter:openai-agents', durationMs: 46 }] },
        scanId: 'scan_aaaaaaaaaaaaaaaa',
        findings: [
          {
            id: 'OSC-MIQMZ-5859',
            ruleId: 'model-call-without-timeout',
            severity: 'medium',
            title: '6 models are called with no timeout declared',
            evidence: ['ev_1111111111111111'],
          },
        ],
      },
    };
    const second = {
      ok: true,
      data: {
        coverage: { adapters: [{ id: 'adapter:openai-agents', durationMs: 34 }] },
        scanId: 'scan_bbbbbbbbbbbbbbbb',
        findings: [
          {
            id: 'OSC-AAAAA-0001',
            ruleId: 'model-call-without-timeout',
            severity: 'medium',
            title: '6 models are called with no timeout declared',
            evidence: ['ev_2222222222222222'],
          },
        ],
      },
    };
    assert.equal(stableJson(auditFingerprint(first)), stableJson(auditFingerprint(second)));
  });

  it('keeps a finding content change', () => {
    const six = auditFingerprint({
      findings: [{ ruleId: 'model-call-without-timeout', title: '6 models are called' }],
    });
    const four = auditFingerprint({
      findings: [{ ruleId: 'model-call-without-timeout', title: '4 models are called' }],
    });
    assert.notEqual(stableJson(six), stableJson(four));
  });
});
