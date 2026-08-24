# Blocked blind evaluation of candidate 13383b88

## Decision

The independently selected blind evaluation of `orchescope@0.9.1` at
`13383b88c22cfa7c1bb6035ff6a184ad60f61295` completed, and the release decision was **BLOCK**. The evaluated package
archive had SHA-256 `b7c9b14ffffbb1109f713bdea2518f2181ec8931d7de4a7318f745ee60cb8441`, size 590,532 bytes,
package version `0.9.1`, and seven archive paths. It was not published, tagged, pushed or attached to a release.

## Independent selection and source roles

The evaluator selected both targets after the candidate freeze and before acquiring either source tree:

- Positive: `https://github.com/tanish-jain-225/job-hunter` at
  `dc69eab54408e1bfa2f927a776a565d750cb6152`, tree `c4cac1531ab80eda19398d9341c71ee73b9987e1`.
  Its root MIT `LICENSE` has SHA-256
  `43c1bc84cd012163f1e3fd8ed320a46c0a809746254b504c932a56fb57942b78`.
- Negative: `https://github.com/pixle-codes/fenceline` at
  `7c614800b85849c5d0d4a61a7ea754e4261e120b`, tree `d2a0b24bd4d68e4d44843ad5523851a4294ba88f`.
  Its root MIT `LICENSE` has SHA-256
  `5f6123e6eee6f1853bbe96e2f1e47d485901e4cb4c730a333e1c82cb9b562baf`.

The release owner independently found zero matches for both coordinates, owners, names, revisions, trees, licence
identities and source lineages across the tracked and ignored development tree, corpus definitions, fixtures,
evaluation records, refs and complete Git history before granting acquisition clearance.

Job Hunter is an implemented model-mediated workflow. Its production pipeline fetches public ATS postings, sends
candidate and job facts through a provider interface, writes returned fit scores onto the jobs, selects and orders a
shortlist from those scores, asks the model for a second application kit for each selected job, persists the result and
can send the digest. The model output governs what the workflow does. This is narrower than a tool-selecting ReAct
agent, and the record does not claim otherwise.

Fenceline is an agent-adjacent observer. Its complete production Python path opens completed Claude, Codex, generic
JSONL and local SQLite records, reduces recorded calls to inert event values, applies deterministic policy predicates
and renders findings. It has no subprocess, shell, network, model, dynamic-import or delegated-agent execution path.
The evaluator and release owner independently verified both source roles before installing Orchescope.

Both repositories and their source lineages are permanently ineligible as blind holdouts at any revision. A corrected
candidate requires a different unseen positive and negative pair.

## Positive measurement and runtime boundary

The installed artifact reported `agentSystemDetected: false` for Job Hunter with 35 components and 17 relations. Those
components were 17 source-scoped entry points, 17 external services and exact `provider:anthropic`; every final
relation was `calls_service`. The effects adapter completed with 35 components and 21 pre-reconciliation relations,
and the model adapter completed with one provider component from one exact applicable import. No framework-specific
adapter recognized the hand-written agent composition.

The scan parsed all 50 supported files from 58 discovered inputs without a skip or truncation, included all 42 eligible
evidence records, reported no run, no observed or runtime-only component, no metric and no strength, and kept topology
incomplete with two explicit adapter-population refusals. It reported the exact Anthropic provider identity and a
source-supported high retry-around-non-idempotent-operation finding over the bounded Gemini request retry, plus the
informational observability finding. Repeat audit, Mermaid and SARIF projections were stable after generated identities
and times were excluded as the protocol requires.

No target runtime was executed. Job Hunter's ordinary path reaches public ATS and model services, persists state and
may send email. No credential, model response, external input population, email destination or substitute execution
was invented. Measurement stopped when the static negative exposed the conclusive blocker.

## Blocking read-only permission claim

Fenceline was correctly classified as not an agent system. Its static graph contained `entrypoint:read_db`,
`database:sqlite` and one `queries_database` relation, with one informational observability finding, no strength and no
runtime claim. The scan parsed all 10 supported files from 11 discovered inputs without a skip or truncation and
included all three eligible evidence records.

The database component nevertheless declared permission `{ kind: "database", scope: "sqlite", mode: "write" }`, and
the permissions overlay counted one write permission. Both claims cited `fenceline/readers.py:342`, whose exact pinned
source is:

```python
conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
```

The report's source digest matched the pinned file. Python's literal `uri=True` makes the exact `mode=ro` URI parameter
operative, so the connection is explicitly restricted to reads. The cited evidence directly contradicts the material
write-permission claim. That is a publication blocker under the protocol, not an honest unsupported boundary.

The evaluator stopped immediately after preserving the blocker. The negative repeat, terminal colour checks and all
runtime assessment were not run. Both target worktrees and the candidate remained at their exact clean revisions.
The completed-results manifest covered 136 files, verified without a mismatch, and had SHA-256
`f38a36d6ce98571f62d48387e81dfdc7b58f98cd3f87ddadbe2d94af8e35d85b`.

## Generalized correction and regression disposition

The correction reads a SQLite access boundary only from exact provider-qualified constructor syntax. Python is
read-only only when the source supplies both a URI whose query contains the exact `mode=ro` value and literal
`uri=True`. A URI-shaped ordinary filename does not establish that boundary. Node's exact `node:sqlite.DatabaseSync`
constructor is read-only only with literal `{ readOnly: true }`. Dynamic options and the writable defaults retain write
permission. No repository name, function name or generic database spelling participates in the decision.

The corpus semantic contract pins exact per-component permission populations. A permission substitution breaks
the acceptance gate even when component identities, relation identities and aggregate counts remain unchanged.

The positive is pinned at its exact revision as a bounded unsupported-detection regression: effects and model output
remain visible, exact identities and citations remain fixed, topology remains incomplete, and no absence claim or
strength is inferred from the missing hand-written agent identity. The negative is also pinned because it contributes
the distinct exact read-only permission invariant. Generalized Python and Node fixtures prove both read-only forms and
the writable controls. These regressions cannot clear the blind gate; the corrected candidate still needs a different
unseen positive and negative pair.
