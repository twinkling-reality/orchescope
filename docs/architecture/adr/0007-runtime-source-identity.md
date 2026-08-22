# ADR 0007: Runtime source identity must name the executed revision and file

- Status: accepted
- Date: 2026-08-22
- Deciders: repository maintainers

## Context

The declared and observed halves of Orchescope have never joined by source location on a pinned run.
Across the eight exercised corpus entries before this decision, `byCodeLocation` is 0 everywhere. They
join 21 components, 20 on a name alone, and 6 relations. Coverage now reports the missing input rather
than leaving that zero silent, but reporting an absent field does not prove that the join works when the
field is present.

`crewai-examples-exercised` is the sharpest acceptance case. Its pinned marketing crew constructs three
agents at three source ranges in
`crews/marketing_strategy/src/marketing_posts/crew.py`. The run reports their roles, but the repository
declares each role in that crew, a copied integration, and an unrelated Instagram crew. Name
reconciliation correctly refuses all three. The audit before this decision reports 155 components, 24
relations, 4 findings, 3 observed runtime-only components, 0 exercised components, 0 exercised relations,
3 ambiguous names, 0 joins of every kind, and `code.file.path` missing for all 3 observed components.

The pinned `openinference-instrumentation-crewai` wrapper has the actual `Agent` object when it creates the
agent span, but emits only the object's role as `graph.node.id`. CrewAI constructs that object by calling
the repository's decorated Python method. At that call, Python exposes the compiled file through
`codeobject.co_filename`, the function's first line through `co_firstlineno`, and the executing line
through the frame. That is runtime evidence about which constructor ran. It is not a lookup from the role
and it does not require reading the source document.

OpenTelemetry semantic conventions 1.44 mark `code.file.path`, `code.function.name`, and
`code.line.number` stable. They recommend a path that identifies the code unit as uniquely as possible,
preferably an absolute path. The VCS registry makes `vcs.repository.url.full` the complete browser URL and
warns that a repository name can collide across forks. It names `vcs.ref.head.revision` as the current
revision. The VCS entity uses the full repository URL as its required identity. These definitions support
a coordinate made from repository, immutable revision, repository-relative path, and line, while also
requiring Orchescope to keep the raw path separate from the shareable form it uses to join.

Sources:

- <https://opentelemetry.io/docs/specs/semconv/registry/attributes/code/>
- <https://opentelemetry.io/docs/specs/semconv/registry/attributes/vcs/>
- <https://opentelemetry.io/docs/specs/semconv/registry/entities/vcs/>
- <https://opentelemetry.io/docs/specs/otel/resource/sdk/>
- <https://docs.python.org/3/reference/datamodel.html#codeobject.co_filename>

## Falsifier stated before implementation

This decision is rejected unless a fresh exercise of the pinned CrewAI repository produces at least one
`code_location` join from the actual agent constructor frame, with all of these conditions true:

1. The span carries the absolute compiled file path and executing line observed by Python, plus the
   canonical Git remote and full `HEAD` revision derived from that file's checkout without a shell.
2. The repository-relative path is derived from that same runtime file and Git root. It is not copied from
   corpus metadata, the audit root, a component name, a package name, a declaration, or the driver's
   working directory.
3. The observed repository and revision agree with the separately scanned graph, the relative path is
   inside that repository, and the executing line falls inside the matched declaration's source range.
4. Each accepted identity field names its own span or resource attribute provenance. No aggregate
   provenance is allowed to hide which input supplied repository, revision, file, line, or function.
5. The three ambiguous CrewAI roles are resolved only where the runtime frames point. A role with the same
   name in either competing file must remain distinct.
6. `joinedOnNameAlone` does not gain any of these components, relation joins do not rise without an
   independent runtime relation, and the general anti-circularity test still rejects a declared relation
   echoed through endpoint attributes.

A unit fixture that writes the coordinate proves parser behavior but does not satisfy this falsifier. The
acceptance measurement is the third-party CrewAI checkout and its installed third-party instrumentor.

## Decision

**A code-location join requires an observed source identity, not a path-shaped string.** The identity is:

```
(canonical repository URL, full revision, repository-relative file, executing line when present)
```

Function is retained as supporting evidence and for diagnostics, but it does not replace a file. A line
is optional in the interchange because upstream instrumentors do not always emit one. When a line is
present, reconciliation must require it to fall within a declaration's source range. A file-only match is
allowed only when repository, revision, kind, normalized name, and file select exactly one declaration.

`vcs.repository.url.full` is the repository coordinate. A name is insufficient because forks collide.
For Git, a code-location join requires a 40 character commit in `vcs.ref.head.revision`; a branch, tag,
`HEAD`, abbreviated hash, or deprecated `vcs.repository.ref.revision` may be retained as reported data but
does not establish immutable identity. The scanned graph records its canonical remote beside its existing
commit. Reconciliation requires both fields to agree before using the location.

**Raw runtime location and shareable join location stay distinct.** `code.file.path` remains the raw field
defined by OpenTelemetry and can be absolute. An instrumentation integration may additionally emit
`orchescope.code.repository.path`, derived from the same runtime frame after validating it against the Git
root discovered from that frame. The trace bundle retains both bounded attributes. The runtime topology
and report carry only the validated repository-relative path, so an exported document does not disclose a
home or container filesystem layout.

Each source field has separate provenance. Span attributes and resource attributes are distinct inputs;
normalization retains bounded resource attributes on every normalized span rather than folding one value
across a run. This prevents two services or repositories in one trace from inheriting the first VCS value
seen. An operator-supplied resource value remains a reported resource attribute. It is not relabelled as an
instrumentor observation, and source matching still has to agree with the independently scanned graph.

