# ADR 0012: Topology strengths require complete falsifying evidence

- Status: accepted
- Date: 2026-08-22
- Deciders: repository maintainers

## Context

The blind target declares a LangGraph conditional router whose return annotation is
`Literal["finalize_summary", "web_research"]`. Its body returns those same two strings. LangGraph 1.1.3 uses a
`Literal` return annotation as the destination map when `add_conditional_edges` supplies no explicit map. One
destination closes the cycle from `web_research` through `summarize_sources` and `reflect_on_summary` back to
`web_research`.

Orchescope 0.9.0 reads the named router call and emits neither destination. `topology-shape` evaluates the remaining
linear graph and reports that the topology is reachable, acyclic, and narrow. The positive claim treats a missing edge
as evidence that the edge does not exist.

LangGraph also declares `START` and `END` as reserved, possibly virtual boundary nodes. They select entry and terminal
control flow. They are not application agents and do not belong in displayed component or runtime exercise populations.
Their boundary facts still matter to reachability, termination, and evidence completeness.

## Falsifier stated before implementation

Reject this decision unless all of these hold:

1. The pinned target produces both conditional destinations with exact source evidence and receives no acyclic strength.
2. A complete genuinely acyclic graph still receives the applicable strength.
3. An unresolved router suppresses each strength it could falsify without inventing an edge or cycle.
4. A deterministic conditional cycle is discovered from syntax without using repeated runtime execution as relation
   evidence.
5. Dynamic destinations remain unsupported and are reported with a bounded sample and reason.
6. `START` and `END` remain absent from displayed components and exercise denominators while their declarations are
   accounted for as boundary evidence.
7. A completed-zero applicable adapter cannot contribute closed-world evidence unless it states the inspected population.

## Decision

**Topology properties are evaluated over an evidence population, not only an edge list.** Discovery records whether the
constructs capable of supplying each property were resolved, unresolved, refused, or not applicable. At minimum the
population distinguishes explicit edges, conditional destinations, entry boundaries, terminal boundaries, and adapter
inputs that were applicable but produced no topology fact.

**Each positive topology clause declares its requirements.** Acyclicity requires every bounded conditional destination to
be resolved or explicitly absent from an inspected applicable population. Reachability requires accounted entry
boundaries and resolved destinations. Fan-out and narrowness require the same destination population that could add an
outgoing relation. A combined strength fires only when every clause's requirements are complete. The finding names the
supporting population and sample size.

An old stored graph with no completeness field remains readable and has unknown completeness. It cannot earn an
absence-based strength under a reader that requires completeness. The completeness field is optional in the version 1
graph document, which is a compatible addition under the document version policy.

**Deterministic router destinations are source facts.** For Python LangGraph, bounded support includes:

- an explicit literal mapping or literal destination list passed to `add_conditional_edges`;
- a named local router with a return annotation containing literal destinations; and
- literal string returns from that named local router.

The adapter unions these facts, retains their own locations, and reports disagreement rather than choosing one. A
configuration-backed loop ceiling is a policy fact attached to the conditional relation when its default and reference
are deterministic. It does not make a cyclic graph acyclic.

Computed strings, imported router bodies outside the inspected module, dynamic maps, runtime `Send` destinations, and
other unresolved forms stay unresolved. Their possible edges are not guessed.

**Boundary sentinels are control facts rather than components.** `START -> node` establishes an entry boundary and
`node -> END` establishes a terminal boundary. The graph keeps the line evidence and completeness contribution without
minting an agent, entrypoint, or relation endpoint for either sentinel. A sentinel cannot pollute component or edge
exercise denominators.

**Runtime contradictions keep their actual basis.** Repeated node execution and router spans can contradict prose saying
no loop behavior occurred. They do not independently prove a particular declared handoff. Strict relation exercise stays
unchanged until runtime evidence names endpoints and an independent trigger.

## Consequences

An incomplete graph can still show every declaration Orchescope resolved. It carries a bounded blind spot beside the map
and loses only positive claims the missing fact could reverse.

Adapter completion and topology completion become separate answers. An adapter may complete after inspecting an
applicable population and find zero declarations; it may also complete without relevant input. Only the first can support
an absence claim, and it must state the population.

The target remains a five-agent LangGraph system. Adding boundary evidence and conditional relations does not add agents.

## What would reverse this

Reopen the decision if a framework's own static semantics cannot provide a bounded distinction between resolved and
unresolved routing, or if property-specific requirements cannot be stated without embedding framework names in the
finding engine. In either case the safe result remains no positive absence-based strength, not a guessed topology.
