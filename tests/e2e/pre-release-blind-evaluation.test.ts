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
const blockedLexicalRecordPath = 'docs/research/df99c97c-blocked-blind-evaluation.md';
const blockedLexicalRecord = readFileSync(join(repositoryRoot, blockedLexicalRecordPath), 'utf8');
const blockedObjectMethodRecordPath = 'docs/research/d00a06b5-blocked-blind-evaluation.md';
const blockedObjectMethodRecord = readFileSync(
  join(repositoryRoot, blockedObjectMethodRecordPath),
  'utf8',
);
const blockedRoleRecordPath = 'docs/research/724a1abd-blocked-blind-evaluation.md';
const blockedRoleRecord = readFileSync(join(repositoryRoot, blockedRoleRecordPath), 'utf8');
const blockedLegacyLangChainRecordPath = 'docs/research/84c80b2e-blocked-blind-evaluation.md';
const blockedLegacyLangChainRecord = readFileSync(
  join(repositoryRoot, blockedLegacyLangChainRecordPath),
  'utf8',
);
const blockedBrowserUseRecordPath = 'docs/research/97ac6b4e-blocked-blind-evaluation.md';
const blockedBrowserUseRecord = readFileSync(
  join(repositoryRoot, blockedBrowserUseRecordPath),
  'utf8',
);
const blockedAgentFlowRecordPath = 'docs/research/63f31253-blocked-blind-evaluation.md';
const blockedAgentFlowRecord = readFileSync(
  join(repositoryRoot, blockedAgentFlowRecordPath),
  'utf8',
);
const blockedLangChainPromptRecordPath = 'docs/research/1f5fe556-blocked-blind-evaluation.md';
const blockedLangChainPromptRecord = readFileSync(
  join(repositoryRoot, blockedLangChainPromptRecordPath),
  'utf8',
);
const passedRecordPath = 'docs/research/95c7756c-passed-blind-evaluation.md';
const passedRecord = readFileSync(join(repositoryRoot, passedRecordPath), 'utf8');
const blockedCompatibleProviderRecordPath = 'docs/research/78c62410-blocked-blind-evaluation.md';
const blockedCompatibleProviderRecord = readFileSync(
  join(repositoryRoot, blockedCompatibleProviderRecordPath),
  'utf8',
);
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
    property: 'A compatible client class cannot establish endpoint-provider ownership.',
    file: 'packages/discovery/test/compatible-client-provider-identity.test.ts',
    title: 'names an alternate provider only from its exact recognized endpoint',
  },
  {
    property: 'A compatible client class cannot establish endpoint-provider ownership.',
    file: 'packages/discovery/test/compatible-client-provider-identity.test.ts',
    title:
      'refuses provider ownership for a literal compatible endpoint outside the bounded host table',
  },
  {
    property: 'A compatible client class cannot establish endpoint-provider ownership.',
    file: 'packages/discovery/test/compatible-client-provider-identity.test.ts',
    title: 'keeps the imported client default when no endpoint override is declared',
  },
  {
    property: 'A compatible client class cannot establish endpoint-provider ownership.',
    file: 'packages/discovery/test/compatible-client-provider-identity.test.ts',
    title: 'keeps exact client-specific provider identities distinct from the SDK vendor',
  },
  {
    property: 'Documentation prose does not become an executable prompt.',
    file: 'packages/discovery/test/documentation-strings.test.ts',
    title: 'ignores prompt-like wording in formal Python documentation strings',
  },
  {
    property:
      'A prompt constructor requires exact runtime provenance, and callable or branch uncertainty cannot become a settled interpolation or consumer relation.',
    file: 'packages/discovery/test/langchain-prompt-template.test.ts',
    title: 'uses exact direct, renamed and namespace import provenance',
  },
  {
    property:
      'A prompt constructor requires exact runtime provenance, and callable or branch uncertainty cannot become a settled interpolation or consumer relation.',
    file: 'packages/discovery/test/langchain-prompt-template.test.ts',
    title: 'stays quiet for foreign, local, shadowed, rebound and type-only lookalikes',
  },
  {
    property:
      'A prompt constructor requires exact runtime provenance, and callable or branch uncertainty cannot become a settled interpolation or consumer relation.',
    file: 'packages/discovery/test/langchain-prompt-template.test.ts',
    title: 'refuses mutated, escaped and captured prompt bindings before invocation',
  },
  {
    property:
      'A prompt constructor requires exact runtime provenance, and callable or branch uncertainty cannot become a settled interpolation or consumer relation.',
    file: 'packages/discovery/test/langchain-prompt-template.test.ts',
    title: 'does not borrow dead or pre-construction nested mutations',
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
    property:
      'A legacy LangChain agent requires exact factory and executor provenance, and a local wrapper cannot disappear silently.',
    file: 'packages/discovery/test/langchain-legacy-agent.test.ts',
    title: 'settles returned AgentExecutor factories at each exact assigned call site',
  },
  {
    property:
      'A legacy LangChain agent requires exact factory and executor provenance, and a local wrapper cannot disappear silently.',
    file: 'packages/discovery/test/langchain-legacy-agent.test.ts',
    title: 'refuses unsettled exact imports and computed model or tool populations',
  },
  {
    property:
      'A legacy LangChain agent requires exact factory and executor provenance, and a local wrapper cannot disappear silently.',
    file: 'packages/discovery/test/langchain-legacy-agent.test.ts',
    title: 'does not grant legacy identity to a foreign lookalike',
  },
  {
    property:
      'A browser-use Agent requires exact runtime provenance and a stable source identity; an unsettled run remains an explicit source-located refusal.',
    file: 'packages/discovery/test/browser-use-agent.test.ts',
    title: 'settles a returned Agent factory and preserves its exact run boundary',
  },
  {
    property:
      'A browser-use Agent requires exact runtime provenance and a stable source identity; an unsettled run remains an explicit source-located refusal.',
    file: 'packages/discovery/test/browser-use-agent.test.ts',
    title: 'supports direct, renamed and namespace Agent imports without guessing a provider',
  },
  {
    property:
      'A browser-use Agent requires exact runtime provenance and a stable source identity; an unsettled run remains an explicit source-located refusal.',
    file: 'packages/discovery/test/browser-use-agent.test.ts',
    title: 'refuses foreign, local and shadowed lookalikes and a rebound run receiver',
  },
  {
    property:
      'A browser-use Agent requires exact runtime provenance and a stable source identity; an unsettled run remains an explicit source-located refusal.',
    file: 'packages/discovery/test/browser-use-agent.test.ts',
    title:
      'keeps factories, nested constructions and run receivers inside their exact source bindings',
  },
  {
    property:
      'An AgentFlow graph requires exact runtime provenance and settled source behavior, never a generic Agent, ToolNode or graph-shaped name.',
    file: 'packages/discovery/test/agentflow.test.ts',
    title: 'discovers the exact Agent, ToolNode, cyclic graph and compiled invocation boundary',
  },
  {
    property:
      'An AgentFlow graph requires exact runtime provenance and settled source behavior, never a generic Agent, ToolNode or graph-shaped name.',
    file: 'packages/discovery/test/agentflow.test.ts',
    title: 'recognizes renamed and namespace runtime imports',
  },
  {
    property:
      'An AgentFlow graph requires exact runtime provenance and settled source behavior, never a generic Agent, ToolNode or graph-shaped name.',
    file: 'packages/discovery/test/agentflow.test.ts',
    title: 'stays quiet for foreign, local, shadowed and rebound lookalikes',
  },
  {
    property:
      'An AgentFlow graph requires exact runtime provenance and settled source behavior, never a generic Agent, ToolNode or graph-shaped name.',
    file: 'packages/discovery/test/agentflow.test.ts',
    title: 'refuses endpoint populations changed through invoked local helpers and aliases',
  },
  {
    property:
      'An AgentFlow graph requires exact runtime provenance and settled source behavior, never a generic Agent, ToolNode or graph-shaped name.',
    file: 'packages/discovery/test/agentflow.test.ts',
    title: 'does not borrow a bound map through parameter shadowing or replacement',
  },
  {
    property:
      'An AgentFlow graph requires exact runtime provenance and settled source behavior, never a generic Agent, ToolNode or graph-shaped name.',
    file: 'packages/discovery/test/agentflow.test.ts',
    title: 'does not apply one bounded invocation to an unbounded invocation population',
  },
  {
    property:
      'Invocation ceilings, producer populations and refusal location boundaries cannot change behind stable corpus totals.',
    file: 'tests/e2e/corpus-acceptance.test.ts',
    title: 'rejects changed invocation ceilings, producer populations and unlocated refusals',
  },
  {
    property:
      'A Pydantic AI assignment can destabilize only its exact local, global or nonlocal Agent binding.',
    file: 'packages/discovery/test/adapters.test.ts',
    title: 'keeps a decorated tool when another scope destructures the same variable name',
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
  {
    property:
      'A function-scoped provider import cannot authorize a sibling scope or invent a dynamic compatible provider.',
    file: 'packages/discovery/test/nested-module-binding.test.ts',
    title:
      'discovers function-scoped namespace clients without inventing a dynamic compatible provider',
  },
  {
    property:
      'A function-scoped provider import cannot authorize a sibling scope or invent a dynamic compatible provider.',
    file: 'packages/discovery/test/nested-module-binding.test.ts',
    title: 'does not grant one function-scoped namespace import to another lexical scope',
  },
  {
    property: 'A branch-local provider client cannot authorize an ambiguous post-join call.',
    file: 'packages/discovery/test/nested-module-binding.test.ts',
    title: 'refuses a provider identity after competing branch-local clients join',
  },
  {
    property: 'A branch-local provider client cannot authorize an ambiguous post-join call.',
    file: 'packages/discovery/test/nested-module-binding.test.ts',
    title: 'keeps calls inside their own client branch while refusing its dynamic provider',
  },
  {
    property:
      'An unsettled model-client binding preserves an enclosing agent boundary only when every reachable receiver binding is a recognized model client.',
    file: 'packages/discovery/test/nested-module-binding.test.ts',
    title: 'explains an unsettled call when only one branch has a recognized client',
  },
  {
    property:
      'An unsettled model-client binding preserves an enclosing agent boundary only when every reachable receiver binding is a recognized model client.',
    file: 'packages/discovery/test/nested-module-binding.test.ts',
    title: 'refuses alternate control-flow clients while keeping straight-line settlement',
  },
  {
    property:
      'An unsettled model-client binding preserves an enclosing agent boundary only when every reachable receiver binding is a recognized model client.',
    file: 'packages/discovery/test/nested-module-binding.test.ts',
    title: 'refuses a JavaScript client whose later assignment is not source-settled',
  },
  {
    property:
      'An external effect belongs to the smallest authoritative callable, never a borrowed module or surrounding scope.',
    file: 'packages/discovery/test/adapters.test.ts',
    title: 'attributes every request to the smallest named object callable',
  },
  {
    property:
      'An external effect belongs to the smallest authoritative callable, never a borrowed module or surrounding scope.',
    file: 'packages/discovery/test/adapters.test.ts',
    title: 'refuses to invent module ownership for a request inside an unnamed callback',
  },
  {
    property:
      'An external effect belongs to the smallest authoritative callable, never a borrowed module or surrounding scope.',
    file: 'tests/e2e/object-method-effects.test.ts',
    title: 'keeps the caller, service, finding, citation and Mermaid label on the method',
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

  it('preserves the lexical-import block and rejects its contaminated negative', () => {
    for (const fact of [
      'df99c97c192e12177a7aa78dee012e0dec10bab5',
      '0670c1ace229159a3bcd6a63ccfa53a7832db58b376272612225b2a7177a4709',
      'https://github.com/BBridgeers/tubemind',
      '9ec1cd53c6e3f837563f6f80771b9270287621fb',
      'c8189af9e333334c5adcfc05e245b625a1d39c15330b43b9ff806780066a35ab',
      'https://github.com/Cyrax321/SNAGLINE',
      '7df6fdfedd1929975d45abfb0c8e8574f78cd04b',
      '6f935eee3d2ce15ae2156fb3c8a15bf70cf4b78a96f791412e32b1e6fa4822b1',
      'df4bf8256123793624635ebe3a73d2bcbf892d9d91fe8ae1f4f5b62f9575b82e',
    ]) {
      assert.ok(blockedLexicalRecord.includes(fact), `lexical block record omitted ${fact}`);
    }
    assert.match(blockedLexicalRecord, /decision was \*\*BLOCK\*\*/);
    assert.match(blockedLexicalRecord, /function-scoped\s+`import openai as openai_lib`/);
    assert.match(blockedLexicalRecord, /marked `adapter:model-sdk` not applicable/);
    assert.match(blockedLexicalRecord, /misleading applicability false\s+negative/);
    assert.match(blockedLexicalRecord, /executable agent demonstrations/);
    assert.match(blockedLexicalRecord, /holdout-selection failure, not a product defect/);
    assert.match(blockedLexicalRecord, /different unseen positive and negative pair/);
    assert.doesNotMatch(
      blockedLexicalRecord,
      /\/Users\/|\/tmp\/|\brun_[0-9a-f]{8}\b|\bev_[0-9a-f]{8}\b|traceId|spanId/,
    );
    assert.ok(protocol.includes('../research/df99c97c-blocked-blind-evaluation.md'));
    assert.ok(releaseGuide.includes('../research/df99c97c-blocked-blind-evaluation.md'));

    const entries = readCorpus(repositoryRoot) as readonly { name: string; url?: string }[];
    assert.equal(entries.filter((entry) => entry.name === 'tubemind').length, 1);
    assert.equal(
      entries.some(
        (entry) =>
          entry.name.toLowerCase() === 'snagline' ||
          entry.url === 'https://github.com/Cyrax321/SNAGLINE.git',
      ),
      false,
    );
  });

  it('preserves the object-method ownership block and promotes both distinct boundaries', () => {
    for (const fact of [
      'd00a06b5c8c45ebfcd1ca75cb2bbdb0951c1e8a7',
      '9b2834897befd6a6f5288c973bea25a81f4389cff5de17a090545d421c12cfc6',
      'https://github.com/jmdonbaba/CrossDiscipline-Research-Agent',
      '5aa22a6afbe76dfd0fe67690b64cec1e12a57c86',
      'b19a425d8d00566072df98eef18bd5f132a503b331298bff818c313da23948a5',
      'https://github.com/synrouter/agentgauge',
      'b109ef0f7f726cb16b9c5c77276694dfd19cfa57',
      '7f938135f347074ddbbfdc9f11949055fb6b6ee44f95fefa10c95fa8dadc7a60',
      '3ad9dcd8c38465b0e3b689d8b1e8a0dd81cc64444404dd170205c68eba7eeadc',
    ]) {
      assert.ok(
        blockedObjectMethodRecord.includes(fact),
        `object-method block record omitted ${fact}`,
      );
    }
    assert.match(blockedObjectMethodRecord, /decision was \*\*BLOCK\*\*/);
    assert.match(blockedObjectMethodRecord, /inside the `async run\(\{ args \}\)` object method/);
    assert.match(blockedObjectMethodRecord, /created `entrypoint:module-scope`/);
    assert.match(blockedObjectMethodRecord, /publication-blocking wrong\s+component identity/);
    assert.match(blockedObjectMethodRecord, /No runtime audit was executed/);
    assert.match(blockedObjectMethodRecord, /different unseen positive and negative pair/);
    assert.doesNotMatch(
      blockedObjectMethodRecord,
      /\/Users\/|\/tmp\/|\brun_[0-9a-f]{8}\b|\bev_[0-9a-f]{8}\b|traceId|spanId/,
    );
    assert.ok(protocol.includes('../research/d00a06b5-blocked-blind-evaluation.md'));
    assert.ok(releaseGuide.includes('../research/d00a06b5-blocked-blind-evaluation.md'));

    const entries = readCorpus(repositoryRoot) as readonly { name: string; url?: string }[];
    assert.equal(
      entries.filter((entry) => entry.name === 'crossdiscipline-research-agent').length,
      1,
    );
    assert.equal(entries.filter((entry) => entry.name === 'agentgauge').length, 1);
  });

  it('blocks a mislabeled negative, retires both lineages and promotes only the positive', () => {
    for (const fact of [
      '724a1abda9a1176b28b5633495d67a6b0e2bc194',
      '38981b8d9a6a6b626d74c7ae9ebb170cb550217528011270165a207cc5cfbcc5',
      'https://github.com/AnshMNSoni/email-agent',
      '67a176ef44f2ec9b7edfeec8b7da665beaf0a749',
      '7266b6393e321d6d431a4dcd1a033980df14bce64ed51f0686d6b2a9217a8b5f',
      'https://github.com/wzchav/tokentab',
      '608a27881e865f020a86e0fc45f580224e25e161',
      '4445ce0aacef628e792df8c6056db618044bc95380f2fd45aee9f3e1c0b554ba',
      'f4ca15a4fef4ce5f14ebf3367b4290d299e1ca224a42a1fcfbf000c9a6acc4bc',
    ]) {
      assert.ok(blockedRoleRecord.includes(fact), `role block record omitted ${fact}`);
    }
    assert.match(blockedRoleRecord, /release decision was \*\*BLOCK\*\*/);
    assert.match(blockedRoleRecord, /construct `Agent\(config=cfg\)`/);
    assert.match(blockedRoleRecord, /call `agent\.send\(user_in\)`/);
    assert.match(blockedRoleRecord, /downloads Python from a fixed remote host/);
    assert.match(blockedRoleRecord, /reported\s+`agentSystemDetected: false`/);
    assert.match(blockedRoleRecord, /provisional PASS was therefore overturned/);
    assert.match(blockedRoleRecord, /`GOOGLE_APPLICATION_CREDENTIALS` was present/);
    assert.match(blockedRoleRecord, /Tokentab contributes no clean negative precision invariant/);
    assert.match(blockedRoleRecord, /different unseen positive and negative pair/);
    assert.doesNotMatch(
      blockedRoleRecord,
      /\/Users\/|\/tmp\/|\brun_[0-9a-f]{8}\b|\bev_[0-9a-f]{8}\b|traceId|spanId/,
    );
    assert.ok(protocol.includes('../research/724a1abd-blocked-blind-evaluation.md'));
    assert.ok(releaseGuide.includes('../research/724a1abd-blocked-blind-evaluation.md'));
    assert.match(protocol, /repository metadata does not settle the target's role/);
    assert.match(protocol, /release owner independently verifies that reading/);
    assert.match(protocol, /role mismatch stops measurement/);

    const entries = readCorpus(repositoryRoot) as readonly { name: string; url?: string }[];
    assert.equal(entries.filter((entry) => entry.name === 'email-agent').length, 1);
    assert.equal(
      entries.some(
        (entry) =>
          entry.name === 'tokentab' || entry.url === 'https://github.com/wzchav/tokentab.git',
      ),
      false,
    );
  });

  it('blocks silent legacy LangChain agents and promotes only the positive invariant', () => {
    for (const fact of [
      '84c80b2e2ee1935c6925d12b585f02782358f122',
      '38981b8d9a6a6b626d74c7ae9ebb170cb550217528011270165a207cc5cfbcc5',
      'https://github.com/Womp-Womp/MultiAgentDiscordBot',
      'fded3337ba2daa9393ef7dea3977f76545de7a84',
      '91f18277c312c18292bdb7871c9d213852966e790e0701a0951b25dcada7e3c0',
      'https://github.com/aichain-tw/claude-jsonl-viewer',
      'ce6dd5c5cfba3c26887b5619e4b4cff75bb2074a',
      '72380798af61d6131287b0dd3c8dc5345535df641002fece3a02d7ef109c5f8e',
      '85288c0f7831d72c32b083c4eeb09ac2de1601170d36e40097b752bc8d229693',
    ]) {
      assert.ok(
        blockedLegacyLangChainRecord.includes(fact),
        `legacy LangChain block record omitted ${fact}`,
      );
    }
    assert.match(blockedLegacyLangChainRecord, /release decision was \*\*BLOCK\*\*/);
    assert.match(blockedLegacyLangChainRecord, /zero `agent` components/);
    assert.match(blockedLegacyLangChainRecord, /`create_openai_tools_agent` and `AgentExecutor`/);
    assert.match(blockedLegacyLangChainRecord, /publication-blocking misleading silence/);
    assert.match(blockedLegacyLangChainRecord, /three persistent workers plus one request-scoped/);
    assert.match(blockedLegacyLangChainRecord, /No runtime audit was executed/);
    assert.match(
      blockedLegacyLangChainRecord,
      /negative contributes no additional precision invariant/,
    );
    assert.match(blockedLegacyLangChainRecord, /different unseen positive and negative pair/);
    assert.doesNotMatch(
      blockedLegacyLangChainRecord,
      /\/Users\/|\/tmp\/|\brun_[0-9a-f]{8}\b|\bev_[0-9a-f]{8}\b|traceId|spanId/,
    );
    assert.ok(protocol.includes('../research/84c80b2e-blocked-blind-evaluation.md'));
    assert.ok(releaseGuide.includes('../research/84c80b2e-blocked-blind-evaluation.md'));

    const entries = readCorpus(repositoryRoot) as readonly { name: string; url?: string }[];
    assert.equal(entries.filter((entry) => entry.name === 'multiagent-discord-bot').length, 1);
    assert.equal(
      entries.some(
        (entry) =>
          entry.name === 'claude-jsonl-viewer' ||
          entry.url === 'https://github.com/aichain-tw/claude-jsonl-viewer.git',
      ),
      false,
    );
  });

  it('blocks silent browser-use agents and promotes only the source-settled positive invariant', () => {
    for (const fact of [
      '97ac6b4e48023ad6fa2e465a702abe4422a16a7d',
      '91c71ad094f13bf6f28f7a3798db43289c3e126bcc5d1b975ef4a87459956f39',
      'https://github.com/Arfazrll/Browser-Automation-Agent',
      'd139df4234b8953e82fa4b635e07e68387ffa1a3',
      '7d0a21635bfbdf0b1b29ba95056f018e42d5de912446a430e58f4e94b09db039',
      'https://github.com/frankchiu-dev/claude-codex-usage-dashboard',
      '96fcb981327bc86b15c8b3fb9be3fd8836eb2a7f',
      '33a6ae5ff8d5d779db2776f5293e6922b07064bdd42274aaef9da21c3fe34bf0',
      '54d342dbe0ca4900cbf01e84f397de503eed83682df6bbd147b5f96b65b364c7',
    ]) {
      assert.ok(blockedBrowserUseRecord.includes(fact), `browser-use block record omitted ${fact}`);
    }
    assert.match(blockedBrowserUseRecord, /release decision was \*\*BLOCK\*\*/);
    assert.match(blockedBrowserUseRecord, /zero components, zero relations, zero evidence/);
    assert.match(blockedBrowserUseRecord, /publication-blocking misleading silence/);
    assert.match(blockedBrowserUseRecord, /No target runtime was executed/);
    assert.match(blockedBrowserUseRecord, /negative contributes no additional precision invariant/);
    assert.match(blockedBrowserUseRecord, /different unseen positive and negative pair/);
    assert.doesNotMatch(
      blockedBrowserUseRecord,
      /\/Users\/|\/tmp\/|\brun_[0-9a-f]{8}\b|\bev_[0-9a-f]{8}\b|traceId|spanId/,
    );
    assert.ok(protocol.includes('../research/97ac6b4e-blocked-blind-evaluation.md'));
    assert.ok(releaseGuide.includes('../research/97ac6b4e-blocked-blind-evaluation.md'));

    const entries = readCorpus(repositoryRoot) as readonly { name: string; url?: string }[];
    assert.equal(entries.filter((entry) => entry.name === 'browser-automation-agent').length, 1);
    assert.equal(
      entries.some(
        (entry) =>
          entry.name === 'claude-codex-usage-dashboard' ||
          entry.url === 'https://github.com/frankchiu-dev/claude-codex-usage-dashboard.git',
      ),
      false,
    );
  });

  it('blocks silent AgentFlow graphs and promotes only the provenance-qualified positive', () => {
    for (const fact of [
      '63f31253d5ca58ea29661074561c833b01462fef',
      '5a0e18d6d37c71d4d9ccd5f4d6a6f8f62bc804b2f01d186bcc105dcce778bfd9',
      'https://github.com/Mothilal-M/agentic-browser',
      'f6d83391a2f357bd806617492e469f3be28c0c8e',
      '543f25e9ab865c20cb1507e5348a94d9dd20d174b20fd912f504abee7c1df131',
      'https://github.com/H21465/claude-log-viewer',
      '0f817d76e04ea88c4aa56f7515843ac56dfb5f86',
      'ff9c8801e508ecfb75a5f393fdc56368007d6b65ec4fe3f19ed70bbf1cad8a3d',
      'ee7a36ea35615f9ec30632c8c31c049c350ee0f9c3c243994383556a464cf064',
    ]) {
      assert.ok(blockedAgentFlowRecord.includes(fact), `AgentFlow block record omitted ${fact}`);
    }
    assert.match(blockedAgentFlowRecord, /release decision was \*\*BLOCK\*\*/);
    assert.match(blockedAgentFlowRecord, /seven unrelated effect components/);
    assert.match(
      blockedAgentFlowRecord,
      /no AgentFlow agent,\s+model, tool or workflow component or relation/,
    );
    assert.match(blockedAgentFlowRecord, /publication-blocking misleading silence/);
    assert.match(blockedAgentFlowRecord, /No target runtime was executed/);
    assert.match(blockedAgentFlowRecord, /negative contributes no additional precision invariant/);
    assert.match(blockedAgentFlowRecord, /different unseen positive and negative pair/);
    assert.doesNotMatch(
      blockedAgentFlowRecord,
      /\/Users\/|\/tmp\/|\brun_[0-9a-f]{8}\b|\bev_[0-9a-f]{8}\b|traceId|spanId/,
    );
    assert.ok(protocol.includes('../research/63f31253-blocked-blind-evaluation.md'));
    assert.ok(releaseGuide.includes('../research/63f31253-blocked-blind-evaluation.md'));

    const entries = readCorpus(repositoryRoot) as readonly { name: string; url?: string }[];
    assert.equal(entries.filter((entry) => entry.name === 'agentic-browser').length, 1);
    assert.equal(
      entries.some(
        (entry) =>
          entry.name === 'claude-log-viewer' ||
          entry.url === 'https://github.com/H21465/claude-log-viewer.git',
      ),
      false,
    );
  });

  it('blocks silent LangChain prompts and promotes only the exact positive invariant', () => {
    for (const fact of [
      '1f5fe556db5abd762c43c5d35f0b15e15f7df6df',
      '1b11e56ba50ece693191d4f1b03e5da9cb2e7492be71b037990af0db7d3b45bc',
      'https://github.com/manohar42/AI-Article-Writer',
      'a81ea1e0a4d8b3724fc9acd8f01ec71aee5ccea6',
      '4938b79666d260b2fa82054b029acbcce953d1cd2fbe89ce02bda39a279920bd',
      'https://github.com/riigait/claude-usage',
      'e459579fc1020b75d43f80dbbf0d6b822f9c0a22',
      'face49146cdd2a94cee94680f566ff47c3920d8169d8a2c71e6306a6fa648428',
      'ce0d413edb83da4a4a6896d716e970662de953f0df530d2687cc69146902bdd7',
    ]) {
      assert.ok(
        blockedLangChainPromptRecord.includes(fact),
        `LangChain prompt block record omitted ${fact}`,
      );
    }
    assert.match(blockedLangChainPromptRecord, /release decision was \*\*BLOCK\*\*/);
    assert.match(blockedLangChainPromptRecord, /prompt adapter as not applicable/);
    assert.match(blockedLangChainPromptRecord, /six exact prompt components/);
    assert.match(blockedLangChainPromptRecord, /five source-located prompt-use\s+refusals/);
    assert.match(blockedLangChainPromptRecord, /No target runtime was executed/);
    assert.match(blockedLangChainPromptRecord, /negative adds no distinct precision invariant/);
    assert.match(blockedLangChainPromptRecord, /different unseen positive and negative pair/);
    assert.doesNotMatch(
      blockedLangChainPromptRecord,
      /\/Users\/|\/tmp\/|\brun_[0-9a-f]{8}\b|\bev_[0-9a-f]{8}\b|traceId|spanId/,
    );
    assert.ok(protocol.includes('../research/1f5fe556-blocked-blind-evaluation.md'));
    assert.ok(releaseGuide.includes('../research/1f5fe556-blocked-blind-evaluation.md'));

    const entries = readCorpus(repositoryRoot) as readonly { name: string; url?: string }[];
    assert.equal(entries.filter((entry) => entry.name === 'ai-article-writer').length, 1);
    assert.equal(
      entries.some(
        (entry) =>
          entry.name === 'claude-usage' ||
          entry.url === 'https://github.com/riigait/claude-usage.git',
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

  it('blocks compatible-client provider ownership and promotes only the exact positive', () => {
    for (const fact of [
      '78c624105fee8f0b4c127cbdbeade583bc5cbdb4',
      'dc6853a6cc1ec289faeca0cf51ea4afbd8ccaba649394cc05ea7ef6a613112fd',
      'https://github.com/davidreko/spore',
      'a40729131a67ea2df5f88f14365973ada5b20dca',
      'https://github.com/prabhavalabs/agentmeter',
      '89688516d896feea605e2e335e3945531115fd9e',
      'https://github.com/ordinary9843/gitizens',
      'd8bef45359fbe5ccaa7e134d4708202489b7bb36',
      '10ecb0524d9bc8391cdb26f905578e96089ace6207c1877b08d25b99eb3ab741',
      'https://github.com/mattjmcnaughton/agent-logs-extractor',
      '79123f59da3730721dbdbc22dc50899063590f18',
      'a8560d7833492e0003b13de93491a830c30fbacfe8f40fe6e9a80becc0d34102',
      '12249506dc0f14e4212fe763bb9b42406ddb297a340f86212be195a7ea873075',
    ]) {
      assert.ok(
        blockedCompatibleProviderRecord.includes(fact),
        `compatible-provider block record omitted ${fact}`,
      );
    }
    assert.match(blockedCompatibleProviderRecord, /release decision was \*\*BLOCK\*\*/);
    assert.match(
      blockedCompatibleProviderRecord,
      /Measurement stopped before an\s+Orchescope scan/,
    );
    assert.match(blockedCompatibleProviderRecord, /`provider:openai`/);
    assert.match(blockedCompatibleProviderRecord, /material wrong provider identity/);
    assert.match(blockedCompatibleProviderRecord, /No target runtime was executed/);
    assert.match(blockedCompatibleProviderRecord, /All 74 semantic assertions held/);
    assert.match(blockedCompatibleProviderRecord, /different unseen positive and negative pair/);
    assert.doesNotMatch(
      blockedCompatibleProviderRecord,
      /\/Users\/|\/tmp\/|orchescope-blind-|\brun_[0-9a-f]{8}|\bev_[0-9a-f]{8}|traceId|spanId/,
    );
    assert.ok(protocol.includes('../research/78c62410-blocked-blind-evaluation.md'));
    assert.ok(releaseGuide.includes('../research/78c62410-blocked-blind-evaluation.md'));

    const entries = readCorpus(repositoryRoot) as readonly { name: string; url?: string }[];
    assert.equal(entries.filter((entry) => entry.name === 'gitizens').length, 1);
    assert.equal(
      entries.some(
        (entry) =>
          entry.name === 'agent-logs-extractor' ||
          entry.url === 'https://github.com/mattjmcnaughton/agent-logs-extractor.git',
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
