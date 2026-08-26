# ADR 0015: The invariant is asymmetric, because a run can be recognised without naming a framework and a repository cannot

- Status: accepted
- Date: 2026-08-26
- Deciders: repository maintainers

## Context

[ADR 0014](0014-layer-three-refusal-and-the-model-call-frame.md) and the
[layer model design](../../research/0.9.3-framework-blind-layer-model.md) state the invariant this
repository has been held to:

    1. Protocol, framework-blind.
    2. Structural, framework-blind.
    3. Bounded refusal.
    4. Framework adapters. Depth only. Never required for correctness.

and the sentence under it: "Layers 1 to 3 are sufficient for correctness. Layer 4 adds resolution."

Three whole-corpus measurements now say that sentence is false, and a fourth says the catalogue it denies
is load-bearing has already decayed with nothing to report it. All four are in
[the measurement record](../../research/0.9.3-protocol-recognition-and-the-second-refusal.md), taken over
all 56 pinned repositories with this repository's own analyzer.

**Layer 1 is not visible in source at all.** The Model Context Protocol defines a wire format and no
source-level API. Across 56 repositories its published method vocabulary appears as an exact literal in
**12 non-test sites in 2 repositories**, and not one of the 21 MCP server constructions the build
recognises carries a protocol-shaped argument: `new McpServer({name, version})` is package metadata and
`FastMCP("Calculator")` is a bare string. The JSON-RPC frame is assembled inside a dependency the traversal
never opens. `packages/instrumentation/src/json-rpc.ts:24-28` sees the protocol because it reads the wire.
The static half has nothing of the kind to read.

**Layer 2 has a measured ceiling and it is low.** 14,666 constructions from distributions no adapter
claims carry no object argument at all, on 50 of 56 entries. 11,453 of them carry no resolvable name, and
5,502 have no arguments whatsoever. **69 sites, 0.47 per cent, resolve to a local object literal under a
maximally permissive resolver**, which is the hard upper bound on every predicate that reads arguments.

**Layer 3 cannot widen to cover the difference.** Over 82 agent-framework declaration sites and 1,782
others, **19 of the 25 structural signatures the framework group occupies are also occupied by data
models, GUI widgets, command-line decorators and type-system declarations, and 72 of the 82 framework
sites sit on a shared signature.** Every candidate that reads names instead of arguments moves the pinned
canaries: 7, 20, 27, 22 and 164 hits for the five families measured, including `express.Router` renamed
`modelsRouter` on the acceptance negative control and four React hooks on the
[ADR 0004](0004-provenance-not-confidence.md) entry.

**And the catalogue the invariant calls optional has already rotted, silently.** Measured against the
corpus rather than read:

| shipped name | site | repositories of 56 it matches |
| --- | --- | --- |
| symbol `Server` | `packages/discovery/src/adapters/mcp.ts:238` | **0** |
| method `setRequestHandler` | `packages/discovery/src/adapters/mcp.ts:391` | **0** |
| method `add_tool` | `packages/discovery/src/adapters/mcp.ts:391` | **0** |
| all eight entries of `LANGUAGE_MARKERS` | `packages/discovery/src/discover.ts:116-125` | **0** |

One third of two shipped MCP name lists and the whole of the language table are dead, and nothing in
`pnpm check`, `pnpm test` or `pnpm corpus` says so. That is the real cost of a name, and it is not the cost
the invariant warns about. A name does not merely fail to cover the framework that has not shipped yet. It
goes quietly wrong about the ones that have.

**The asymmetry that is true.** The runtime half genuinely is framework-blind, and its evidence is that it
already works on frameworks nobody wrote a reader for. `recogniseProtocolCall`
(`packages/instrumentation/src/json-rpc.ts:47`) reads `"jsonrpc":"2.0"` and a method name.
`recogniseModelCall` (`packages/instrumentation/src/model-endpoints.ts`) reads a version-anchored
OpenAI-compatible path shape. `packages/traces/src/attributes.ts` reads the OpenTelemetry generative AI
semantic conventions. None of the three names a library, and every framework that exists or will exist
ends up making an HTTP request whose shape one of them recognises.

