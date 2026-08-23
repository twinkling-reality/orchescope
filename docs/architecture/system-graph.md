# The system graph

One graph describes an agent system. Everything else in Orchescope reads from it or writes into it: findings point at its
components, goals name them, comparisons diff them, and the browser map draws them.

## Components

A component is one thing the system is made of. The kinds are fixed, because a taxonomy that grows per repository cannot
be compared across repositories:

`entrypoint`, `agent`, `agent_group`, `workflow`, `workflow_step`, `model`, `provider`, `prompt`, `tool`,
`mcp_server`, `memory`, `retrieval`, `queue`, `database`, `external_service`, `approval_boundary`, `side_effect`,
`evaluator`.

An `agent` requires evidence of an agent construction or an equivalent model-delegating runtime identity. A
`workflow` is an orchestration container, and a `workflow_step` is one registered unit of its control flow.
Registering a function as a graph node does not establish that the function is an agent: it may be deterministic
routing, approval, formatting or a side effect. The distinction keeps application topology visible without turning
ordinary workflow code into a positive agent claim.

Each component carries:

- **`identity`**, the tuple that defines what it is (below).
- **`id`**, a readable identifier derived from the identity, such as `tool:issue_refund`.
- **`fingerprint`**, the SHA-256 of the canonical identity, used to match across machines.
- **`presence`**, three independent booleans: `static` (found in source or configuration), `runtime` (seen in a trace),
  `manifest` (declared in `.orchescope/manifest.yaml`). A component can be any combination, and the combination is the
  point: `static` without `runtime` is declared and never exercised.
- **`basis`** and **`confidence`**, how the component came to be known and how strongly.
- **`discoveredBy`**, every adapter that contributed, so two adapters agreeing is visible.
- **`sourceLocations`** and **`configLocations`**, where to look, as evidence rather than identity.
- **`evidence`**, identifiers of records that support its existence.
- **`details`**, a per kind discriminated payload: a model carries a model identifier, a tool carries its annotations, an
  approval boundary carries what it guards.
- **`sideEffect`** and **`permissions`**, what it does to the world outside the process.

## Identity, and why it is not a location

Identity is `(kind, namespace, local name)`.

- The **namespace** is a module path without its extension for a component defined in source (`src/tools/refund`), the
  configuration file path for one declared in configuration (`.mcp.json`), `manifest` for one declared in the manifest, or
  `runtime` for one only a trace has seen.
- The **local name** is normalised: lowercased, quotes removed, runs of unsupported characters collapsed to a hyphen,
  truncated to a hundred characters.

Four rules follow, and they are the reason the model works:

1. **An identifier never contains a line number, a byte offset, or a generated label.** Reformatting a file, or moving a
   definition, does not change any identifier.
2. **The same component in two scans of the same repository gets the same identifier.** That is what makes a comparison
   between a baseline and a candidate meaningful, and what lets a goal outlive the scan that produced it.
3. **Identifiers are readable**, because they appear in terminal output, findings, goals and agent prompts.
   `tool:issue_refund` is a name a person can use in a sentence.
4. **Collisions are resolved deterministically.** Two components that normalise to the same identity get a suffix derived
   from the full identity (`~a1b2c3`), never from the order in which they were discovered.

Models, providers, services, datastores and queues use a global namespace rather than a module path, because the same
model is the same model however many files mention it.

## Relations

An edge is a relation between two components, with a fixed kind:

`contains`, `invokes_model`, `calls_tool`, `hands_off_to`, `transitions_to`, `uses_prompt`, `reads_memory`, `writes_memory`,
`queries_retrieval`, `publishes_to_queue`, `consumes_from_queue`, `calls_service`, `queries_database`, `provides_tool`,
`served_by_provider`, `falls_back_to`, `guarded_by`, `performs_side_effect`, `validated_by`, `observed_after`.

An edge carries its own `presence`, `basis`, `confidence`, evidence and locations, and optionally a **policy**: the retry
attempts and backoff declared around it, whether that retry is bounded, and whether the operation's idempotency is
`declared`, `absent` or `unknown`. `unknown` is a first class answer and the one that matters most: a retry in front of an
operation whose repeat cannot be ruled out is the finding this model exists to support.

`observed_after` is the only kind that carries no design meaning. It records that one component ran after another in a
trace, which is sequence, not structure.

`hands_off_to` is reserved for evidence that one agent transfers work to another agent. `transitions_to` records
declared workflow control flow. A graph edge between registered steps establishes the latter, not the former.

## Invariants

Asserted at build time, before a graph is ever stored:

- Every edge endpoint exists in the graph.
- A self edge is only meaningful for `observed_after`, `hands_off_to` and `transitions_to`. A workflow step routing back to itself is a real
  retry loop; a component containing itself is a construction error.
- Every component has at least one piece of evidence.
- A component present at runtime carries at least one runtime evidence record.
- Confidence is within its band for the basis that produced it.
- Identifiers are unique.

A violation raises a classified internal error rather than producing a graph. A stored graph that violates an invariant
would silently corrupt every finding that cites it.

## Coverage travels with the graph

A graph is only as good as what was inspected, so every scan carries:

- files discovered, files parsed, bytes parsed, and how long it took;
- files skipped with a reason each (too large, unreadable, not a regular file, past the limit);
- languages parsed, with counts;
- adapters that ran, with what each found and whether it applied at all;
- areas that could not be inspected, with the reason (a language with no adapter, an MCP entry whose placeholder cannot be
  resolved);
- whether the scan hit its file ceiling and stopped early.

A report that shows a graph without this block would let a reader mistake "nothing found" for "nothing there".

## Provenance

A graph records the Orchescope version that produced it, the scan and project identifiers, when it was generated, a hash
of the project path rather than the path itself, the git commit, reference and dirty state, and the run identifiers it was
reconciled against. That is what makes a reconciliation reproducible: the static side is pinned to a revision, and the
runtime side is pinned to a set of runs.

## Related

- [discovery-lifecycle.md](discovery-lifecycle.md): how the static side is built.
- [runtime-observation.md](runtime-observation.md): how the runtime side is built and joined.
- [../protocols/system-graph-schema.md](../protocols/system-graph-schema.md): the document, field by field.
