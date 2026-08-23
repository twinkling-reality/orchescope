import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const protocol = readFileSync(
  join(repositoryRoot, 'docs/guides/pre-release-blind-evaluation.md'),
  'utf8',
);
const releaseGuide = readFileSync(join(repositoryRoot, 'docs/guides/release.md'), 'utf8');
const manifest = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8')) as {
  readonly scripts: Readonly<Record<string, string>>;
};

const witnesses = [
  {
    property: 'Unrelated findings do not change semantic identifiers.',
    file: 'packages/findings/test/semantic-identity.test.ts',
    title: 'does not change an existing identifier when an unrelated finding is added',
  },
  {
    property: 'Unresolved topology cannot produce absence-based strengths.',
    file: 'packages/findings/test/topology-completeness.test.ts',
    title:
      'suppresses reachability and topology strengths when a conditional destination is unresolved',
  },
  {
    property: 'Import aliases do not change component kind.',
    file: 'packages/discovery/test/framework-provider-identity.test.ts',
    title: 'preserves imported aliases and registrations on verified local framework receivers',
  },
  {
    property: 'Import aliases do not change component kind.',
    file: 'packages/discovery/test/provider-qualified-effects.test.ts',
    title: 'preserves direct, renamed, namespace, default-member and Pool Postgres constructions',
  },
  {
    property: 'A generic constructor name cannot establish provider identity.',
    file: 'packages/discovery/test/runtime-symbol-matching.test.ts',
    title: 'rejects wrong providers, type-only origins, missing origins and explicit shadows',
  },
  {
    property: 'A generic constructor name cannot establish provider identity.',
    file: 'packages/discovery/test/provider-qualified-effects.test.ts',
    title:
      'rejects direct and module aliases from httpx, local and type-only Client definitions, and missing origin',
  },
  {
    property:
      'Runtime configuration can change an exact model without rewriting the static declaration.',
    file: 'tests/e2e/configurable-model-effects.test.ts',
    title: 'keeps static llama3.2 possibilities distinct from an exact observed smollm2 model',
  },
  {
    property: 'Completed-zero applicable adapters remain visible.',
    file: 'packages/discovery/test/configurable-producers.test.ts',
    title:
      'persists exact completed-zero applicability and uses it for the existing gap accounting',
  },
  {
    property: 'Input order does not change semantic identity or selected evidence.',
    file: 'packages/findings/test/semantic-identity.test.ts',
    title: 'ignores component, edge and evidence order as well as prose, severity and time',
  },
  {
    property: 'Input order does not change semantic identity or selected evidence.',
    file: 'packages/report/test/evidence-selection.test.ts',
    title: 'is invariant to evidence and citation permutations',
  },
  {
    property: 'Every strength names the evidence population supporting its scope.',
    file: 'packages/findings/test/static-rules.test.ts',
    title: 'binds a complete caller-population absence to a universal approval strength',
  },
  {
    property: 'Every strength names the evidence population supporting its scope.',
    file: 'packages/findings/test/runtime-rules.test.ts',
    title: 'binds the aggregate component population to the subject of a coverage claim',
  },
  {
    property: 'Every strength names the evidence population supporting its scope.',
    file: 'packages/findings/test/experiment-evidence.test.ts',
    title: 'does not invent absent cost or retry ratios for a complete strength',
  },
] as const;

describe('the frozen pre-release blind evaluation protocol', () => {
  it('separates known regression inputs from independently selected holdouts and controls', () => {
    for (const population of ['Regression corpus', 'Frozen holdout', 'Negative control']) {
      assert.match(protocol, new RegExp(`\\*\\*${population}:\\*\\*`));
    }
    assert.match(protocol, /selected only after the release-candidate commit is frozen/);
    assert.match(
      protocol,
      /absent from the corpus, fixtures,\s+research notes, implementation work, and development discussion/,
    );
    assert.match(protocol, /The implementer\s+cannot nominate either target/);
    assert.match(protocol, /From that committed revision, run every documented release gate/);
  });

  it('requires the installed frozen artifact and preserves raw results outside both targets', () => {
    assert.match(protocol, /installed tarball and its checksum/);
    assert.match(protocol, /Source commands[\s\S]*are not release evidence/);
    assert.match(protocol, /outside both target checkouts/);
    assert.match(protocol, /Do not rewrite a raw result/);
  });

  it('distinguishes release blockers from honest bounded refusals', () => {
    for (const blocker of [
      'wrong identity',
      'absence-based strength',
      'semantic finding identifier changes',
      'cites evidence that does not support',
      'applicable adapter completes with zero output',
      'broader population than its stated sample',
    ]) {
      assert.match(protocol, new RegExp(blocker));
    }
    assert.match(
      protocol,
      /Do not block publication merely because Orchescope refuses an unsupported construct/,
    );
  });

  it('invalidates a tuned result and requires another holdout after a product fix', () => {
    assert.match(protocol, /the result is no longer\s+blind/);
    assert.match(protocol, /freeze a new candidate/);
    assert.match(protocol, /select a different positive and negative pair/);
    assert.match(protocol, /promote the used positive to the regression corpus/);
    assert.match(protocol, /whether it passed or exposed a/);
    assert.match(protocol, /cannot clear the blind gate/);
    assert.match(protocol, /Each release selects a different unseen holdout/);
  });

  it('keeps every documented metamorphic witness executable through the named gate', () => {
    const command = manifest.scripts['test:metamorphic'];
    assert.ok(command !== undefined, 'package.json has no test:metamorphic command');
    for (const witness of witnesses) {
      const path = join(repositoryRoot, witness.file);
      assert.ok(existsSync(path), `${witness.file} does not exist`);
      assert.ok(command.includes(witness.file), `${witness.file} is outside test:metamorphic`);
      assert.ok(
        protocol.includes(witness.property),
        `${witness.property} is absent from the protocol`,
      );
      assert.ok(
        protocol.includes(`\`${witness.file}\``),
        `${witness.file} is absent from the protocol`,
      );
      assert.ok(
        readFileSync(path, 'utf8').includes(`it('${witness.title}'`),
        `${witness.file} no longer contains ${witness.title}`,
      );
    }
  });

  it('makes the blind protocol and metamorphic command publication gates', () => {
    assert.match(releaseGuide, /pre-release-blind-evaluation\.md/);
    assert.match(releaseGuide, /pnpm test:metamorphic/);
    assert.match(releaseGuide, /must pass before publication/);
  });
});
