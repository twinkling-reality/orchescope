# Blocked blind evaluation at candidate a38ed43f

This is the durable public record of the independent blind evaluation that blocked the frozen 0.9.0 release
candidate. It records the evaluator's bounded facts without turning either selected repository into evidence that a
corrected candidate generalizes.

## Frozen candidate and selected pair

- Candidate revision: `a38ed43f14d58a4a5264de0644362366c3dd8648`
- Package: `orchescope@0.9.0`
- Installed tarball SHA-256: `e547d8cc19084a93d22a3d6605d28ac3197690558972386877963b2cf67fade7`
- Positive: `https://github.com/Chaitanya-Keyal/langchain-langgraph-agents` at
  `25813f9ec571316cbd02be3749cccc71da9368ba`
- Positive licence: `LICENSE`, MIT, SHA-256
  `ab91b49cf77b5ba58260a6d871759824c81e5d0e25336b2fa940acdaaabf78dc`
- Negative: `https://github.com/microsoft/project-telescope` at
  `e99388e80a4147f1ae84ac113d4af4eeccb2a40c`
- Negative licence: `LICENSE`, SHA-256
  `c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383`

The evaluator selected the pair after the candidate was frozen. Before measurement, the evaluator recorded exclusion
clearance granted by the release owner after a stated zero-match search of the public tree, corpus URLs, full Git
history, and implementation discussion. The implementer did not nominate either target.

## Measurement and decision

The installed frozen artifact audited the selected positive but did not detect an agent system
(`agentSystemDetected: false`). It reported five components and no relations. One component was the LangGraph group.
The other four were Python documentation strings incorrectly reported as prompts:

- `prompt:context_aware_prompt`
- `prompt:prompt-line-1~3df38b`
- `prompt:prompt-line-1~7621fb`
- `prompt:wrap_model_call`

The scan missed the source-declared `create_agent` agent and the `ChatOpenAI` model and provider. The negative returned
zero components and zero relations, but coverage explicitly marked all 22 Rust source files as unsupported. It made no
absence-based positive claim, and the zero result does not establish that the repository contains no agent
implementation. A repeated positive scan produced the same component and relation population.

The release decision was **BLOCK** because the positive contained four wrong component identities. That independently
satisfies the blind protocol's blocker. The missed agent-system classification and missed source-declared
`create_agent`, model, and provider reinforce the failure but were not required for the blocking decision.

## Integrity checks

- The installed checksum and reported `0.9.0` version matched the frozen artifact.
- `doctor` reported zero warnings against both target checkouts.
- The audit JSON and exported report documents parsed successfully.
- Forced-colour output contained ANSI escapes, while `NO_COLOR` output contained none.
- Both target worktrees retained their pinned revisions and clean status through measurement.
- The same-input positive semantic projection was identical on repeat.
- The completed-results hash manifest verified without a mismatch.

## Runtime boundary

No runtime audit was executed. The positive documents `OPENAI_API_KEY` as required and its settings require that value
at import. The evaluator environment had no `OPENAI_API_KEY`. Supplying a guessed credential or substituting a fake
model run would not be an independently justified execution path, so the runtime population remained unmeasured.

## Regression disposition

Generalized producer fixes now provide a regression result for the positive at the same revision: four components,
one `served_by_provider` relation, no prompt components, incomplete topology with bounded refusals, one info
`observability-coverage` risk, and zero strengths. The four component identities are:

- `agent:assistant`
- `agent_group:graph.py-graph`
- `model:openai/gpt-5-mini`
- `provider:openai`

That regression result does not change the frozen decision and cannot clear the blocked candidate. Both selected
repositories and their source lineages are permanently ineligible as blind holdouts at any revision. A refrozen
candidate must be measured against a different unseen positive and a different unseen negative selected under the
same independent boundary.