**Normalization is a refusal boundary.** The accepted and refused forms are explicit:

- An absolute native path is accepted only with a repository-relative path derived by an instrumentor from
  the same frame, and only when that relative path is normalized, contains no upward traversal, and names a
  file in the scanned graph.
- A `file:` URL is decoded only when it resolves to one absolute native path. Non-file URLs, malformed
  escapes, and hosts that do not have one local interpretation are refused.
- A relative path without a complete repository coordinate and immutable revision is retained as legacy
  code-location data but cannot make the stronger join.
- A container path is not mapped to a host checkout from `container.*`, service name, mount convention, or
  working directory. It requires an independently emitted repository-relative path from the runtime
  instrumentor. Otherwise it is refused.
- A Python module name without `co_filename` does not become a path. A synthetic filename such as
  `<string>`, `<stdin>`, or a non-file loader is refused.
- JavaScript build output joins only when the observed generated location either matches a declaration as
  generated code or a source map resolves it to exactly one source inside the same repository and
  revision. Missing maps, maps outside the repository, multiple sources, and unverifiable map revisions
  are refused.

Refusals are coverage, not absence. Coverage names each missing or unusable attribute with the observed
component sample count. Distinct reasons cover missing repository coordinate, missing immutable revision,
missing file, invalid repository path, repository mismatch, revision mismatch, line outside declaration,
and ambiguous source mapping. A component can contribute to more than one reason, so each count states its
own population rather than implying a partition.

**The smallest CrewAI integration captures an object, not a name.** It wraps the actual `Agent`
construction, records the immediate Python caller frame on that object, resolves the Git root, canonical
remote, clean full revision, and repository-relative path from the frame, then places those fields on the
later third-party span for the same object. It uses argument-array Git processes with bounded output and
timeouts. It emits nothing when the checkout is dirty or any identity field is unavailable. Framework
knowledge stays at this instrumentation boundary; trace normalization and reconciliation remain framework
neutral.

Every displayed refusal and accepted relative location passes through the existing report and CLI
redaction boundary. Absolute paths remain untrusted trace attributes and are never copied into graph source
locations or reconciliation prose.

## Consequences

**A source match is independently falsifiable.** A reader can scan the coordinate and revision the run
reported, verify the path and line against the declaration, and reject a stale or competing repository.
The run is no longer asking a role name to select among three files.

**A path alone becomes weaker than the join formerly named `code_location`.** Existing trace documents
remain readable and keep their reported locations, but incomplete legacy locations do not gain the stronger
meaning. This is a correction to reconciliation behavior rather than a silent default.

**Resource provenance becomes per span.** The trace normalizer can no longer discard all resource
attributes except `service.name`, and topology cannot select the first VCS value across a bundle. The
bounded attribute budget and redaction rules still apply.

**Coverage grows with the evidence contract.** A zero now distinguishes an absent file, an incomplete
repository coordinate, a stale revision, an invalid normalization, and a location that does not select one
declaration.

**Cross-repository work remains a separate decision.** This record proves the identity primitive inside
one scanned repository. It does not authorize a workspace list, federated graph identity, remote cloning,
or a cross-repository edge. ADR 0008 must evaluate those changes against this measurement and a pinned real
multi-repository system.

## What the measurement said

The pinned CrewAI exercise satisfied all six parts of the pre-implementation falsifier. The integration
captured the immediate constructor frames at lines 39, 48 and 57 of
`crews/marketing_strategy/src/marketing_posts/crew.py`. Each span carries the checkout's canonical remote
`https://github.com/crewAIInc/crewAI-examples`, full revision
`da94a91e691e1cf5b3151416bb15b5b62729bea8`, absolute compiled path, repository-relative path, line and
qualified Python function. The exported graph retains the relative path and every field's attribute
provenance and contains no absolute home-directory path.

The clean one-run before and after is:

| measurement | before | after |
| --- | ---: | ---: |
| graph components | 155 | 152 |
| graph relations | 24 | 24 |
| observed components | 3 | 3 |
| runtime-only components | 3 | 0 |
| exercised declared components | 0 of 90 | 3 of 90 |
| code-location joins | 0 | 3 |
| runtime-name joins | 0 | 0 |
| kind-and-name joins | 0 | 0 |
| name-only join identities | 0 | 0 |
| exercised declared relations | 0 of 16 | 0 of 16 |
| ambiguous names | 3 | 0 |
| observed components missing `code.file.path` | 3 | 0 |
| findings | 4 | 3 |

The finding removed is `observed-name-matches-many-declarations`. `declared-not-exercised` moves from 90
components to 87. `observability-coverage` remains and now reports a measured exercise rate of 3 out of 90.
`topology-shape` remains over the same three observed agents because the run still reports no relation. No
component moves onto `joinedOnNameAlone`.

The corpus now records the join rule counts and each missing source attribute rather than only the joined
identities. The other three offline exercised third-party entries still report 0 code-location joins and
name all four missing inputs with a sample of 3 observed components each. The 55 generated negatives hold,
and the anti-circularity tests continue to refuse endpoint attributes while retaining real parent-span
nesting.

## What would reverse this

The decision must be reopened if a real instrumentor can identify the executed declaration without a
repository coordinate, or if repository URL plus full revision cannot distinguish the repositories in the
pinned multi-repository acceptance case. It must also be reopened if preserving resource attributes makes
the trace bundle or package unbounded under the existing ceilings, or if the CrewAI integration can produce
the expected path for an agent object that was not constructed by that frame.

Any normalization rule that needs the audit working directory, corpus metadata, a package name, or a
component name to complete the coordinate is evidence against the rule, not permission to infer the
missing field.
