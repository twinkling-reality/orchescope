# Passed blind evaluation at candidate fdb11aa

This record preserves one completed application of the
[pre-release blind evaluation protocol](../guides/pre-release-blind-evaluation.md). It is a release decision about one
frozen artifact and one independently selected pair, not evidence about another artifact or repository.

## Frozen boundary and independent selection

- Candidate revision: `fdb11aa207039252524aca368164a00d31b283b8`, tree
  `35b1017b862aeae741e81440f49dc2f58a8d0f75`
- Installed package: `orchescope@0.9.2`
- Evaluated tarball: `release/orchescope-0.9.2.tgz`, 597,355 bytes and seven files
- Evaluated tarball SHA-256: `f8debfc991451547349feb6d980579220e8c18dae1d4fdb94af4939102f434c1`
- Positive: `https://github.com/Dmitry9/docent` at
  `f8a44120b928f04e9e5a0ac507362efc8647e627`, tree `767d80ec8d0faac113e8d440749117622ad6e5ec`
- Positive licence: root MIT `LICENSE`, Git blob `14eef946848831cd85e76d289a93a933df479fcb`,
  content SHA-256 `23b95ef6133b01d2a5e8133a003fcbfa3fdfd0676c4cdbc41d95b6c606570d9e`
- Negative: `https://github.com/heswithme/claude-usage-analyzer` at
  `25eed40f95b8fa4eaf602a133f7060467d6e97c2`, tree `1af2242ad8c270d1ab626e9bac251b7ef1cb5948`
- Negative licence: root MIT `LICENSE`, Git blob `9a183473aa7ec138ddf5a25350002fc0b43ec99d`,
  content SHA-256 `32f3fd0d44f3055c8b946f6d19f4de2b0f2b5aad7613b3c2fd8041ea80e5bfc6`

The evaluator did not implement the candidate and selected both targets from public metadata only after the candidate
and package were frozen. The freeze is the merge of pull request 12 on main, not `7407faf` and not `641294a` alone.
`pnpm package` was rebuilt from this revision. The resulting archive bytes match the implementer tarball from
`641294a` because that merge added only corpus and documentation pins; the checksum used here is the one produced from
`fdb11aa207039252524aca368164a00d31b283b8`.

A workspace search of `corpus/corpus.yaml`, `corpus/expected`, `docs/research`, fixtures, commit messages, the
complete reachable Git history, and this evaluation prompt found zero occurrences of either owner, repository name,
URL, commit or tree before acquisition. Exclusion clearance authorized the clones; repository metadata did not settle
either role.

After clearance, the evaluator acquired the exact trees and read the production source needed to establish both roles.
The positive held 14 tracked regular files and 95,857 bytes, with complete source-manifest SHA-256
`570de135b0bdab61b64ee1f41dab78cdf2667d292865588874aa4d4c9f1cc542`. The negative held 12 tracked regular files
and 129,737 bytes, with complete source-manifest SHA-256
`2810de6d2ea08fd1f26f7340e24951118bb36cab2b1901860ba0acc372facf9a`. Neither tree contains a symlink or submodule,
and both original pins remained exact and clean through role validation and measurement.

Docent is an implemented goal-directed, model-mediated question-answering application. Its production package imports
`Agent` from `pydantic_ai`, constructs it in `build_agent` with a system prompt and a registered `search` tool, and
the console entry point calls `agent.run_sync` on the caller's question. The retriever is a local keyword matcher over
a hard-coded demo corpus. That is an implemented agent application rather than adjacent tooling.

Claude Usage Analyzer is a passive agent-adjacent log reader. Its production closure parses Claude JSONL usage logs,
aggregates token counts, and prices them. Optional Docker commands copy existing `.claude` directories out of
containers; `requests.get` fetches a LiteLLM pricing table. Recorded tool names, model names and session identifiers
remain inert data. The source does not construct or drive an agent, select tools or actions for a goal, or delegate
that behavior to downloaded code.

## Package and measurement integrity

The evaluator installed the tarball into a fresh prefix and invoked only that installed binary. It reported version
`0.9.2`; installation, package doctor and both target-scoped doctors exited successfully. Target doctors reported the
exact pinned commits and the single expected warning that no scenario is defined.

Every raw command, exit status, standard stream, JSON document, human document, export, integrity check and derived
comparison was written outside both target trees. The completed 59-file results manifest verified without a mismatch
and has SHA-256 `19e2c9348f0e30a44aac76069604c180c2fda5b3eb7eafe6a312ddeeb842656f`. The candidate worktree and both
original pins retained their exact revisions and clean status before and after measurement. Measurement copies received
the local store directory that an audit writes; those copies kept the same revisions and a clean index.

## Positive measurement

Docent reported `agentSystemDetected: true` with 3 static-only components:

