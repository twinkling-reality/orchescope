# ADR 0016: A runtime source location proves itself by a revision or by the file's contents, and the two are kept apart

- Status: accepted
- Date: 2026-08-26
- Deciders: repository maintainers
- Amends: [ADR 0007](0007-runtime-source-identity.md)

## Context

[ADR 0007](0007-runtime-source-identity.md) decided that a code-location join requires an observed source
identity rather than a path-shaped string, and that the identity is

    (canonical repository URL, full revision, repository-relative file, executing line when present)

That decision is correct and it is why `code_location` is the strongest rule reconciliation has. What it
also does, measured, is confine the rule to a population almost no audit belongs to.

**The producer it was written for never shipped, and the reason is in the decision.** ADR 0007's own
integration "emits nothing when the checkout is dirty or any identity field is unavailable". The four
producers under `corpus/instrumentation/` follow that rule and `scripts/package.mjs` stages none of them.
Across every traced third-party entry, `code_location` fires three times, all on one federated system, and
thirteen of seventeen joins are `kind_and_name`, which
`packages/schema/src/reconciliation.ts:88-91` calls the weakest and records as having already matched the
wrong module.

**The consuming half enforces the same gate, so relaxing the producer alone changes nothing.**
`packages/graph/src/source-match.ts` refuses with `revision_mismatch` unless
`git.commit === source.revision && git.dirty === false`. A working tree with uncommitted work cannot
produce a `code_location` join however perfect its attributes are, and a working tree with uncommitted work
is what an audit runs against.

**The corpus cannot see any of this, because it manufactures the condition.**
`scripts/corpus/checkout.mjs:69-79` runs `git init`, `remote add origin`, `fetch --depth 1` and
`checkout --force --detach` before every audit. All 55 checkouts under `corpus/.cache` are shallow, detached
and clean, and 54 of 55 pass all four of the prototype's gates. The corpus measures the gates against a tree
nobody edits, so its agreement says nothing about the population the product serves. A larger sample would
not have helped; the population is wrong, not its size.

**What a revision actually proves.** It proves, indirectly and only where the tree is clean, that the file
the run pointed at is the file the declaration was read from. That proposition is the whole requirement.
The digest of the file proves it directly, and a reader can check it with `sha256sum` where a revision has
to be trusted to imply it. The declared half already records one: every `SourceLocation` carries
`fileHash`, stamped at `packages/graph/src/graph-builder.ts:112-116`, whose comment says "The digest is
what makes staleness detectable per file rather than per scan". The evidence existed on one side and had no
counterpart on the other.

ADR 0007 names this reversal itself: reopen "if a real instrumentor can identify the executed declaration
without a repository coordinate".

## Falsifier stated before this record was written

Reject this record unless all of these hold.

1. A repository with no remote and no immutable revision produces a `code_location` join, established by
   the digest, through the real command line.
2. Editing the file after the run refuses that join and reports `digest_mismatch` rather than silently
   matching or silently dropping to a name.
3. The pinned proof is unchanged, and the cross-repository `code_location` joins the corpus already records
   still hold under `pnpm corpus --exercise`.
4. Nothing in the corpus's 48 static expectations moves.
5. A frame inside a dependency under the repository root is never reported as the caller.

## Decision

### 1. Two proofs, named separately, neither standing in for the other

A runtime location may carry either or both of:

- **The pinned proof**, `ObservedSourceIdentity`, unchanged from ADR 0007: a canonical repository URL, a
  forty character revision, a repository-relative path and a line. It survives leaving the workspace that
  produced it.
- **The content proof**, `ObservedContentLocation`: a path relative to the scanned root, the sha256 of the
  file as the run found it, and a line. It is checked against the declaration's own `fileHash`.

They are two fields rather than one widened field. That is deliberate: two repositories can hold a
byte-identical file at one path, so the content proof says nothing outside the workspace that produced it,
and anything that merely checks whether a source is present must not be able to mistake the weaker claim
for the stronger one. **A federated join reads the pinned proof and never the content proof**, which is a
property of the call site rather than a flag: `packages/graph/src/federate.ts` calls `match` and never
`matchContent`.

Because both are optional additions, no document version moves and no migration is needed.

### 2. The line narrows a choice and does not veto the only candidate

ADR 0007 requires a present line to fall inside a declaration's source range. That rule is right for the
producer it was written for, which wrapped a constructor and therefore reported the declaration. **A shim
on the transport reports the call site, which is by construction somewhere else in the file.** Under the
original rule every location such a producer emits would be refused, so the rule would be requiring
corroboration from evidence that structurally cannot corroborate.

The rule becomes: where the line eliminates every candidate it has discriminated nothing, so the file, the
kind and the name decide as they would have if no line had been reported, and `line_outside_declaration`
travels with the match as coverage. Where more than one declaration shares a file, a kind and a name, the
line still chooses among them, which is the ambiguity ADR 0007 was written to break.

### 3. A refused location falls back to the name only when it does not name other code

`packages/graph/src/reconcile.ts` short-circuited to the source path and never fell through, which two
tests assert by name. The reasoning is right for `repository_mismatch` and `revision_mismatch`, and now
`digest_mismatch`: those say the run was about **different code**, and joining that to this checkout's
declaration by name would attribute one repository's execution to another's source.

