# Blocked blind evaluation of candidate 724a1abd

## Decision

The independently selected blind evaluation of `orchescope@0.9.1` at
`724a1abda9a1176b28b5633495d67a6b0e2bc194` completed, and the release decision was **BLOCK**. The evaluated package
archive had SHA-256 `38981b8d9a6a6b626d74c7ae9ebb170cb550217528011270165a207cc5cfbcc5`, size 554,554 bytes,
package version `0.9.1`, and seven archive paths. The release summary recorded `published: false`. This artifact was not
published, tagged, pushed or attached to a release.

## Independent selection and exclusion

The evaluator selected the targets without inspecting the corrected Orchescope source, corpus, fixtures, research
records, development history or implementation discussion:

- Positive: `https://github.com/AnshMNSoni/email-agent` at
  `67a176ef44f2ec9b7edfeec8b7da665beaf0a749`. Its MIT `LICENSE` has SHA-256
  `7266b6393e321d6d431a4dcd1a033980df14bce64ed51f0686d6b2a9217a8b5f`.
- Proposed negative: `https://github.com/wzchav/tokentab` at
  `608a27881e865f020a86e0fc45f580224e25e161`. Its MIT `LICENSE` has SHA-256
  `4445ce0aacef628e792df8c6056db618044bc95380f2fd45aee9f3e1c0b554ba`.

The evaluator paused before acquisition. A separate release owner searched the current and ignored trees, corpus
cache, fixtures, research records, implementation paths, refs, commit messages, every historical path, all reachable
commits and all reachable Git objects. Neither coordinate, revision, name, distinctive phrase nor nonempty source blob
appeared in the exposed population. Repository metadata identified both as public bounded repositories without a fork,
source, template or mirror parent. Both exact revisions existed before the candidate freeze. The release owner granted
exclusion clearance before the evaluator acquired either target.

Both repositories and their source lineages are permanently ineligible as blind holdouts at any revision. A corrected
candidate requires a different unseen positive and negative pair.

## Verified positive boundary

Email Agent is an implemented LangGraph application. The frozen package discovered one workflow and exactly eight
source-cited workflow steps. It retained all seven literal conditional destinations from `classify_intent` as
`transitions_to`, and identified the literal `ChatOllama` model as `qwen2.5-coder:3b` served by Ollama. It did not
present any workflow step as an agent or any transition as an agent handoff.

The topology remained explicitly incomplete at three supported boundaries: the raw model client did not establish a
closed topology population, no supported LangGraph entry boundary was found, and the loop-built terminal edges did not
state two bounded literal endpoints. The report emitted no strength and no component metric. Its only finding stated
that zero runs had been observed.

No runtime audit was executed. The ordinary application path requires Gmail authorization state in `credentials.json`
or `token.pickle`, interactive Google OAuth when that state is absent, and a running local Ollama model. Neither Gmail
file existed and the target supplied no fake, fixture or offline scenario. `OLLAMA_HOST` and `OLLAMA_MODEL` were unset.
`GOOGLE_APPLICATION_CREDENTIALS` was present with its value redacted, but the target does not read that variable and it
does not replace the missing Gmail files. No mailbox, user request, credential, model service or substitute runtime was
invented.

## Blocking holdout-role failure

Tokentab was proposed as a negative that only read existing coding-agent logs. The acquired exact revision did contain
that analysis code, but its tracked and packaged command modules also implement an interactive coding-agent surface.
They construct `Agent(config=cfg)`, pass it to a read-evaluate-print loop, call `agent.send(user_in)`, expose
`agent.tools`, reset conversation state and accept a model override. The package manifest declares that module as its
command entry point, and the parser describes the command as an interactive coding agent.

Its setup module also downloads Python from a fixed remote host, executes the bytes in memory with
`exec(compile(...))`, and invokes the downloaded entry point. Describing that source as ordinary data transfer or as a
repository that does not select tools or execute an agent was false. The frozen scan reported
`agentSystemDetected: false`; that result cannot establish negative precision for a target that is not a negative.
The evaluator's provisional PASS was therefore overturned by the independent release-owner review.

This is a holdout-selection and source-role validation failure. A generic constructor named `Agent` without verified
provider or local-definition provenance still cannot establish a provider identity; weakening that invariant would
turn unrelated domain classes into agents. The correction instead requires source-role validation after exclusion
clearance and before a selected negative can contribute release evidence. A proposed negative that implements an agent
or delegates its executable surface to downloaded code is rejected, retired and replaced.

## Evidence integrity

The evaluator invoked only the binary installed from the frozen archive. Installation, version, binary digest and
doctor checks; static JSON and human audits; forced-colour and `NO_COLOR` documents; JSON, Mermaid and SARIF exports;
source-span reviews; three repeat semantic projections per target; target status and revisions; source hashes;
environment names with values redacted; commands; standard output; standard error; and exit statuses were preserved.
Positive citations validated 20/20 and the proposed negative citation validated 1/1. Evidence coverage omitted nothing.
All repeats were byte-identical. Forced colour contained ANSI escapes and `NO_COLOR` contained none. Both targets
retained their pinned revisions and clean tracked state.

The completed-results manifest covered 546 evidence files, verified without mismatch, and had SHA-256
`f4ca15a4fef4ce5f14ebf3367b4290d299e1ca224a42a1fcfbf000c9a6acc4bc`. The preserved results, checkouts and isolated
installation were made read-only. No credential value, private path, runtime identifier or trace identifier is included
in this public record.

## Regression disposition

The positive is pinned as a source-cited regression input at its evaluated revision. Its exact workflow, eight steps,
seven conditional transitions, Ollama model/provider identity, three explicit topology refusals, zero strengths and
zero component metrics form the retained invariant.

Tokentab contributes no clean negative precision invariant and is not added to the corpus. The protocol regression
instead requires an acquired negative's exact source to support its proposed role before its scan can support a release
decision. Neither this regression work nor a corrected scan changes the frozen decision or can clear the blocked
candidate.