- exact `agent:agent` from the `pydantic_ai.Agent` construction at `src/docent/agent.py:25`;
- exact `tool:build_agent.search` from the `@agent.tool` registration at `src/docent/agent.py:28`; and
- exact `prompt:system_prompt` from the `SYSTEM_PROMPT` binding passed as `system_prompt`.

The graph held 2 source-cited relations: `calls_tool` from the agent to the search tool, and `uses_prompt` from the
agent to the system prompt. No model, provider, workflow, database or external-service identity was invented from the
string default `anthropic:claude-sonnet-5`. No component carried a permission.

Coverage reported 6/6 supported Python files parsed, zero skips, 4,119 parsed bytes, 8 discovered files and 14
tracked files, with no truncation. Pydantic AI completed with two components and one relation from one inspected file;
prompts completed with one component and one relation from one inspected file; effects completed with zero output and
remained visible. The other 15 adapters were explicitly not applicable.

Topology was honestly `incomplete`, with one explicit tool relation, one complete prompt-use producer, and one
source-located refusal at `src/docent/agent.py:5`:

> adapter:pydantic-ai did not state an inspected topology population for this applicable input.

That refusal did not become a positive topology or reachability claim. The report emitted zero strengths and zero
component or finding metrics. Its sole finding was the info-severity `observability-coverage` risk
`OSC-NETJE-3376`, “No runtime evidence has been collected,” supported by an absence record scoped to the complete
loaded run population with an inspected count of zero.

Evidence export included all 9/9 eligible required records with zero omissions. All source-span citations matched the
pinned file hashes and the exact construction, registration and prompt lines. Every component, relation and finding
reference resolved, and every edge endpoint existed. JSON report, SARIF 2.1.0 and Mermaid exports parsed or rendered
structurally; SARIF contained one result, and Mermaid exposed both relations. Forced-colour output contained ANSI
styling and `NO_COLOR=1` output contained none. A full semantic repeat was identical.

## Negative measurement

Claude Usage Analyzer reported `agentSystemDetected: false` with 2 static-only components and one relation, all from
effects:

- `entrypoint:fetch_pricing`, inferred from the enclosing scope of an external effect; and
- `external_service:unresolved-host-fetch_pricing`, because `requests.get(self.LITELLM_URL)` keeps the address on a
  class constant that this build does not follow.

The request is a GET. The service carries only `network` read permission. No agent, tool, prompt, model, workflow or
database identity was invented. The terminal document stated that no adapter recognised an agent system, which agrees
with the closed-world source review: this repository observes usage logs rather than constructing an agent. That
sentence is not the unclaimed-construction silence the 0.9.2 coverage pass exists to stop. No `unclaimed_imported_construction`
was present, and none was required.

Coverage reported 7/7 supported Python files parsed, zero skips, 81,314 parsed bytes, 8 discovered files and 12
tracked files, with no truncation. Effects completed with two components and one relation from one inspected file. The
other 17 adapters remained visibly not applicable.

Topology was honestly `incomplete`, with one unresolved adapter-input refusal:

> adapter:effects did not state an inspected topology population for this applicable input.

Zero strengths were emitted. The sole finding was the same info-severity `observability-coverage` risk. Evidence
export included all 3/3 eligible required records. Citations matched the pinned `pricing_fetcher.py` hash at the
`requests.get` line. JSON report and SARIF parsed; SARIF contained one result; Mermaid rendered the single service
call. Forced-colour output contained ANSI styling and `NO_COLOR=1` output contained none. A full semantic repeat was
identical.

## Runtime boundary

No target runtime was executed. Neither repository supplies a target-owned Orchescope scenario. Docent's production
path calls a paid Anthropic model through pydantic-ai. `ANTHROPIC_API_KEY` was absent. There was no authorization to
install target dependencies, call that service or mutate external state. Claude Usage Analyzer is a log reader, so
executing it would not add an agent-runtime population.
Credentials, model output, external side effects and substitute execution were not guessed.

## Decision, regression and ineligibility

The release decision was **PASS**. Neither target produced a wrong identity, false relation or permission,
unsupported citation, hidden applicable-adapter silence, absence-based strength over incomplete topology, over-scoped
metric, unstable semantic identity, target mutation or artifact mismatch. The positive's unresolved pydantic-ai
topology population remained a bounded, source-located refusal rather than a positive claim. The negative's unresolved
host remained a named refusal rather than an invented GitHub identity, and it remained non-agent.

The positive becomes a full-static regression at the evaluated revision. That regression preserves the exact agent,
tool, prompt, relation and refusal populations reviewed against source and raw output. The negative adds no precision
invariant distinct from the existing agent-adjacent controls and the already-documented unresolved-host effects
boundary, so it does not join the corpus.

Both selected repositories and their source lineages are permanently ineligible as blind holdouts at any revision.
Candidate `fdb11aa207039252524aca368164a00d31b283b8` cleared this blind gate only for the evaluated `0.9.2` artifact
and selected pair. A subsequent artifact needs its own frozen candidate and a different unseen positive and negative pair
under the public protocol.
