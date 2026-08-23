import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { missingAttributeAccounts } from '../../scripts/corpus/missing-attribute-accounting.mjs';

const refusal = (evidence: readonly string[]) => ({
  attribute: 'code.file.path',
  evidence,
  evidenceOmitted: 2,
  observedComponents: 4,
  purpose: 'code_location',
  reason: 'missing',
});

const evidence = (...ids: readonly string[]) => ids.map((id) => ({ id }));

describe('corpus missing-attribute evidence accounting', () => {
  it('projects fresh run evidence identities to the same bounded population', () => {
    const first = missingAttributeAccounts(
      [refusal(['ev_first_run_a', 'ev_first_run_b'])],
      evidence('ev_first_run_a', 'ev_first_run_b'),
    );
    const second = missingAttributeAccounts(
      [refusal(['ev_second_run_a', 'ev_second_run_b'])],
      evidence('ev_second_run_a', 'ev_second_run_b'),
    );

    assert.deepEqual(first, second);
    assert.deepEqual(first, [
      {
        attribute: 'code.file.path',
        evidenceOmitted: 2,
        evidenceSampled: 2,
        observedComponents: 4,
        purpose: 'code_location',
        reason: 'missing',
      },
    ]);
  });

  it('distinguishes missing evidence and refuses a dangling citation', () => {
    assert.deepEqual(missingAttributeAccounts([{ ...refusal([]), evidenceOmitted: 0 }], []), [
      {
        attribute: 'code.file.path',
        evidenceOmitted: 0,
        evidenceSampled: 0,
        observedComponents: 4,
        purpose: 'code_location',
        reason: 'missing',
      },
    ]);
    assert.throws(
      () => missingAttributeAccounts([refusal(['ev_missing'])], []),
      /cites 1 evidence record\(s\) absent from the report/,
    );
  });
});
