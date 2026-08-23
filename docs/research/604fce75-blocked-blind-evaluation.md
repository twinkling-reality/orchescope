# Blocked blind evaluation of candidate 604fce75

## Decision

The independently selected blind evaluation of `orchescope@0.9.1` at
`604fce7516e47cd8971bedbb6da27b138e485fe0` completed, and the release decision was **BLOCK**. The evaluated package
archive had SHA-256 `6210cafc465c56aa2b8ed6d6328499799bd4e6c553327708d1b1141fd522a274`, size 542,124 bytes,
package version `0.9.1`, and seven archive paths. The release summary recorded `published: false`. This artifact was not
published, tagged, pushed or attached to a release.

## Independent selection and exclusion

The evaluator selected the targets without inspecting the Orchescope corpus, fixtures, research records, development
history, implementation discussion or source changes:

- Positive: `https://github.com/gaurav-oberoi/support-agent-hitl` at
  `66df5851249aa23ece37609ee1c856580fa2dcbd`. Its MIT `LICENSE` has SHA-256
  `c11d6cf0f52527fbb6dc4af3b60cd2d1ae1a8eeeecc4a8bcc76fe67fd7899b43`.
- Negative: `https://github.com/mylesndavid/argus` at
  `34fc9d0195392e9ac0011d23045f30c2291d33c0`. Its MIT `LICENSE` has SHA-256
  `f012de7997bd037c087c29263f3ad7ea7135eb60bd6ddf9b88d13f2fd39b1830`.

The evaluator paused before acquisition. A separate release owner searched the current tree, corpus and ignored corpus
cache, fixtures, research records, implementation paths and discussion, ref names, commit messages, every historical
path, and the content of every object reachable from all refs. The search included exact coordinates, revisions,
names, and distinctive source phrases. Neither proposed lineage appeared. Repository metadata identified both as
public MIT repositories without a fork parent or source repository. The release owner granted exclusion clearance
before the evaluator cloned either target.

Both selected repositories and their source lineages are permanently ineligible as blind holdouts at any revision.
A corrected candidate requires a different unseen positive and negative pair.

## Positive source and frozen result

The positive is an agent application. `app/graph.py` constructs and invokes a LangGraph workflow;
`app/nodes.py` constructs `_TRIAGE | llm | StrOutputParser()` and invokes that model-backed chain only inside `triage`.
The other registered functions are not agents: `approval_gate` is deterministic approval and interrupt handling,
`execute_refund` is a deterministic approved side effect, and `respond` is deterministic response routing and
formatting.

The installed frozen package instead reported all four workflow nodes as four `agent` components. It derived
`hands_off_to` relations between those identities and told the human reader that the scan found four agents. Workflow
registration establishes a step in control flow; it does not establish model delegation or agent identity. A workflow
transition likewise does not establish an agent handoff. The wrong component identities and relations are positive,
material claims, not bounded refusals, and independently satisfy the publication blocker for wrong identity.

## Negative result and evidence integrity

The negative remained correctly classified as agent-adjacent rather than an agent system. The frozen package reported
entrypoint, database and external-service components, no agent, model or tool identities, zero strengths, and an
explicit incomplete runtime boundary. It made no broader absence claim from unsupported runtime evidence.

The evaluator invoked only the binary installed from the frozen archive. Installation, version and doctor checks;
static JSON and human audits; colour and `NO_COLOR` documents; JSON, Mermaid and SARIF exports; source-span reviews;
repeat semantic projections; repository status; revisions; source hashes; environment-name capture; commands; standard
output; standard error; and exit statuses were preserved. Forced-colour output contained ANSI escapes and `NO_COLOR`
output contained none. Both repeat semantic projections were byte-identical. Both target checkouts retained their
pinned revisions and clean tracked state. A completed-results manifest covered 244 evidence files and verified without
a mismatch.

No runtime audit was executed. The positive supplied bounded offline fake-model tests, but the conclusive static
identity defect already required publication to stop. No credential, live model, guessed secret, substitute runtime or
fake production path was used, and no runtime claim is made.

## Regression disposition

The generalized invariant is that workflow construction and node registration produce `workflow` and `workflow_step`
identities, while declared graph control flow produces `transitions_to`. Agent identity still requires separate agent
construction or model-delegating runtime evidence. The positive is pinned as a regression input at its evaluated
revision with exact source-cited identities and transitions. The negative adds no distinct precision invariant and is
not duplicated in the corpus. Neither regression work nor a corrected scan changes this frozen decision or can clear
the blocked candidate.
