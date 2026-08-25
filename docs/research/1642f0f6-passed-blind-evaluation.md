# Passed blind evaluation at candidate 1642f0f6

This record preserves one completed application of the
[pre-release blind evaluation protocol](../guides/pre-release-blind-evaluation.md). It is a release decision about one
frozen artifact and one independently selected pair, not evidence about another artifact or repository.

## Frozen boundary and independent selection

- Candidate revision: `1642f0f6d17773547e69da319bac627e5001dd44`, tree
  `eb6dc07365d2af1f13da9cf8beeab26065f28d29`
- Installed package: `orchescope@0.9.1`
- Evaluated tarball: `release/orchescope-0.9.1.tgz`, 594,352 bytes and seven files
- Evaluated tarball SHA-256: `1db83a22e104f5f9c2537f175fcb903b96242d99245e26b3c02fd4edb11f2fd3`
- Positive: `https://github.com/momtazularefin/prcritiq` at
  `338e925a9254690ed0815fd71062767bbf2b098a`, tree `e976789b95df4b86fc082b34b3b8d3e93d6b6008`
- Positive licence: root MIT `LICENSE`, Git blob `993fa1cdf02ab6869c43811ff73e24387f986a1f`,
  content SHA-256 `dadb371f681b9e2d928c054d2576041ae5032a7c6b9b194fcccf9269b2e60864`
- Negative: `https://github.com/omrgpt/agentport` at
  `3b6ce6c16ae18419d9a8d6cda0e494119c6c4886`, tree `da007f3cb3fa3d376248cfdc3d7c61672c4f8a13`
- Negative licence: root MIT `LICENSE`, Git blob `6d3bb08f41e7fd88c327eb6b21d46f1270d4d8cb`,
  content SHA-256 `86ec95dfbefa9537a75b78cf54b032c1dd53bda5d87b145653da6024f4a33f82`

The evaluator did not implement the candidate and selected both targets from metadata only after the candidate and
package were frozen. A separate release-owner audit found zero occurrences of either owner, repository, revision,
tree, repository identifier, owner identifier or licence blob in the workspace, ignored caches, refs, reflogs,
stashes, remotes, commit messages, diffs, paths or the complete reachable Git history before acquisition clearance.
The completed metadata-selection manifest has SHA-256
`baa9af43d3ffde6b405e2bedfaaaccc708c6d1d251621f84bb1cc28738fdd5fe`.

After clearance, the evaluator acquired the exact trees and read the production source needed to establish both
roles. The release owner independently verified that reading before authorizing measurement. The positive held 60
tracked regular files and 397,141 bytes, with complete source-manifest SHA-256
`89dcd9c91766e3de317a2f9778d63d9142c0cd2f4588d0769ceaf18c5aa7c81a`. The negative held 44 tracked regular files
and 202,379 bytes, with complete source-manifest SHA-256
`89f03c9bdb31c71a7f0750f2ae064c8661556a457de37b1118a46c41423e051e`. Neither tree contains a symlink or
submodule, and both remained exact and clean through role validation.

PRCritiq is an implemented goal-directed, model-mediated pull-request review application. Its production CLI invokes
a seven-node LangGraph pipeline, routes an exact Anthropic or OpenAI provider, obtains structured candidate findings,
independently checks their evidence and changed-line support, and selects publish or suppress before reporting the
result. It is a fixed review pipeline rather than an open-ended tool-selecting agent, and GitHub comment posting is
not implemented.

Agentport is a passive agent-adjacent converter. Its production closure reads and writes coding-agent instructions,
MCP configuration and skill-description files. Recorded commands, URLs, environment fields and allowed-tool names
remain inert data: the source does not construct or drive an agent, call a model, execute those values, contact those
URLs, download code or delegate execution.

## Package and measurement integrity

The evaluator installed the tarball into a fresh prefix and invoked only that installed binary. It reported version
`0.9.1`; installation, package doctor and both target-scoped doctors exited successfully, and the target doctors
reported zero warnings. All seven installed package files matched the archive byte-for-byte.

Every raw command, exit status, standard stream, JSON document, human document, export, integrity check and derived
comparison was written outside both target trees. The completed 114-file results manifest verified without a mismatch
and has SHA-256 `163629b2fbaecac2aad6bfb10a44485d92421c3138e933fe56cf3681c50adbc8`. The candidate worktree and both original
and measurement target checkouts retained their exact revisions and clean status before and after measurement.

## Positive measurement

PRCritiq reported `agentSystemDetected: true` with 10 static-only components:

- exact `provider:anthropic` and `provider:openai` components;
- `workflow:graph.py-graph`; and
- seven exact workflow-step identities: `fetch_diff`, `guardrail_gate`, `static_analysis`, `retrieve_context`,
  `reason_and_draft`, `self_critique` and `post_or_summarize`.

