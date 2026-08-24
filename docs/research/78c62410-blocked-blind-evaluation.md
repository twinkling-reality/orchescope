# Blocked blind evaluation of candidate 78c62410

## Decision

The independently selected blind evaluation of `orchescope@0.9.1` at
`78c624105fee8f0b4c127cbdbeade583bc5cbdb4` completed, and the release decision was **BLOCK**. The evaluated package
archive had SHA-256 `dc6853a6cc1ec289faeca0cf51ea4afbd8ccaba649394cc05ea7ef6a613112fd`, size 589,629 bytes,
package version `0.9.1`, and seven archive paths. It was not published, tagged, pushed or attached to a release.

## Rejected selection before measurement

The evaluator first selected `https://github.com/davidreko/spore` at
`a40729131a67ea2df5f88f14365973ada5b20dca`, tree `bbba97b1e3507d228a8b28193388706d9588079a`, as the positive and
`https://github.com/prabhavalabs/agentmeter` at `89688516d896feea605e2e335e3945531115fd9e`, tree
`77c5e36dc215ff0e2be2f6f29f0fe3bb9d7c4388`, as the negative. Their MIT licence files had SHA-256
`90d120b071223d78a1f753261f7681bd6d5d12e0aa8f9b10b76497de24d3103d` and
`c2dd376704ee9c839a40cc8b9b27326ffe5f87436080e1eb52493eb9a8d7942b`, respectively.

Exclusion checks cleared both exact revisions. Independent source-role review did not clear the negative: its packaged
`agentmeter-claude-probe` executable forwards arguments with `os.execv` to the signed-in Claude CLI. That executable
delegation is outside the fixed-purpose passive-telemetry role proposed from metadata. Measurement stopped before an
Orchescope scan, both exposed lineages were retired, and the evaluator selected another pair. This was a target-role
rejection, not a product finding.

## Independent selection, exclusion and role validation

The replacement targets were selected after the candidate freeze and without either target having been used during
implementation:

- Positive: `https://github.com/ordinary9843/gitizens` at
  `d8bef45359fbe5ccaa7e134d4708202489b7bb36`, tree
  `1f8c969b37cb7589d0e953505ada751b7afaf1c1`. Its MIT `LICENSE` has SHA-256
  `10ecb0524d9bc8391cdb26f905578e96089ace6207c1877b08d25b99eb3ab741`.
- Negative: `https://github.com/mattjmcnaughton/agent-logs-extractor` at
  `79123f59da3730721dbdbc22dc50899063590f18`, tree
  `af0302d379383f7d4797979c62018170a1bb4392`. Its MIT `LICENSE` has SHA-256
  `a8560d7833492e0003b13de93491a830c30fbacfe8f40fe6e9a80becc0d34102`.

The positive holds 285 tracked files and 2,890,667 tracked bytes. Its scheduled GitHub Actions workflow grants GitHub
Models access, invokes an OpenAI-compatible client against `https://models.inference.ai.azure.com`, uses the model
decision to validate proposals, and can update issues and repository state. The negative holds 116 tracked files and
941,826 tracked bytes. Its executable Go source parses historical agent logs and invokes only a fixed DuckDB subprocess
with extension autoinstall disabled; it does not construct or drive an agent, select tools or actions for a goal, or
download delegated agent behavior. The evaluator and release owner independently agreed on both source roles before
measurement.

Both replacement targets passed repository-wide and history-wide exclusion searches, exact revision and tree checks,
licence verification, bounded-size review and non-fork, non-template, non-mirror metadata review. The rejected and
measured repositories and all four source lineages are permanently ineligible as blind holdouts at any revision. A
corrected candidate requires a different unseen positive and negative pair.

## Blocking provider identity

The positive's exact source describes its endpoint as the GitHub Models API. The validating workflow grants
`models: read`, its client authenticates with `GITHUB_TOKEN`, and the source passes
`https://models.inference.ai.azure.com` as the compatible client's base URL. The model name `gpt-4o-mini` and the
model call's `max_tokens=120`, `temperature=0` and non-streaming configuration were source-supported.

The frozen package nevertheless emitted `provider:openai`, `model:openai/gpt-4o-mini` and a `served_by_provider`
relation. The OpenAI client class establishes a compatibility protocol; it does not establish that OpenAI owns an
explicit alternate endpoint. This is a material wrong provider identity under the protocol's explicit publication
blocker, not an honest unsupported boundary.

The positive reported four components, three relations, one medium model-call-without-timeout finding, one
informational observability finding, zero strengths and incomplete topology with seven source-located refusals. All 35
supported Python files parsed. Evidence coverage included all 15 eligible evidence records. Apart from provider
ownership and the resulting provider-qualified model identity and relation, the evaluator found the agent, prompt,
model call, timeout finding, topology boundary and evidence citations source-supported.

The negative was correctly reported as not an agent system with zero components, relations, findings, strengths,
metrics and evidence. It reported all 76 Go files as `language_not_analysed`, parsed no supported-language source and
skipped one `AGENTS.md` symlink. It did not turn unsupported Go-source absence or historical agent-log content into a
positive claim.

## Runtime and evidence boundary

No target runtime was executed. The positive's scheduled path requires a GitHub token, GitHub Models access, external
model calls, issue and repository-content writes, commits and pushes. No credential, side effect or substitute model
response was invented. Measurement stopped after the conclusive static blocker, so the negative's bounded local
extractor was not substituted for the positive agent run.

The evaluator invoked only the binary installed from the frozen archive. The installed version was `0.9.1` and the
archive checksum matched the frozen package. Doctor output, static JSON and terminal audits, colour and `NO_COLOR`
documents, JSON, Mermaid and SARIF exports, source-span hashes, referential integrity, target revisions and clean
status, and semantic repeatability were checked for both repositories. The completed-results manifest covered 244
files, verified without a mismatch, and had SHA-256
`12249506dc0f14e4212fe763bb9b42406ddb297a340f86212be195a7ea873075`. No credential value, private path, runtime
identifier or trace identifier is included in this public record.

## Generalized correction and regression disposition

The correction separates client compatibility from endpoint-provider ownership. With no endpoint override, an exact
runtime import retains the SDK's documented default provider. With an explicit literal endpoint, provider identity
comes only from the bounded shared endpoint-host table. A recognized alternate endpoint can name its exact provider;
an unknown custom or dynamic endpoint produces a source-located provider-ownership refusal. No generic client class,
constructor name, model name or target-specific repository string establishes provider identity. An exact
provider-specific SDK export retains its own provider identity rather than inheriting the package vendor's default.

A source-settled model name survives provider uncertainty as an unqualified `model:<name>` component and invocation
relation. It does not receive a provider-qualified identity or `served_by_provider` relation. This preserves exact
source evidence without presenting a compatibility client as service ownership. The metamorphic contract covers an
exact alternate endpoint, an unknown compatible endpoint and the no-override SDK default.

The positive is pinned in the regression corpus at its exact revision. Its acceptance contract fixes the agent,
unqualified model and prompt identities, two source-cited invocation relations, absence of provider components and
provider-serving relations, exact model metadata, two endpoint-provider refusals, one conditional-flow refusal,
finding polarity and incomplete topology. All 74 semantic assertions held when the expectation was recorded. The
negative adds no distinct precision invariant and is not added to the corpus.

This correction and regression do not change the frozen decision. Publication remains prohibited until a newly frozen
candidate passes the complete release gates and a new independently selected unseen positive and negative pair.
