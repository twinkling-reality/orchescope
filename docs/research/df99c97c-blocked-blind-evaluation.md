# Blocked blind evaluation of candidate df99c97c

## Decision

The independently selected blind evaluation of `orchescope@0.9.1` at
`df99c97c192e12177a7aa78dee012e0dec10bab5` completed, and the release decision was **BLOCK**. The evaluated package
archive had SHA-256 `0670c1ace229159a3bcd6a63ccfa53a7832db58b376272612225b2a7177a4709`, size 543,710 bytes,
package version `0.9.1`, and seven archive paths. The release summary recorded `published: false`. This artifact was not
published, tagged, pushed or attached to a release.

## Independent selection and exclusion

The evaluator selected the targets without inspecting the corrected Orchescope source, corpus, fixtures, research
records, development history or implementation discussion:

- Positive: `https://github.com/BBridgeers/tubemind` at
  `9ec1cd53c6e3f837563f6f80771b9270287621fb`. Its MIT `LICENSE` has SHA-256
  `c8189af9e333334c5adcfc05e245b625a1d39c15330b43b9ff806780066a35ab`.
- Proposed negative: `https://github.com/Cyrax321/SNAGLINE` at
  `7df6fdfedd1929975d45abfb0c8e8574f78cd04b`. Its MIT `LICENSE` has SHA-256
  `6f935eee3d2ce15ae2156fb3c8a15bf70cf4b78a96f791412e32b1e6fa4822b1`.

The evaluator paused before acquisition. A separate release owner searched the current tree, ignored corpus cache,
fixtures, research records, implementation paths, ref names, commit messages, every historical path, all 314 reachable
commits, and all 6,371 reachable Git objects. Neither proposed coordinate, revision, name or source lineage appeared.
Repository metadata identified both as public bounded MIT repositories without a fork, source, template or mirror
parent. The release owner granted exclusion clearance before the evaluator acquired either target.

Both repositories and their source lineages are permanently ineligible as blind holdouts at any revision. A corrected
candidate requires a different unseen positive and negative pair.

## Positive source and blocking silence

TubeMind is an implemented agent application. Its source builds a conversational path over local retrieval, system and
user messages, conversation history and model calls. A shared model helper contains function-scoped
`import openai as openai_lib`, constructs `openai_lib.OpenAI` with a runtime-selected compatible base URL, and calls
`client.chat.completions.create`.

The frozen package reported `agentSystemDetected: false`, marked `adapter:model-sdk` not applicable with zero relevant
imports, and told the terminal reader that no adapter recognised an agent system. It emitted no source-level refusal for
the concrete compatible-client calls. The adapter explicitly claims raw OpenAI-compatible clients and hand-written
model-call loops; silently discarding this supported lexical import was therefore a misleading applicability false
negative, not an honest unsupported boundary.

A runtime audit was not attempted. The repository supplies no bounded offline or fake runtime population for its video
ingestion, vector memory, embedding and provider paths. No dependency, credential, endpoint or substitute execution
path was invented, and no runtime claim is made.

## Proposed negative result

SNAGLINE's core package observes another agent system's event stream, but its exact repository tree also contains
executable agent demonstrations. One imports `create_agent`, supplies a deterministic offline tool-capable fake model,
registers tools and invokes the resulting agent without credentials. Another implements a bounded agent/tool loop.

Orchescope correctly detected an agent and model and cited the executable demonstration. The repository therefore
could not serve as a clean negative control. This was a holdout-selection failure, not a product defect: example source
remains in scope and detection must not be weakened or configured away to make a proposed negative pass.

## Evidence integrity

The evaluator invoked only the binary installed from the frozen archive. Installation, version and doctor checks;
static JSON and human audits; colour and `NO_COLOR` documents; JSON, Mermaid and SARIF exports; source-span reviews;
three repeat semantic projections per target; repository status; revisions; source hashes; environment-name capture;
commands; standard output; standard error; and exit statuses were preserved. Positive citations validated 4/4 and
negative citations 11/11. All repeats were byte-identical. Forced colour contained ANSI escapes and `NO_COLOR`
contained none. Both checkouts retained their pinned revisions and clean tracked state.

The completed-results manifest covered 586 evidence files, verified without mismatch, and had SHA-256
`df4bf8256123793624635ebe3a73d2bcbf892d9d91fe8ae1f4f5b62f9575b82e`. No target runtime was executed. Credential names
were recorded with values redacted, and the relevant credentials were absent.

## Regression disposition

Python import facts retain the lexical runtime scope that owns them. A guarded function-scoped namespace import can
authorize the compatible client constructed in that scope, but cannot leak into a sibling function or a use before the
import. Parameters, local rebindings, unrelated packages and imports after the use remain quiet. Client construction
and use also retain their conditional branch ownership: a same-branch call can use its client, while a call after
competing branch-local clients join receives an explicit unresolved control-flow boundary rather than one branch's
provider or model identity. The same settlement rule covers conditional, loop, try and match alternatives while
allowing a dominating straight-line or unconditional-finally assignment. An unsettled call preserves the enclosing
agent boundary only when every reachable receiver binding is a recognized model client; parameters, custom alternatives
and pre-existing object members keep that identity unproven.

A client whose base URL is selected at runtime establishes that the enclosing callable reaches a model boundary, but
does not establish the service provider or model identity. The corrected result detects the hand-written agent while
recording a source-located unresolved provider boundary; it does not label a dynamic compatible endpoint as OpenAI.

The positive is pinned as a source-cited regression input at its evaluated revision. The proposed negative contributes
no product precision invariant and is not added to the corpus. Neither regression work nor a corrected scan changes
this frozen decision or can clear the blocked candidate.
