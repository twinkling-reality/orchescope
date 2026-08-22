# ADR 0009: Manifest citations pin the source they describe

- Status: accepted
- Date: 2026-08-22
- Deciders: repository maintainers

## Context

A manifest is a declaration written outside the source it describes. Its `definedIn` and
`definedAtLine` fields can point to source in a language Orchescope does not parse, which is the main
reason the manifest exists. The reader already refutes a missing file, an impossible line, an
interpolated runtime name, an unresolved edge endpoint and kind-specific details that disagree with the
component kind. It cannot answer two adjacent questions:

1. Does the cited line contain the component name or its runtime name?
2. Is the cited file the same revision the manifest author inspected?

The first requires the exact line text. The second requires a digest supplied by the author and a digest
of the bytes read by the scan. An adapter receives facts and never opens a file, so filesystem access
cannot be added to the manifest adapter to close either gap.

Adding an optional digest to manifest version 2 would not be compatible in meaning. An otherwise
identical version 2 declaration would start passing or failing based on whether a new build happened to
verify the field, while an older reader would silently discard it. A source citation also has no honest
partial form: a path without a line is not a location, and a path and line without the write-time digest
cannot establish which file revision was cited.

## Decision

**Manifest document version 3 makes a source citation an all-or-nothing triple.** A component either
omits source citation fields, or supplies all of:

- `definedIn`, a repository-relative path;
- `definedAtLine`, a one-based line number;
- `definedFileHash`, the lowercase SHA-256 of the file bytes the author inspected.

Version 1 and version 2 retain separate closed schemas and readers. Their documents gain no
`definedFileHash` field and no line-content or write-time digest meaning.

**Discovery reads only files cited by a version 3 manifest.** The set is bounded by the version 3
component limit, every requested path must be one the repository traversal walked, each path is resolved
inside the repository root, and the existing per-file byte ceiling applies. The reader records the raw
byte digest and only the requested lines. Binary data, invalid UTF-8, a path outside the root, a file over
the ceiling and a file that cannot be read produce controlled refusal facts. The manifest adapter remains
a pure consumer of those facts.

**A version 3 citation is usable only when both checks hold.** The scanned digest must equal
`definedFileHash`, and the cited line must contain the component `name` or its `runtimeName` exactly. A
failed check makes the adapter run fail with the component and path named. The component's other valid
manifest facts remain declared, but the refuted source location is not added to the graph. A stale
location therefore cannot be presented as belonging to the scanned revision.

The verified scan digest, rather than the manifest's untrusted copy, becomes the `fileHash` on the graph
source location and its evidence.

## Consequences

**A manifest can be checked against an unsupported source language without teaching the parser that
language.** Verification needs UTF-8 line boundaries and exact bytes, not syntax or a model.

**Editing a cited file makes the declaration visibly stale.** The author must inspect the source again
and update the digest. Moving a name away from the cited line also fails even when the digest was updated.

**Unlocated components remain useful.** A manifest can still declare a component whose source has no
stable file location. It carries manifest evidence and no source location rather than an invented one.

**The scan does bounded extra input work.** Only unique files named by version 3 citations are read, each
under the same byte ceiling as source analysis. The resulting snapshots are scan-local and are not
persisted as another source copy.

## What the measurement said

The demonstration manifest advances to version 3 with 18 citations across 11 unique source files and
43,335 source bytes. Every cited line contains the component name or runtime name, every author-recorded
digest matches the independently scanned bytes, and the manifest adapter completes with 18 components and
20 relations. The graph locations carry the scanned digests.

Adding the 18 digest fields grows that manifest from 7,568 to 9,116 bytes, an increase of 1,548 bytes or
20.5%. Ten audits of identical copied repositories measured version 2 discovery at 37.0ms mean and 37ms
median. Version 3 measured 38.4ms mean and 38ms median, an increase of 1.4ms mean and 1ms median for the 11
bounded reads.

The negative cases each hold independently. Changing the file after recording its digest reports the
citation as stale and leaves its source location out of the graph. Updating the digest while pointing at a
line with neither accepted name reports the line claim. Partial citation triples fail schema validation.
Escaped symlinks, oversized input, binary bytes and invalid UTF-8 produce bounded refusal facts, and version
2 still accepts its established path and line shape without applying either version 3 check.

## What would reverse this

The decision is false if any of these cases does not hold:

1. A version 3 citation with the exact file digest and a line containing the component name or runtime
   name completes and writes the scan's digest onto the graph source location.
2. Changing the cited file after the digest was recorded fails the manifest adapter, reports the
   declaration as stale, and leaves the refuted source location out of the graph.
3. Updating the digest while citing a line containing neither accepted name fails independently of the
   digest check.
4. A version 3 component cannot supply only part of the citation triple.
5. Version 1 and version 2 documents remain readable under their own closed shapes and do not acquire the
   version 3 line-content or digest checks.
6. A citation outside the walked repository, a symlink escaping the root, a binary file, invalid UTF-8 or
   a file over the configured byte ceiling reaches neither line verification nor a graph location.

The decision should be reopened if source citations move into a separately signed declaration artifact.
In that design the signature and artifact digest may replace per-file author-supplied hashes, but only if
the reader can still bind every cited line to the exact repository bytes it reports.