So the two halves are not two layers of one thing. They are two different problems with two different
ceilings, and stating one invariant over both is what produced three measurements that had to refute it.

## Falsifier stated before this record was written

Reject this record unless all of these hold.

1. Every claim in the Context above is reproducible from `corpus/.cache` with this repository's own
   analyzer, over all 56 entries and not a sample.
2. The corpus gate reports a shipped recognition name that matches zero pinned repositories. Until that
   check exists, the fourth measurement above is an anecdote about today rather than a property.
3. No wording in this record makes the product claim more than it does. If a reader finishes it believing
   the declared half recognises frameworks nobody wrote a reader for, the record has failed.

## Decision

### 1. The invariant is asymmetric, and is restated

> **What a run exercised is recognised without naming any framework.** Protocol shapes, OpenAI-compatible
> path shapes and the OpenTelemetry generative AI conventions are read from the wire, and a framework this
> build has never heard of is observed exactly as well as one it ships a reader for.
>
> **What a repository declares is recognised in detail only where a reader exists.** That set is a
> catalogue, it decays, and it is maintained rather than derived.
>
> **Everything the declared half cannot name is either named as unread with a source location, or counted
> as unrecorded.** The build never reports a repository as empty because it did not recognise it.
>
> **A name is permitted only where nothing else is there, and it must be measurable.** A recognition name
> that matches no pinned repository is a defect the gate reports, not a harmless spare.

The four numbered layers are kept as a description of where code lives. They stop being a claim about
sufficiency, because they were measured not to be one.

### 2. Recognition is named for what it actually names

The word **framework-blind** is reserved for the runtime half and for the two static readers that carry no
vocabulary at all: the provenance gates, and effects. A static reader that matches a protocol's own name
is **protocol-named**. A static reader that matches a vendor's name is a **framework adapter**. Nothing is
called framework-blind because its vocabulary is short.

This matters concretely for the MCP work landing beside this record. Replacing four vendor distribution
names, three symbol names and four method names with one protocol word plus capability nouns taken from
the specification is a real reduction, measured at 20 of 21 server sites recovered with zero canary
movement, and it is **not** the invariant's fulfilment. It is a name list of size one over a name that
changes when the protocol is renamed, which is a far better decay curve than a list that changes when any
vendor ships an SDK. It is recorded as that and not as more.

### 3. Every recognition name is measured against the corpus, and a dead one is a finding

The corpus harness gains a check over the names the shipped adapters and readers match: each is counted
against the pinned repositories, and a name matching zero of them is reported. This is the mechanism the
fourth measurement above did not have, and without it this record's central claim about decay is
unfalsifiable.

A dead name is reported rather than deleted automatically. A name may be legitimately unmatched, and the
corpus is 56 repositories and not the world. What is not acceptable is that it goes unnoticed for a year,
which is what happened to `Server`, `setRequestHandler`, `add_tool` and the whole of `LANGUAGE_MARKERS`.

### 4. The scaling work is on the runtime half, and it is named

The static half is a catalogue and no predicate makes it otherwise: this has now been measured three times
and the third measurement located the reason rather than the symptom, which is that `build_agent()`
contains no information beyond its name and its distribution.

The change that would make the join framework-independent is not a better static predicate. It is
**source attribution at runtime**: a span carrying the file and line that made the call. ADR 0014 records
the current position, that "auto-instrumentation observes HTTP requests, never function names, so a
source-only enclosing-function identity can never appear in a span". That is true of the shim as built and
is not true of the platforms it runs on. With a call site on the span, the join keys on a location rather
than on a name, and a framework nobody has written a reader for still produces a correct join because the
run says where in the source it happened.

