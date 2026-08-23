import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readCorpus } from '../../scripts/corpus/definition.mjs';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const protocol = readFileSync(
  join(repositoryRoot, 'docs/guides/pre-release-blind-evaluation.md'),
  'utf8',
);
const releaseGuide = readFileSync(join(repositoryRoot, 'docs/guides/release.md'), 'utf8');
const blockedRecordPath = 'docs/research/a38ed43f-blocked-blind-evaluation.md';
const blockedRecord = readFileSync(join(repositoryRoot, blockedRecordPath), 'utf8');
const blocked091RecordPath = 'docs/research/604fce75-blocked-blind-evaluation.md';
const blocked091Record = readFileSync(join(repositoryRoot, blocked091RecordPath), 'utf8');
const blockedRetryRecordPath = 'docs/research/48828a1d-blocked-blind-evaluation.md';
const blockedRetryRecord = readFileSync(join(repositoryRoot, blockedRetryRecordPath), 'utf8');
const passedRecordPath = 'docs/research/95c7756c-passed-blind-evaluation.md';
const passedRecord = readFileSync(join(repositoryRoot, passedRecordPath), 'utf8');
const manifest = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8')) as {
  readonly scripts: Readonly<Record<string, string>>;
};

const witnesses = [
  {
    property: 'Workflow registration does not establish agent identity or an agent handoff.',
    file: 'packages/discovery/test/adapters.test.ts',
    title: 'discovers the graph as a workflow and every registered node as a workflow step',
  },
  {
    property: 'Polling and explicit non-success loops do not establish an ambiguous-failure retry.',
    file: 'packages/discovery/test/retry-reading.test.ts',
    title: 'does not attach retry policy to offset commits, OAuth polling, or bounded pairing',
  },
  {
    property:
      'Unknown or aggregate operation identity cannot support a definite duplicate-effect claim.',
    file: 'packages/findings/test/static-rules.test.ts',
    title: 'stays quiet when the effect class itself is unknown',
  },
  {
    property:
      'Unknown or aggregate operation identity cannot support a definite duplicate-effect claim.',
    file: 'packages/findings/test/static-rules.test.ts',
    title: 'does not transfer an aggregate provider effect through a generic helper',
  },
  {
    property: 'A retry experiment names only a matching repository scenario.',
    file: 'packages/findings/test/static-rules.test.ts',
    title: 'names a repository scenario only when it faults this operation and checks duplicates',
  },
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
    property: 'Documentation prose does not become an executable prompt.',
    file: 'packages/discovery/test/documentation-strings.test.ts',
    title: 'ignores prompt-like wording in formal Python documentation strings',
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

  it('preserves the exact blocked candidate, targets, decision and runtime boundary', () => {
    for (const fact of [
      'a38ed43f14d58a4a5264de0644362366c3dd8648',
      'e547d8cc19084a93d22a3d6605d28ac3197690558972386877963b2cf67fade7',
      'https://github.com/Chaitanya-Keyal/langchain-langgraph-agents',
      '25813f9ec571316cbd02be3749cccc71da9368ba',
      'ab91b49cf77b5ba58260a6d871759824c81e5d0e25336b2fa940acdaaabf78dc',
      'https://github.com/microsoft/project-telescope',
      'e99388e80a4147f1ae84ac113d4af4eeccb2a40c',
      'c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383',
    ]) {
      assert.ok(blockedRecord.includes(fact), `blocked record omitted ${fact}`);
    }
    for (const falsePrompt of [
      'prompt:context_aware_prompt',
      'prompt:prompt-line-1~3df38b',
      'prompt:prompt-line-1~7621fb',
      'prompt:wrap_model_call',
    ]) {
      assert.ok(blockedRecord.includes(falsePrompt), `blocked record omitted ${falsePrompt}`);
    }
    assert.match(blockedRecord, /decision was \*\*BLOCK\*\*/);
    assert.match(blockedRecord, /wrong component identities[\s\S]*independently\s+satisfies/);
    assert.match(blockedRecord, /reinforce the failure but were not required/);
    assert.match(blockedRecord, /all 22 Rust source files as unsupported/);
    assert.match(blockedRecord, /made no\s+absence-based positive claim/);
    assert.match(
      blockedRecord,
      /does not establish that the repository contains no agent\s+implementation/,
    );
    for (const integrityFact of [
      'installed checksum and reported `0.9.0` version matched',
      '`doctor` reported zero warnings against both target checkouts',
      'audit JSON and exported report documents parsed successfully',
      'Forced-colour output contained ANSI escapes',
      '`NO_COLOR` output contained none',
      'target worktrees retained their pinned revisions and clean status',
      'same-input positive semantic projection was identical on repeat',
      'completed-results hash manifest verified without a mismatch',
    ]) {
      assert.ok(blockedRecord.includes(integrityFact), `blocked record omitted ${integrityFact}`);
    }
    assert.match(blockedRecord, /did not detect an agent system/);
    assert.match(blockedRecord, /`agentSystemDetected: false`/);
    assert.match(blockedRecord, /exclusion\s+clearance granted by the release owner/);
    assert.match(blockedRecord, /No runtime audit was executed/);
    assert.match(blockedRecord, /environment had no `OPENAI_API_KEY`/);
    assert.match(
      blockedRecord,
      /Supplying a guessed credential or substituting a fake\s+model run/,
    );
  });

  it('makes both used lineages permanently ineligible and requires a different unseen pair', () => {
    assert.match(
      blockedRecord,
      /source lineages are permanently ineligible as blind holdouts at any revision/,
    );
    assert.match(blockedRecord, /different unseen positive and a different unseen negative/);
    assert.match(
      blockedRecord,
      /does not change the frozen decision and cannot clear the blocked candidate/,
    );
    assert.match(
      protocol,
      /source\s+lineages are permanently ineligible as blind holdouts\s+at any revision/,
    );
    assert.match(protocol, /requires\s+a different unseen positive and negative pair/);
    assert.ok(protocol.includes('../research/a38ed43f-blocked-blind-evaluation.md'));
    assert.ok(releaseGuide.includes('../research/a38ed43f-blocked-blind-evaluation.md'));
  });

  it('preserves the exact blocked 0.9.1 candidate and its workflow-identity decision', () => {
    for (const fact of [
      '604fce7516e47cd8971bedbb6da27b138e485fe0',
      '6210cafc465c56aa2b8ed6d6328499799bd4e6c553327708d1b1141fd522a274',
      'https://github.com/gaurav-oberoi/support-agent-hitl',
      '66df5851249aa23ece37609ee1c856580fa2dcbd',
      'c11d6cf0f52527fbb6dc4af3b60cd2d1ae1a8eeeecc4a8bcc76fe67fd7899b43',
      'https://github.com/mylesndavid/argus',
      '34fc9d0195392e9ac0011d23045f30c2291d33c0',
      'f012de7997bd037c087c29263f3ad7ea7135eb60bd6ddf9b88d13f2fd39b1830',
    ]) {
      assert.ok(blocked091Record.includes(fact), `0.9.1 blocked record omitted ${fact}`);
    }
    assert.match(blocked091Record, /decision was \*\*BLOCK\*\*/);
    assert.match(blocked091Record, /workflow nodes as four `agent` components/);
    assert.match(blocked091Record, /`hands_off_to` relations/);
    assert.match(blocked091Record, /No runtime audit was executed/);
    assert.match(blocked091Record, /different unseen positive and negative pair/);
    assert.doesNotMatch(
      blocked091Record,
      /\/Users\/|\/tmp\/|\brun_[0-9a-f]{8}\b|\bev_[0-9a-f]{8}\b|traceId|spanId/,
    );
    assert.ok(protocol.includes('../research/604fce75-blocked-blind-evaluation.md'));
    assert.ok(releaseGuide.includes('../research/604fce75-blocked-blind-evaluation.md'));

    const entries = readCorpus(repositoryRoot) as readonly { name: string; url?: string }[];
    assert.equal(entries.filter((entry) => entry.name === 'support-agent-hitl').length, 1);
    assert.equal(
      entries.some(
        (entry) =>
          entry.name === 'argus' || entry.url === 'https://github.com/mylesndavid/argus.git',
      ),
      false,
    );
  });

  it('preserves the exact retry-causality block and promotes only its positive', () => {
    for (const fact of [
      '48828a1d2f3d8aa479124987a04eb8d672fc63a3',
      '61603179f78bca84aa21e71d4060aa3b8a500b4a372784be86fe441c62f8ac2b',
      'https://github.com/Roozbeh-Sdtz/jarvis-home-commander',
      '740d23097b6525feb1ef8de740a18e16598db8de',
      'b9b7a0bd8894a4c5124e1509a6f849c44e38ddda1b182e3bab6dbdc201dfed29',
      'https://github.com/shiki-yusuke/agent-cost',
      'd170ea301ed0c46351749214bd299e75ae8a7786',
      '6aa9203532be4d8d905482f69e8bba71f4948cce00a620ccd9eab10950e87a93',
      'dab33c4f106103182512ad235a186b55c335faee4bc0f4979718f08b1be599a8',
    ]) {
      assert.ok(blockedRetryRecord.includes(fact), `retry block record omitted ${fact}`);
    }
    assert.match(blockedRetryRecord, /decision was \*\*BLOCK\*\*/);
    assert.match(blockedRetryRecord, /commits the update offset before handling/);
    assert.match(blockedRetryRecord, /effect semantics were recorded as unknown/);
    assert.match(blockedRetryRecord, /contained no scenario file/);
    assert.match(blockedRetryRecord, /different unseen positive and negative pair/);
    assert.doesNotMatch(
      blockedRetryRecord,
      /\/Users\/|\/tmp\/|\brun_[0-9a-f]{8}\b|\bev_[0-9a-f]{8}\b|traceId|spanId/,
    );
    assert.ok(protocol.includes('../research/48828a1d-blocked-blind-evaluation.md'));
    assert.ok(releaseGuide.includes('../research/48828a1d-blocked-blind-evaluation.md'));

    const entries = readCorpus(repositoryRoot) as readonly { name: string; url?: string }[];
    assert.equal(entries.filter((entry) => entry.name === 'jarvis-home-commander').length, 1);
    assert.equal(
      entries.some(
        (entry) =>
          entry.name === 'agent-cost' ||
          entry.url === 'https://github.com/shiki-yusuke/agent-cost.git',
      ),
      false,
    );
  });

  it('preserves the exact passed candidate, targets, decision and bounded runtime refusal', () => {
    for (const fact of [
      '95c7756c3aebf40b728c5ee5f476aab3633a6b85',
      '59a98bbdb7c7e25565e2aa60ebce6da6bcbea8053a30ea5ff818ea89136a5533',
      'https://github.com/box-community/openai-agents-sdk-v2-demo',
      'daf811baacd06f6829d904f596b1125a5817be04',
      '930aade4d7252572313cc91189846780eb4f06be9085a7de8976ebb48be5aa08',
      'https://github.com/a2aproject/A2A',
      '16ba52690519bf55b9388e34d4db356efa88aa51',
      'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
    ]) {
      assert.ok(passedRecord.includes(fact), `passed record omitted ${fact}`);
    }
    assert.match(passedRecord, /release decision was \*\*PASS\*\*/);
    assert.match(passedRecord, /`adapter:openai-agents` reported `completed`/);
    assert.match(passedRecord, /`adapter_found_nothing` explanation/);
    assert.match(passedRecord, /topology was `incomplete`/);
    assert.match(passedRecord, /zero evidence records, zero findings, and zero strengths/);
    assert.match(passedRecord, /No runtime audit was executed/);
    for (const name of ['OPENAI_API_KEY', 'BOX_DEVELOPER_TOKEN', 'BOX_FOLDER_ID']) {
      assert.ok(passedRecord.includes(`\`${name}\``), `passed record omitted ${name}`);
    }
    assert.match(
      passedRecord,
      /Credentials, side effects, and a substitute execution were not guessed/,
    );
    assert.doesNotMatch(
      passedRecord,
      /\/Users\/|\/tmp\/|orchescope-blind-|\brun_[0-9a-f]{8}|\bev_[0-9a-f]{8}|traceId|spanId/,
    );
  });

  it('promotes only the passed positive and makes both passed lineages permanently ineligible', () => {
    assert.match(
      passedRecord,
      /Both selected repositories and their source lineages are permanently ineligible as blind holdouts at any revision/,
    );
    assert.match(passedRecord, /different unseen positive and\s+negative pair/);
    assert.ok(protocol.includes('../research/95c7756c-passed-blind-evaluation.md'));
    assert.ok(releaseGuide.includes('../research/95c7756c-passed-blind-evaluation.md'));

    const entries = readCorpus(repositoryRoot) as readonly { name: string; url?: string }[];
    assert.equal(entries.filter((entry) => entry.name === 'openai-agents-sdk-v2-demo').length, 1);
    assert.equal(
      entries.some(
        (entry) => entry.name === 'a2a' || entry.url === 'https://github.com/a2aproject/A2A.git',
      ),
      false,
    );
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
