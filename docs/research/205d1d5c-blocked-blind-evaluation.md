# Blocked blind evaluation of candidate 205d1d5c

This record preserves one completed application of the
[pre-release blind evaluation protocol](../guides/pre-release-blind-evaluation.md). It is a release decision about one
frozen artifact and one independently selected pair, not evidence about another artifact or repository.

## Frozen boundary and independent selection

- Candidate revision: `205d1d5cf4637e1b49e0c986843a2ed2d19b49cd`, tree
  `9d4ce1f3e5218624574e95c81bd3646f1bf2eb66`
- Installed package: `orchescope@0.10.0`
- Evaluated tarball: `release/orchescope-0.10.0.tgz`, 619,345 bytes and seven files
- Evaluated tarball SHA-256: `8fd6ebfde015ecabe2bfdc9128d06abeb102d0b54ecdbbf5db02cfd9d57f74aa`
- Positive: `https://github.com/Spkap/StockSense-AI` at
  `7df3e802509ad2ebf62d91a313c9870432ba9f56`, tree `c351356328d2fd0f7480664ea46296727b4c244f`
- Positive licence: root MIT `LICENSE`, content SHA-256
  `044b02a0db62120645494e57a6f4978d26682b18004feb8abf40b4ae293ee5c6`
- Negative: `https://github.com/Rxflex/agenttrace` at
  `012f137782cb576ce461b8b6523d2c5a16ba698a`, tree `142ae2cf07704913a39c321e212225a2c7b20be3`
- Negative licence: root MIT `LICENSE`, content SHA-256
  `fa1163673e715ae6406ae714fcaa83215b70c68afc3fbd83b47ce6d41faae698`

The evaluator did not implement the candidate and selected both targets only after the candidate and package were
frozen. Current content and paths, historical diffs and per-identifier pickaxes, commit messages, historical paths,
refs and reflogs returned zero bounded matches for both URLs, owners, repository names, revisions, root revisions and
the negative package aliases. Two earlier screened pairs were retired before measurement: one positive role was
ambiguous, one negative contained executable agent behavior, and a later positive lacked a licence at its pin.

Source review established StockSense-AI as an agent application. It binds six tools to a model, consumes model-selected
tool calls, invokes those tools, and cycles from its agent node through its tools node under a ten-iteration state
ceiling. Its API drives that compiled graph for a requested ticker. The checkout held 116 tracked files and 757,691
tracked blob bytes under `git ls-tree -r -l`; its complete source-manifest SHA-256 was
`c781e2cf2a71e1396cf4243bc0ca979f3f434ff722201e6f95167c06b5849b9b`.

Source review established AgentTrace as adjacent observability software. Its SDK wraps caller-owned functions to emit
spans, its exporter batches and posts events, its backend ingests and persists them, and its frontend renders trace
trees. The executable source does not construct or drive an agent, invoke a model, choose tools, or delegate those
actions to downloaded code. The checkout held 93 tracked files and 218,725 tracked blob bytes under
`git ls-tree -r -l`; its complete source-manifest SHA-256 was
`3390e9afe6b95c227d4d4a05af63dd6fc372f7898d8e8eb9eab14c61e031f2ec`.

## Package and measurement integrity

The evaluator installed the frozen tarball into a fresh prefix and invoked only that installed binary. The installed
version was `0.10.0`. JSON and terminal `doctor` commands exited successfully with zero warnings and reported the
candidate commit. The evidence manifest covering the evaluator's raw and derived outputs has SHA-256
`e34e65973e512779e55a608d42347ac73a4dffdcb8d17b4b5e9d16ba773ae1c1`.

Both target audits used `orchescope --cwd <target> --json audit --runs 0`. Repeated scans preserved sorted component,
edge and finding identities and finding semantic subjects. Forced-colour and `NO_COLOR=1` terminal documents agreed
after ANSI removal. The product repository, canonical target checkouts and disposable measurement checkouts retained
clean indexes at their exact revisions after measurement.

## Positive measurement

The positive command reported `agentSystemDetected: true`. It discovered 25 components and 15 edges from 88 parsed
supported files out of 116 tracked paths, with zero skipped files. The graph included one LangGraph workflow, its
`agent` and `tools` steps, two containment edges, and the `agent -> tools -> agent` cycle. The remaining discovered
population came from frontend network effects.

The LangGraph adapter completed with three components and four edges from one file. The effects adapter completed with
22 components and 11 edges from two files. Other adapters were explicitly not applicable. Topology was incomplete with
two unresolved inputs; no strength was emitted from that incomplete population. The report included all 29 of 29
eligible evidence records. Its two risks were the low-severity topology cycle and the info-severity absence of runtime
evidence. The export held zero metrics, benchmarks, chaos reports, comparisons or recorded runs.

The pinned source contains a ten-iteration state ceiling that the report did not attach to the discovered cycle. The
report stated that support boundary and did not turn it into an absence-based strength, so it did not block the
candidate.

## Negative measurement and release blocker

The negative command reported `agentSystemDetected: false`. It discovered two components and one edge from 72 parsed
supported files out of 93 tracked paths, with zero skipped files. Effects was the only applicable adapter and completed
with two components and one edge from one file. Topology was incomplete with one unresolved effects population; zero
strengths were emitted. The report included all three of three eligible evidence records. Its only finding was the
info-severity absence of runtime evidence.

The exported graph nevertheless made an unsupported material claim:

- `external_service:unresolved-host-fetchapi` had side effect `read_only` and network permission `read`;
- its `calls_service` edge also had side effect `read_only` while its HTTP method was `unknown`; and
- both claims cited only `frontend/src/api/client.ts:31-37`.

That source span calls `fetch` after spreading caller-supplied `RequestInit` options. The same pinned file calls the
wrapper at `frontend/src/api/client.ts:92-98` with `method: 'POST'` and a JSON body. The backend route at
`backend/src/agent_trace/presentation/routers/ingest.py:12-29` accepts that POST, and the ingest service saves runs and
trace nodes at `backend/src/agent_trace/application/services/ingest_service.py:63-76` and `:123-134`.

The cited wrapper span therefore does not establish a read-only operation. The direct writing caller and persistence
path refute the affirmative side-effect and permission claims. This satisfies the protocol blocker: a material claim
cites evidence that does not support that claim.

## Runtime boundary

No target runtime command was executed. StockSense-AI's target-owned path requires a separately driven server plus
live Gemini, NewsAPI and Supabase credentials. Starting only the server would not exercise the agent, and placeholder
credentials would measure an artificial failure path. Credentials, model output, external side effects and substitute
execution were not guessed. AgentTrace was the negative control and did not need an agent run.

## Decision, regressions and ineligibility

The release decision was **BLOCK**. Candidate `205d1d5cf4637e1b49e0c986843a2ed2d19b49cd` cannot be published.
The product defect must be generalized, fixed and verified in deterministic fixtures before another candidate is
frozen. That candidate needs a different unseen positive and negative pair.

StockSense-AI becomes a static regression at its evaluated revision. AgentTrace contributes a distinct precision
invariant and also becomes a static regression: an incomplete or caller-controlled fetch init cannot support a
read-only side effect or read permission. Both selected repositories and their source lineages are permanently
ineligible as blind holdouts at any revision.