That work is scoped separately and is not decided here. What is decided here is that it, and not a
fourteenth predicate over argument shapes, is where the declared-against-exercised join stops depending on
a catalogue.

## Consequences

**Two research documents and one ADR now describe a superseded claim, and they are annotated rather than
rewritten.** `docs/research/0.9.3-framework-blind-layer-model.md` and ADR 0014 keep their reasoning and
their measurements, which are correct and are the evidence for this record, and each gains a pointer here.
The layer model design already carries an internal correction of the same kind, marked "This paragraph is
wrong, and it is kept because the argument in it is right and the conclusion is not." That is the pattern.

**`docs/architecture/overview.md` gains the invariant** under "Decisions that shape everything else",
because a reader who never opens an ADR should still be told which half of the product scales.

**A widening proposal now has two questions to answer rather than one.** ADR 0004 asks what provenance
keeps it precise. This record adds: which half is it in, and if it is in the declared half, what is its
decay and how will the gate report it.

**The refusal population becomes more load-bearing, not less.** If the catalogue is admitted to be a
catalogue, then the bounded refusal and the unrecorded count are the whole of what the product says about
everything outside it. Their ceilings, measured at
[the second refusal](../../research/0.9.3-protocol-recognition-and-the-second-refusal.md), are therefore
product limits and not implementation details, and they belong in what a reader is told.

**Nothing about component identity, schema documents or the corpus expectations moves.** This record
changes what the repository claims and what the gate checks. It changes no producer.

## What the measurement said

**The two floors that would have made the declared half self-sufficient were built, measured and refused
twice each, by two independent measurements a session apart.** ADR 0014 records the first pair. The second
pair is in the design beside this record, and it went further: it located the reason rather than the
outcome. An argument key is a slot in an interface somebody else declared, so `model=` means the callee
accepts a model. A symbol name, a variable name and a class name are free text an author chose, and
`model`, `tool`, `prompt` and `agent` are among the most overloaded words in software. The shipped stems
are precise because of the position they are matched in, and moving them removes the only thing that makes
them provenance-shaped.

**The proposal to derive the stem vocabulary from the OpenTelemetry conventions was tested and does not
survive.** `packages/traces/src/attributes.ts:17-37` holds nineteen `GEN_AI` constants and contains neither
`llm` nor `instruction`, two of the five stems that ship. A mechanical derivation produces twenty-eight
stems including `name`, `type` and `id`, worth **1,487 new sites on 44 entries with 22 canary hits**. You
cannot claim the vocabulary comes from the standards body and keep the vocabulary you have.

**One name survived measurement and it is the protocol's own.** A construction whose symbol is type-shaped
by the language's own naming convention and whose words carry `mcp`, from a distribution, whose value
receives a registration naming one of the specification's server capability nouns: 19 servers on 8 of 56
entries, zero on all eight canaries, recovering 20 of the 21 sites the vendor allowlist finds. Dropping the
registration requirement gives 139 sites of `McpError` and `McpCapabilities`. Dropping the naming
convention adds two factory functions. The conjunction is what makes it precise, and the single name in it
is the protocol's.

## What would reverse this

**A span carrying the source location that made the call, joined by location rather than by name.** That is
the change this record names as the one that would make the declared half stop being load-bearing for
identity, and if it lands the asymmetry stated here is no longer the right description of the product.

**A static signal that separates an agent declaration from an ordinary library declaration, measured over
the whole corpus.** ADR 0014 asked for it and refused a candidate. This record's measurement refused six
more and located why. A seventh that survives 56 repositories and the eight canaries reopens both records.

**A recognition name matching zero pinned repositories that the gate does not report.** That is decision 3
failing, and with it the only evidence that the catalogue's decay is being watched rather than assumed.

**The runtime half needing a framework name.** If `recogniseModelCall` or `recogniseProtocolCall` ever
requires a vendor vocabulary to stay correct, the asymmetry claimed here is gone in the direction that
matters most, and the product's scaling story has to be made again from scratch.
