# ADR 0008: Federation requires runtime-qualified repository endpoints

- Status: proposed
- Date: 2026-08-22
- Deciders: repository maintainers

## Context

Orchescope scans one repository root into one `SystemGraph`. Its `ComponentIdentity` is
`(kind, namespace, localName)`, where namespace is meaningful only inside that root. Adding a second graph
without qualifying that identity would make equal module paths and local names collide. Treating a workspace
list as the qualifier would avoid the collision but would not show that the listed repositories participated
in one run.

ADR 0007 established a stronger primitive inside one repository. A runtime component may join a declaration
only when the span identifies the canonical repository URL, full clean revision, repository-relative file and,
when available, the executing line. Each field retains the span or resource attribute that supplied it. On the
pinned CrewAI checkout this produced three code-location joins from actual constructor frames, with no
name-only join and no relation join. Repository-qualified source identity therefore identifies an endpoint, but
the CrewAI measurement deliberately says nothing about a relation between repositories.

The pinned acceptance system supplies the missing boundary. The OpenAI Agents JavaScript repository at
`52b2702fc034fb47f79ec50fad173f0e9b068ca6` contains an upstream filesystem example that starts
`@modelcontextprotocol/server-filesystem` over stdio. Its package constraint and lock select release
2026.1.14, whose tag in the independent MCP Servers repository peels to
`3e805376da81c063c2798410906b5fd134334a43`. The client scan reports 668 components and 265 relations.
The filesystem package scan reports 1 implemented MCP server, 14 tools and 14 `provides_tool` relations
across 12 supported files. Both repositories are MIT licensed.

The corpus entry establishes that these checkouts are a legitimate acceptance target. It does not establish
that a particular process, request or span crossed between them. The separately observed facts needed for
that claim are:

1. a successful MCP `tools/call` over the real stdio session;
2. one W3C trace context propagated from the client request to the server handler;
3. a client endpoint carrying source identity for the exact client checkout; and
4. a server endpoint carrying source identity for the exact server checkout.

The MCP semantic conventions are still under development. They provide useful operation and transport names,
but neither a package name nor an MCP server label is a repository identity. W3C trace context proves causal
continuity when a parent is independently injected and extracted. It does not identify source. Conversely,
two valid source coordinates prove which implementations ran but do not prove they communicated. Federation
requires both classes of evidence.

Sources:

- <https://opentelemetry.io/docs/specs/otel/trace/api-propagators/>
- <https://www.w3.org/TR/trace-context/>
- <https://opentelemetry.io/docs/specs/semconv/gen-ai/mcp/>
- <https://modelcontextprotocol.io/specification/2025-06-18/basic/transports>

## Falsifier stated before implementation

This decision is rejected unless a fresh exercise of the exact pinned OpenAI Agents and filesystem server
checkouts produces at least one cross-repository relation whose two endpoints join separately scanned
declarations, with all of these conditions true:

1. The client and server are scanned as two closed `SystemGraph` documents at their own exact canonical
   repository URL and full clean revision. No combined scan supplies either endpoint.
2. The client endpoint joins only from source identity derived from its executing client frame. The server
   endpoint joins only from source identity derived from its executing handler or registration frame, with any
   generated JavaScript mapped uniquely to tracked source in the same revision.
3. The two endpoint identities retain per-field trace provenance. Their matched declarations retain the
   file hashes produced by their independent scans.
4. The relation retains independent evidence of causality from propagated W3C parent context. Endpoint
   attributes, shared names, package compatibility, process ancestry and the corpus workspace list cannot
   supply that relation evidence.
5. The actual `tools/call` succeeds against the real stdio server and the joined server declaration is the
   tool handler that returned the result.
6. Replacing either observed revision with another full hash produces a reported `revision_mismatch` refusal
   and no join for that endpoint or relation.
7. Removing the server repository attributes from the server span produces a reported missing-source refusal.
   The client source, launched child path, workspace list and package lock cannot manufacture the server half.
8. A fixture containing the same module path, kind and local name in two repositories produces two distinct
   qualified identities. An unqualified lookup must not choose between them.
9. A conflicting repository URL or revision, a dirty scanned graph, an untracked source, an ambiguous source
   map, or an endpoint that resolves to more than one declaration produces a named refusal and no weaker
   name-based fallback.
10. Existing single-repository audits, stored version 1 graph and report documents, and the Stage 2 CrewAI
    source joins remain readable and unchanged in meaning.

A hand-written trace fixture is sufficient for the negative cases but cannot satisfy the positive condition.
The positive measurement must execute the upstream client example and the upstream filesystem server code at
the two pinned revisions.

## Decision

**Repository and revision identity carried by the trace remains the accepted pairing design, with propagated
trace context added as a separate relation requirement.** Stage 2 did not falsify the source primitive. It
showed precisely where that primitive stops: source identity can qualify a component endpoint and cannot prove
an edge. The pinned MCP system supplies the independent causal evidence that federation also needs.

Each repository is scanned separately. A graph is eligible for federation only when its provenance carries a
canonical HTTP or HTTPS repository URL, a full 40 character Git revision and `dirty: false`. The coordinate is:

```
(canonical repository URL, full revision)
```

A federated component reference is:

```
(canonical repository URL, full revision, existing ComponentId)
```