The graph held 13 source-cited relations: seven workflow containment relations and the six exact internal
`transitions_to` relations. The LangGraph construction remained a workflow rather than being mislabeled as an agent.
START and END were retained as one entry and one terminal boundary rather than invented component edges. Anthropic and
OpenAI each carried only its own source-supported `network/write` permission. No configurable model default, GitHub
service, database, subprocess or provider-to-workflow relation was invented.

Coverage reported 37/37 supported Python files parsed, zero skips, 244,510 parsed bytes, 40 discovered files and 60
tracked files, with no truncation. LangGraph completed with eight components and 13 relations from one inspected file;
model SDK completed with two components and zero relations from two exact applicable imports in one file; effects
completed with zero output. The other 15 adapters were explicitly not applicable.

Topology was honestly `incomplete`, with 18 inspected inputs, six explicit transitions and two source-located
refusals at `src/prcritiq/providers.py:113` and `src/prcritiq/providers.py:154`:

> adapter:model-sdk recognized a raw client or wrapper but has not stated a closed topology population for that
> producer.

Those refusals did not become a positive topology or reachability claim. The report emitted zero strengths and zero
component or finding metrics. Its sole finding was the info-severity `observability-coverage` risk
`OSC-NETJE-3376`, “No runtime evidence has been collected,” supported by an absence record scoped to the complete
loaded run population with an inspected count of zero.

Evidence export included all 19/19 eligible required records with zero omissions. All 18 source-span citations matched
the pinned file hashes and exact construction, registration and transition lines. Every component, relation and
finding reference resolved, and every edge endpoint existed. JSON report, SARIF 2.1.0 and Mermaid exports parsed or
rendered structurally; SARIF contained one result, and Mermaid exposed all six transitions while stating that seven
containment relations were omitted under its edge limit. Forced-colour output contained ANSI styling and
`NO_COLOR=1` output contained none. A full semantic repeat was byte-identical at SHA-256
`ba7a6eacb7dc3649d1911f123ca77e167bb08efb21f7ca5b22e36daa9d3834aa`.

## Negative measurement

Agentport reported `agentSystemDetected: false` with zero components, relations, findings, strengths, evidence
records, permissions and metrics. It parsed 22/22 supported Python files with zero skips, covering 172,044 parsed
bytes across 32 discovered and 44 tracked files without truncation.

Effects completed with zero output. The other 17 adapters remained visibly not applicable, and every adapter carrying
explicit applicability reported zero relevant imports, zero distinct files and zero omitted imports. No topology or
unsupported entry was emitted because no component population existed. That agrees with the closed-world source
review: its MCP and skill fields are converter data, not executable agent behavior.

JSON report and SARIF parsed; SARIF contained zero results, and Mermaid contained only the empty `flowchart LR` graph.
Forced-colour output contained ANSI styling and `NO_COLOR=1` output contained none. A full semantic repeat was
byte-identical at SHA-256 `c58ca8677d775e667b025b572a2c02b30aabbe398c2ef3b762c778e6282a982d`.

## Runtime boundary

No target runtime was executed. Neither repository supplies a target-owned Orchescope scenario. PRCritiq's production
path performs external GitHub reads, may download a source archive, executes an allowlisted static tool, calls paid
external model providers and may write Postgres. `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DATABASE_URL`,
`LANGSMITH_API_KEY` and `GITHUB_WEBHOOK_SECRET` were absent. There was no authorization to install target dependencies,
call those services or mutate external state. Agentport is a passive converter, so executing it would not add an
agent-runtime population. Credentials, model output, external side effects and substitute execution were not guessed.

## Decision, regression and ineligibility

The release decision was **PASS**. Neither target produced a wrong identity, false relation or permission,
unsupported citation, hidden applicable-adapter silence, absence-based strength over incomplete topology, over-scoped
metric, unstable semantic identity, target mutation or artifact mismatch. The positive's unresolved provider wiring
remained a bounded, source-located refusal rather than a positive claim, and the negative remained a clean zero.

The positive becomes a full-static regression at the evaluated revision. That regression preserves the exact
workflow, provider, permission, relation and refusal populations reviewed against source and raw output. The negative
adds no precision invariant distinct from the existing agent-adjacent controls, so it does not join the corpus.

Both selected repositories and their source lineages are permanently ineligible as blind holdouts at any revision.
Candidate `1642f0f6d17773547e69da319bac627e5001dd44` cleared this blind gate only for the evaluated `0.9.1` artifact and
selected pair. A subsequent artifact needs its own frozen candidate and a different unseen positive and negative pair
under the public protocol.