`source_not_declared` says the opposite: this tree, this file, and no declaration of that kind and name in
it. Refusing the name rules over that would make a span carrying more evidence join to less than the same
span carrying none. It falls back, and the refusal is still recorded.

### 4. A frame belongs to the repository that tracks the file

The shipped producer decides that a frame is the repository's own by asking the repository's index, and by
nothing else. **This replaces a name list rather than adding one**: it excludes `node_modules`, `dist`,
`.venv` and every other derived directory without naming any of them, because a repository has already said
so by ignoring them.

It is also the only test that refuses a false attribution the corpus already contains. For 14 of the 69
directories under `corpus/.cache`, `git rev-parse --show-toplevel` answers the enclosing Orchescope
repository, and three of the prototype's four gates confirm that false identity. `corpus/.cache` is
gitignored, so the index rejects it.

**Containment inside the audit root was tested as the rule and refused.** It loses the corpus's only
`code_location` joins, which span two checkouts at two revisions from one traced run, and it emits the
wrong path shape for a `subpath` entry, where the audit root is a directory inside the git root and the
consumer rebases on the prefix the scan recorded.

### 5. The audit root is passed, never inferred

`ORCHESCOPE_REPOSITORY_ROOT` is set on the traced process and carries the root the audit is of. It is not
`process.cwd()`: a scenario may name any subdirectory as its target's working directory, and `NODE_OPTIONS`
reaches every process the target spawns, so a shim reading the working directory answers for whichever
descendant it loaded into. Absent means no location rather than a guess.

This is the question ADR 0007 warns about when it says a rule needing "the audit working directory ... to
complete the coordinate is evidence against the rule". The audit root does not complete a coordinate here:
the repository is discovered from the frame, and the root supplies only the scan-relative form of a path
the frame itself reported.

## Consequences

**ADR 0007 keeps its reasoning and loses two clauses.** Its identity is now one of two accepted proofs, and
its line rule applies where a line can discriminate. Its measurement, its refusals and its central
decision, that a location is not a path-shaped string, all stand.

**ADR 0014's frame decision is untouched.** A captured call site names where a call was made, not a declared
component that can be reported exercised, so the frame stays outside `OBSERVABLE_KINDS`. ADR 0014's
reversal condition warns against exactly that returning under a name that reads as a fix, and this is not
one.

**ADR 0015's decision 4 is corrected rather than fulfilled.** It says the join would key "on a location
rather than on a name". The matcher keys on file, kind and normalised name together, so a framework nobody
wrote a reader for declares nothing and still produces no join. What source attribution buys is
disambiguation among same-named declarations, and a file and line on the runtime-only components the
catalogue never named. The asymmetry ADR 0015 states is unchanged.

**Two populations are out of reach and are stated in the producer's header.** A built application reports
the build output, and zero of the eleven built corpus packages holding a model call ship a runtime source
map. A framework that streams reaches the transport from its own scheduler with no repository frame at any
bound, in three of eight Node cases measured. A third limit is not a population: this is Node only, and
8 of 56 corpus entries are polyglot.

## What the measurement said

The falsifier's five conditions were met.

A repository with no remote, built for the purpose and driven through the real command line, reports
`byCodeLocation: 1`, `byKindAndName: 0`, `onNameAlone: []`, with `vcs.ref.head.revision` and
`vcs.repository.url.full` both reported missing and `code.line.number` reported
`line_outside_declaration`, so the join is made and every part of the location that did not corroborate is
named. Appending one line to that file and rescanning refuses it with
`orchescope.code.file.digest:digest_mismatch`.

The producer, walking twenty frames through a three-layer dependency reached by a pnpm symlink, reports
`src/orchestrator.mjs` and the function `askTheModel`, never the dependency: the dependency's real path
carries two `node_modules` segments where the path Node was given carried one, and neither is tracked.

`pnpm corpus` reports 48 matched, 0 differing, unchanged. `pnpm corpus --exercise` reports the federated
system matched, so the two cross-repository `code_location` joins survive, and reports four exercised
entries differing. **Those four differ identically on the tree before this change**: the sixteen difference
lines are byte for byte the same, so they are drift already present at `8d4202b` and no expectation was
re-recorded here.

The shim grew from 27,221 to about 38,000 bytes against a 96 KiB ceiling.

## What would reverse this

**A digest that agrees where the files differ.** The whole content proof rests on sha256 over the bytes the
run read and the bytes the scan read. Anything that makes those two reads differ for the same file, a
normalisation, a transform, a partial read, breaks it silently and is a defect rather than a limitation.

**A cost the capture cannot carry.** The producer asks git per new file and hashes each file once. Both are
memoised and bounded, and the bound is a ceiling on work rather than a place to look. If a real run pays
enough for either to change how the target behaves, the default has to come back off.

**The tracked-file test being wrong about a repository's own source.** It is the whole of the rule. A
repository that commits its build output has those files tracked, and a frame in one is reported as the
call site even though the traversal never read it, which is a known hole rather than a surprise.

**A framework name appearing in the producer.** If deciding which frame belongs to the repository ever needs
a vendor's directory or a package name, the asymmetry ADR 0015 states has been given up in the half that
was supposed to be free of it.
