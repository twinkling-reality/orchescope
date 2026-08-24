# Blocked blind evaluation of candidate 84c80b2e

## Decision

The independently selected blind evaluation of `orchescope@0.9.1` at
`84c80b2e2ee1935c6925d12b585f02782358f122` completed, and the release decision was **BLOCK**. The evaluated package
archive had SHA-256 `38981b8d9a6a6b626d74c7ae9ebb170cb550217528011270165a207cc5cfbcc5`, size 554,554 bytes,
package version `0.9.1`, and seven archive paths. The release summary recorded `published: false`. This artifact was not
published, tagged, pushed or attached to a release.

## Independent selection, exclusion and role validation

The evaluator selected the targets without inspecting the corrected Orchescope source, corpus, fixtures, research
records, development history or implementation discussion:

- Positive: `https://github.com/Womp-Womp/MultiAgentDiscordBot` at
  `fded3337ba2daa9393ef7dea3977f76545de7a84`. Its MIT `LICENSE` has SHA-256
  `91f18277c312c18292bdb7871c9d213852966e790e0701a0951b25dcada7e3c0`.
- Negative: `https://github.com/aichain-tw/claude-jsonl-viewer` at
  `ce6dd5c5cfba3c26887b5619e4b4cff75bb2074a`. Its MIT `LICENSE` has SHA-256
  `72380798af61d6131287b0dd3c8dc5345535df641002fece3a02d7ef109c5f8e`.

The evaluator paused before acquisition. A separate release owner searched the current and ignored trees, corpus
cache, fixtures, research records, implementation paths, refs, commit messages, every historical path, all reachable
commits and all reachable Git objects. Neither coordinate, revision, tree, distinctive phrase nor nonempty source blob
appeared in the exposed population. Repository metadata identified both as public, bounded repositories without a
fork, source, template or mirror parent, and both exact revisions existed before the candidate freeze. The release
owner granted exclusion clearance before acquisition.

After acquisition and before measurement, the evaluator and release owner independently validated both roles from the
exact source. MultiAgentDiscordBot constructs model-backed tools, legacy LangChain agents and executors, a routing
supervisor, a per-request LangGraph and a Discord command that streams the graph. Claude JSONL Viewer loads only its
tracked local scripts, reads user-selected JSONL files, parses, indexes, filters and renders prior Claude records. Its
browser preference storage and clipboard action do not construct or drive an agent. It contains no model, tool
selection, network, dynamic-code or downloaded-code execution path.

Both repositories and their source lineages are permanently ineligible as blind holdouts at any revision. A corrected
candidate requires a different unseen positive and negative pair.

## Correctly retained boundaries

The frozen package correctly identified one LangGraph workflow, five registered workflow steps and their explicit
workflow relations. It retained the literal `ChatOpenAI` model as a possible OpenAI-library configuration rather than
claiming that a runtime-selected compatible endpoint was observed. Every emitted component, relation and citation was
supported by the pinned source. Topology remained incomplete through five bounded refusals, the only finding said that
zero runs had been observed, and no strength or component metric was emitted.

No runtime audit was executed. The ordinary application requires `DISCORD_BOT_TOKEN` and `OPENAI_API_KEY`; both names
were absent, and the repository supplies no fake, fixture or offline execution path. No Discord user, request, token,
model response or substitute execution was invented.

The negative was also reported truthfully. Both JavaScript source files parsed, the effects adapter completed visibly
with zero output, and the graph, findings, strengths and component metrics were all empty. Its local JSONL parsing did
not become an agent claim.

## Blocking silent agent population

The positive imports `create_openai_tools_agent` and `AgentExecutor` from `langchain.agents`. Its local factory builds
an OpenAI-tools agent, passes it and its tools to an `AgentExecutor`, returns that executor, and is called to construct
three persistent workers plus one request-scoped personality worker. Those executors are invoked by the callbacks
wired into the active LangGraph.

The frozen output nevertheless contained zero `agent` components and no agent-to-model or agent-to-tool relations.
`adapter:langchain-v1-create-agent` reported `not_applicable` with zero relevant imports, because it reads only the
newer `create_agent` export. None of the five topology refusals named the unrecognized legacy factory, executor or four
agent instances. The terminal document said the single source file was fully parsed while presenting only workflow,
workflow-step and model identities.

This is publication-blocking misleading silence. Workflow registration correctly establishes workflow-step identity,
not agent identity, but that precision does not permit a separate source-proven agent population to disappear. The
honest-refusal exception applies only when the unsupported population is named at its source boundary.

The generalized correction qualifies the exact legacy exports by runtime import, settles a unique
`create_openai_tools_agent` to its `AgentExecutor`, and follows a uniquely returned local factory to each stable assigned
call site. It emits source-scoped agents and only source-settled model, tool and prompt relations. A shadowed import,
computed endpoint, ambiguous construction or unsettled wrapper becomes a source-located refusal instead of a component
or silence. A generic `Agent`, executor or factory spelling without provider provenance still proves nothing.

## Evidence integrity

The evaluator invoked only the binary installed from the frozen archive. Installation, version, binary digest and
doctor checks; static JSON and human audits; forced-colour and `NO_COLOR` documents; JSON, Mermaid and SARIF exports;
source-span reviews; three repeat semantic projections per target; target status and revisions; source hashes;
environment names with values redacted; commands; standard output; standard error; and exit statuses were preserved.
Positive evidence coverage was 30/30. All repeats were byte-identical, and colour-stripped forced-colour documents were
byte-identical to their `NO_COLOR` counterparts. Both targets retained their pinned revisions and clean tracked state.

The completed-results manifest covered 470 evidence files, verified without mismatch, and its checksum sidecar had
SHA-256 `85288c0f7831d72c32b083c4eeb09ac2de1601170d36e40097b752bc8d229693`. The preserved results,
checkouts and isolated installation were made read-only. Four exploratory shape queries did not supply a usable bundle
review: commands 040 through 042 exited 5, and command 043 exited 0 while summarising array indexes instead of
the bundle. Commands 044 through 049 supplied the corrected read-only claim review. A later quoting-defective
exploratory check was also preserved and superseded by a strict passing check. Those discrepancies did not cause or
waive the product defect. No credential value, private path, runtime identifier or trace identifier is included in
this public record.

## Regression disposition

The positive is pinned as a source-cited regression at its evaluated revision. Its exact legacy import provenance,
local returned-factory settlement, four stable agent identities, model and decorated-tool relations, and explicit
prompt boundary form the distinct invariant. The negative contributes no additional precision invariant and is not
added to the corpus. Neither this regression work nor a corrected scan changes the frozen decision or can clear the
blocked candidate.