The existing `ComponentIdentity`, `ComponentId`, `SystemGraph` and single-repository reconciliation contracts
do not change. The repository coordinate qualifies them rather than being folded into their namespace or
fingerprint. Equal `(kind, namespace, localName)` values in two repositories therefore stay equal as local
identities and distinct as federated identities. A graph's coordinate must agree with its own provenance and
cannot be supplied by a workspace entry.

**Federation is a new version 1 document, not a wider meaning for `SystemGraph` or `ReportBundle`.** A
`FederationReport` contains:

- the eligible repository coordinate and complete `SystemGraph` for each independently scanned root;
- repository-qualified references for every accepted runtime component join;
- repository-qualified endpoints for every accepted cross-repository runtime relation;
- the observed source identity and per-field provenance used at each endpoint;
- the relation provenance, observations, run identifiers and evidence that establish causality; and
- bounded refusals and coverage counts for missing, conflicting, stale or ambiguous identity.

Embedding each graph once preserves declaration evidence, scan coverage and per-location file hashes without
copying components into a flattened graph. Existing stored scans and report bundles remain byte-compatible.
Federation is computed on demand from existing graphs and runtime topologies and is exported as its own
document. It does not add a persistence table or reinterpret an earlier artifact. A future need to retain or
query federation reports would require a separate measured storage decision.

**An endpoint resolves under the ADR 0007 rule inside exactly one eligible graph.** Its observed repository URL
and revision must select that graph, and its file, kind, normalized runtime name and optional line must select
exactly one declared component. The declaration and runtime source remain separate fields in the result. The
runtime coordinate never replaces a declaration location or its hash.

An endpoint is refused when its repository URL or full revision is missing, conflicts across attributes, names
no eligible graph, disagrees with the graph revision, names an untracked source, resolves outside the repository,
maps generated code ambiguously, falls outside the declaration range or selects more than one component. The
refusal names the field and reason. It cannot fall through to runtime name, kind and name, package name, service
name, MCP server label or a workspace path.

**A cross-repository relation requires two resolved endpoints plus independent relation provenance.** The two
qualified endpoints must name different repository coordinates. The relation must come from propagated parent
context or another protocol-native causal input that is independent of the attributes naming its endpoints.
For the pinned stdio system, the accepted input is a W3C `traceparent` injected on the client request and
extracted by the server handler. A matching trace identifier without a valid parent relationship is not enough.
A child process relationship is not enough. A successful result proves the request reached a handler, while the
source coordinates prove which client and handler implementations took part.

The relation keeps its runtime kind and observation rather than pretending that one repository declared an edge
into the other. A static edge inside either embedded graph remains a declaration from that repository. A
federated runtime relation remains an observation. Downstream reporting can display them together without
collapsing their bases.

**Operator input locates work and never becomes observed evidence.** A command or MCP caller may supply the
roots to scan and the runtime workspace from which bounded runs are read. Those paths are control input only.
They do not fill repository URL, revision, source file, component name, trace identifier or parent identifier.
If the trace identifies only one supplied repository, the result contains at most joins inside that one
coordinate and no cross-repository relation.

**The implementation stays bounded.** It accepts a bounded repository count, a bounded recent-run count and the
existing bounded topology and attribute shapes. Repositories are not cloned by the federation use case. Every
root is validated before scanning. Every string reaching JSON, MCP or terminal output passes through the
existing redaction boundary. Federation does not claim that arbitrary trace input or source maps are safe.

## Consequences

**The federated identity is globally unambiguous without changing local identity.** Existing component IDs remain
readable in their graph. A repository coordinate is required only where a reference crosses the graph boundary.

**Pairing stays falsifiable.** An operator can ask to scan any roots, but only a trace that identifies both exact
revisions can pair them. Wrong, missing and conflicting coordinates are visible refusals rather than silent
fallbacks.

**Source and causality remain independent.** This deliberately asks for more than ADR 0007. Valid source on two
spans without propagated context produces two component joins and no cross-repository relation. Valid context
with incomplete source produces an observed crossing that Orchescope cannot join to declarations and therefore
reports as refused.

**Compatibility costs one new document contract.** No `SystemGraph`, `ReportBundle`, trace bundle or persistence
version moves. Schema generation, import validation, CLI JSON and MCP output gain the closed
`FederationReport` version 1 shape. Readers that do not know that new document continue to read every prior
document as before.

**Cost must be measured rather than assumed.** Acceptance records the report bytes for the two pinned graphs,
the packaged tarball byte change, any persistent storage change, and the added static and exercised corpus time.
The decision is not accepted until those numbers are in this record. An unbounded or disproportionate bundle is
evidence to replace embedded graphs with content-addressed graph references in a distinct document version, not
permission to omit graph provenance.

## What the measurement said

No implementation measurement is recorded under a proposed decision. This section is completed only after the
positive pinned run, every negative falsifier and the full repository gates have run.

## What would reverse this

The decision must be rejected if the upstream MCP SDK cannot propagate parent context without modifying either
third-party repository's declared behavior, if a uniquely mapped server source cannot be derived from the
executed build, or if the positive result requires repository facts copied from corpus metadata, command input,
package resolution or component names.

It must be reopened if a real protocol-level interface identity can establish the same pairing without runtime
repository attributes, if canonical URL plus full revision fails to distinguish the pinned repositories, or if
the complete federated report cannot remain within the existing bounded artifact and MCP response limits.

Any implementation that treats the workspace list as evidence, lets one span donate repository attributes to
another, or accepts trace identifier equality without independently propagated parentage falsifies this record.
