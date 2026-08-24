# Blocked blind evaluation of candidate 63f31253

## Decision

The independently selected blind evaluation of `orchescope@0.9.1` at
`63f31253d5ca58ea29661074561c833b01462fef` completed, and the release decision was **BLOCK**. The evaluated package
archive had SHA-256 `5a0e18d6d37c71d4d9ccd5f4d6a6f8f62bc804b2f01d186bcc105dcce778bfd9`, size 568,036 bytes,
package version `0.9.1`, and seven archive paths. The release summary recorded `published: false`. This artifact was not
published, tagged, pushed or attached to a release.

## Independent selection, exclusion and role validation

The evaluator selected the targets without inspecting the corrected Orchescope source, corpus, fixtures, research
records, development history or implementation discussion:

- Positive: `https://github.com/Mothilal-M/agentic-browser` at
  `f6d83391a2f357bd806617492e469f3be28c0c8e`, tree
  `0396d4457e2498a01b4ca869698185ad2dd1536c`. Its MIT `LICENSE` has SHA-256
  `543f25e9ab865c20cb1507e5348a94d9dd20d174b20fd912f504abee7c1df131`.
- Negative: `https://github.com/H21465/claude-log-viewer` at
  `0f817d76e04ea88c4aa56f7515843ac56dfb5f86`, tree
  `2578354482a30189976d8ed92f78d937fba5aa2e`. Its MIT `LICENSE` has SHA-256
  `ff9c8801e508ecfb75a5f393fdc56368007d6b65ec4fe3f19ed70bbf1cad8a3d`.

The evaluator paused before acquisition. A separate release owner searched the current and ignored trees, corpus
cache, fixtures, research records, prior evaluation records, implementation paths, refs, commit messages, historical
paths, reachable commits and locally exposed Git populations. Neither coordinate, revision, tree nor application
source appeared in the exposed population. Repository metadata identified both as public, bounded, pre-freeze
repositories without a fork, source, template or mirror parent. The only shared non-source asset was a standard Vite
logo. The release owner granted exclusion clearance before acquisition.

Pinned-source review then established the roles. Agentic Browser is an end-user PyQt6 browser application. Its GUI
wires a user goal into a controller; the controller selects an execution tier, builds browser context and invokes a
compiled graph; and the graph constructs `agentflow.core.Agent`, `ToolNode`, browser tools and cyclic MAIN/TOOL
control flow. Claude Log Viewer parses existing Claude JSONL and subagent log records, calculates usage and serves a
local viewer. Its frontend calls those local viewer APIs, and its dependency population contains no model or agent SDK.

Both repositories and their source lineages are permanently ineligible as blind holdouts at any revision. A corrected
candidate requires a different unseen positive and negative pair.

## Blocking silent AgentFlow population

The positive imports exact runtime symbols from `agentflow.core`, constructs an Agent and ToolNode, registers them in a
state graph with cyclic routing, compiles that graph and invokes it from the browser controller. Those declarations and
calls are present in the supported Python population.

The frozen package nevertheless reported `agentSystemDetected: false`. It retained seven unrelated effect components,
six relations, 13 evidence records and one informational runtime-coverage finding, but reported no AgentFlow agent,
model, tool or workflow component or relation and no evidence or bounded refusal for that omitted population. Its agent
and model readers reported not applicable. The terminal document said that no agent system was detected. Three complete
semantic projections were identical, so the silence was repeatable.

This is publication-blocking misleading silence. Fully parsed, provenance-qualified AgentFlow construction and graph
source cannot support a public absence claim without either supported identity or an explicit bounded refusal. The
negative was reported correctly as having no agent system, but that cannot waive the positive false negative.

No target runtime was executed. The positive requires either a Gemini credential or an independently running model
endpoint, and normal operation controls a GUI browser with network and browser effects. It supplies no bounded fake or
offline model scenario. No credential, endpoint, browser task, provider response or substitute execution was invented,
and evaluator-local Claude logs were not parsed.

## Evidence integrity

The evaluator invoked only the binary installed from the frozen archive. Installation, version, binary digest and
doctor checks; static JSON and human audits; forced-colour and `NO_COLOR` documents; JSON, Mermaid and SARIF exports;
source-span reviews; three repeat semantic projections per target; target status and revisions; source hashes;
environment names with values redacted; commands; standard output; standard error; and exit statuses were preserved.
Both targets retained their pinned revisions and clean tracked state.

The completed-results manifest covered 567 evidence files and verified without mismatch. Its checksum had SHA-256
`ee7a36ea35615f9ec30632c8c31c049c350ee0f9c3c243994383556a464cf064`. The preserved results were made read-only. No
credential value, private path, runtime identifier or trace identifier is included in this public record.

## Regression disposition

The positive is pinned as a source-cited regression at its evaluated revision. The reader recognizes AgentFlow only
from exact `agentflow.core` runtime provenance, never from generic names such as `Agent`, `ToolNode` or `StateGraph`.
Direct, renamed and namespace imports retain provenance; foreign packages, local lookalikes, shadows and rebindings do
not acquire AgentFlow identity.

Stable source bindings establish Agent, ToolNode, workflow and step identity. Graph construction, registration,
compilation and invocation relations require matching lexical scope, source order and settled control flow. Aliases,
container paths, returned locals and destructuring are followed only while their source settlement remains exact;
computed, escaped, mutated, branch-ambiguous or otherwise unsettled populations become source-located refusals rather
than guessed graph relations. A source-declared positive `recursion_limit` is an invocation ceiling for that exact call,
not an observed run count, universal bound or static configuration default.

The selected positive therefore protects a modular provenance-and-behavior contract rather than a repository-shaped
name list. A future framework still needs an explicit provenance module or an honest unsupported boundary; similarity
to an AgentFlow class name is never sufficient. The negative contributes no additional precision invariant and is not
added to the corpus. Neither this regression work nor a corrected scan changes the frozen decision or can clear the
blocked candidate.
