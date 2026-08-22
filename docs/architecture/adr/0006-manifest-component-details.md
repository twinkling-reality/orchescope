# ADR 0006: A manifest can distinguish a consumed system from the system under audit

- Status: accepted
- Date: 2026-08-22
- Deciders: repository maintainers

## Context

The manifest is the declared half for a repository whose source no adapter reads. It can declare a
component's kind, identity, location, permissions and runtime name, but it cannot declare the kind-specific
details every adapter can attach to the same component. The missing field is a precision boundary rather
than an omitted convenience.

`open-agent-platform` is the measured counterexample. It is pinned as `not_agent_system` at 26 components
with no `agent`, `model`, `tool` or `mcp_server` kind. Its source constructs an MCP client in
`apps/web/src/hooks/use-mcp.tsx` and connects that client to a remote server. A one component version 1
manifest citing that connection is honest about the repository, passes the manifest refutations, and flips
`agentSystemDetected` from false to true at 26 components becoming 27. The manifest can say
`kind: mcp_server`; it cannot say that the repository consumes the server rather than implements it.

Adapters already make that distinction through `McpServerDetails.role`. `implemented` is a server the
repository constructs, `consumed` is one its source connects to, and `developer_tooling` belongs to an
editor or coding agent rather than the shipped system. The three roles do not imply the same detection
answer.

There is a second distinction to preserve. The OpenAI Agents adapter records a consumed MCP server as part
of the system an agent in the same repository runs. Removing every consumed server from the audited
population would make the negative repository pass by hiding a true component from positive repositories.
Detection and participation are separate questions: a consumed server can participate in an agent system
without proving that its consumer is one.

## Decision

**Manifest document version 2 gives `ManifestComponent` an optional `details` field using the same
`ComponentDetails` discriminated union as a graph component.**

The manifest reader carries valid `details` unchanged into the component draft. Its `for` discriminator
must agree with the declared component `kind`, enforcing the same invariant before the draft reaches the graph.
Version 1 remains readable against its own closed shape; the absence of `details` retains its established
meaning and detection behaviour.

**An MCP server with `details.role: consumed` does not establish detection by itself.** It remains in the
graph, remains part of the audited population when other evidence establishes an agent system, and remains
available to topology, policy and reconciliation. `developer_tooling` remains excluded from the audited
population. An `implemented` server, or a version 1 server with no role, still establishes detection.

This is a manifest document version rather than an unversioned optional field because the field changes
what an otherwise identical manifest declaration means to detection. A version 1 reader must refuse a
version 2 document instead of accepting the component while silently discarding the role that keeps its
answer precise.

## Consequences

**A consumer can describe the boundary it reaches without claiming to implement the system across that
boundary.** The component remains a fact in the graph rather than disappearing to preserve a detection
flag.

**Kind-specific manifest facts use the same vocabulary as adapter facts.** Adding a second role language
for manifests would let the two declared paths disagree about the same component.

**Version 1 has an explicit reader.** Accepting its documents through the version 2 schema would also
accept version 2 fields under a version 1 number, which would make the version perform no work. Each shape
is validated under the number it declares.

## What the measurement said

Before the schema change, the one component version 1 manifest was accepted by `adapter:manifest`, added
the remote MCP server cited at `apps/web/src/hooks/use-mcp.tsx:46`, moved the component count from 26 to 27,
and flipped `agentSystemDetected` from false to true. Removing the manifest restored false at 26. The bound
in `mapping-architecture.md` therefore reproduced without qualification.

Version 2 moved exactly the one answer the decision names. With `role: consumed`, the audit reports false
at 27 components, `components.byKind.mcp_server: 1`, and the exported graph retains the manifest component,
its details and its cited source location. Changing only the role to `implemented` reports true at 27. The
version 1 manifest remains readable and reports true at 27. Removing it again restores false at 26.

## What would reverse this

The decision has three falsifiers, all on the same one component repository:

1. A version 2 manifest declaring `details: { for: mcp_server, role: consumed }` must leave
   `open-agent-platform` at `agentSystemDetected: false` with 27 components and one visible `mcp_server`.
   Dropping the component to preserve false fails the decision.
2. Changing only that role to `implemented` must make detection true. If both roles read false, the role is
   no longer discriminating ownership.
3. The version 1 manifest must remain readable and must retain its established true result. If a version 1
   document gains version 2 semantics without declaring them, the compatibility rule is hiding a meaning
   change.

The decision should also be reopened if the product definition changes so that consuming an agent system
is itself sufficient to call the consumer repository an agent system. That would move the non-goal held by
the pinned negative, and the corpus entry and this record would have to move together.
