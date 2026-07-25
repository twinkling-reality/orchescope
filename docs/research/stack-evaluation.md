# Stack evaluation

This document records how the implementation stack was chosen. The decision itself, in short form, is
[ADR 0001](../architecture/adr/0001-stack-selection.md). Measurements referenced here are in
[performance-spikes.md](performance-spikes.md).

## What the product requires

The requirements that actually constrain the choice, in the order they constrain it:

1. Read real source code in more than one language and recover agent components, tool registrations,
   model call sites, MCP configuration, prompts, retries and side effects, with stable identities.
2. Serve an interactive browser workspace from loopback, offline, under a strict content security
   policy.
3. Receive OpenTelemetry traces from a process the user starts, without asking the user to change
   their instrumentation.
4. Persist a versioned graph, traces, findings and goals in embedded storage.
5. Expose an MCP server so a coding agent can drive the tool.
6. Install with `npm install -g` or `npx`, with no compiler, and keep working offline afterwards.
7. Be maintainable by contributors who work on agent systems.

Requirement 1 and requirement 2 pull in opposite directions for any non JavaScript core, because the
browser workspace is TypeScript no matter what the core is written in, and the highest fidelity
analysis available for the TypeScript ecosystem is written in TypeScript or driven from it.

## Decision weights

Weights were fixed before scoring. They sum to 100.

| Weight | Criterion | Why it carries this weight |
| --- | --- | --- |
| 16 | Multi language static analysis fidelity | The product's core claim is a graph derived from real code. A weak analyser makes a wrong report, which is worse than a slow one. |
| 12 | Browser workspace integration | The report is a first class surface, and it is TypeScript in every candidate. Sharing one type system with the core removes a whole class of drift. |
| 11 | Install with no compiler, offline | Stated product requirement. A tool that fails at `npm install` on a locked down machine has no users. |
| 9 | OTLP ingestion | Runtime evidence is half the value. Whatever ships must decode what unmodified SDKs send. |
| 8 | Embedded storage | Needed everywhere, and a native module here undermines the install requirement. |
| 8 | MCP support | The agent facing interface is a primary integration point, so SDK maturity matters. |
| 7 | Cross platform packaging and release | Three platforms, no signing infrastructure, one maintainer at the start. |
| 6 | Type safety and error handling | Large domain model with many invariants. |
| 6 | Long running orchestration, concurrency, cancellation | Scenario, benchmark and chaos runs supervise child processes with deadlines. |
| 5 | CLI startup | The CLI is invoked repeatedly, including by agents over MCP. |
| 5 | Testing, property testing, fuzzing | Untrusted parsers and imported artifacts need adversarial tests. |
| 4 | Contributor accessibility | An open source tool for developers needs outside contribution. |
| 3 | Supply chain risk | Fewer and better understood dependencies. |

## Candidates and scores

Scores are 1 to 5, where 5 means the option meets the criterion with no engineering debt and 1 means it
does not meet it at all. Each cell has a one line justification below the table.

| Criterion | Weight | TypeScript on Node 24 | Rust | Go | Python 3.14 | C++ | Rust core + TS UI + type sidecar |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Static analysis fidelity | 16 | 5 | 2 | 2 | 3 | 1 | 4 |
| Browser workspace integration | 12 | 5 | 2 | 2 | 2 | 1 | 3 |
| Install with no compiler | 11 | 5 | 4 | 4 | 3 | 1 | 3 |
| OTLP ingestion | 9 | 3 | 3 | 5 | 3 | 2 | 3 |
| Embedded storage | 8 | 5 | 5 | 4 | 4 | 3 | 5 |
| MCP support | 8 | 5 | 3 | 2 | 4 | 1 | 4 |
| Packaging and release | 7 | 5 | 3 | 4 | 3 | 1 | 2 |
| Type safety and errors | 6 | 4 | 5 | 3 | 2 | 2 | 5 |
| Orchestration and cancellation | 6 | 4 | 5 | 5 | 3 | 3 | 5 |
| CLI startup | 5 | 2 | 5 | 5 | 3 | 5 | 5 |
| Testing and fuzzing | 5 | 4 | 5 | 4 | 4 | 3 | 5 |
| Contributor accessibility | 4 | 5 | 3 | 4 | 5 | 2 | 3 |
| Supply chain risk | 3 | 3 | 3 | 4 | 3 | 3 | 2 |
| **Weighted total** | **100** | **4.42** | **3.34** | **3.32** | **3.06** | **1.79** | **3.66** |

### Static analysis fidelity

TypeScript scores 5 because `oxc-parser` parses the TypeScript and JavaScript corpus at a measured
16.6 MB/s with full syntax coverage, `web-tree-sitter` parses Python at a measured 5.8 MB/s with zero
parse errors on an 840 file corpus, and the option to reach type information later exists in the same
process. Rust and Go score 2 because neither has a usable type checker for TypeScript: the oxc project
does not implement one, and the only serious Rust attempt, `dudykr/stc`, has been archived since
January 2024, so both routes end at a sidecar. Python scores 3 because its own AST is first class but
its TypeScript story is not. C++ scores 1 because it has no ecosystem for either language.

### Browser workspace integration

The report is TypeScript in all six columns. Only a TypeScript core lets the CLI and the browser share
one set of contract types with no serialisation boundary and no code generation step, which is why the
report bundle in this repository is typed by the same `@orchescope/schema` package that validates it.

### Install with no compiler

TypeScript scores 5: `node:sqlite` is built into Node 24, `oxc-parser` ships prebuilt platform
bindings plus a WASI fallback, and `web-tree-sitter` ships a WASM module with no install script. Rust
and Go score 4 because prebuilt binaries per platform solve the user side but require a release matrix
and, verified in the research, cross compilation is blocked by C dependencies such as bundled SQLite
and tree-sitter grammars, so native runners or container based cross builds are mandatory. Python
scores 3 because the user must already have a compatible interpreter and virtual environment.

### OTLP ingestion

Go scores 5 because the OpenTelemetry Collector is written in Go and receiver packages exist there.
TypeScript, Rust and Python score 3: verified locally, `@opentelemetry/otlp-transformer` provides
serialisation for exporters and no receiver, so the endpoint is hand written in all three, and it must
decode `application/x-protobuf` because that is what the SDK sends by default.

### MCP support

`@modelcontextprotocol/sdk` is the official TypeScript SDK and the most downloaded package in the
whole survey. The Rust SDK exists and moves fast, with major versions in March, June and July 2026,
which is a maintenance cost on a primary integration surface.

### CLI startup

Measured: 2.2 ms for a Rust `clap` binary against 55.8 ms for a bundled Node CLI. TypeScript scores 2
and pays a real cost here. It is weighted at 5 because an audit of a real repository takes seconds, so
50 ms is under one percent of the operation a user waits for, and the MCP server amortises startup
across a session.

## Options that were rejected, and why

**Rust as the primary language.** The strongest case against the chosen stack, and the research dive
that examined it favoured Rust. It wins decisively on startup, single file distribution and store
throughput. It was rejected because the product's differentiating work is source analysis of
TypeScript and Python, and in Rust that means a sidecar in another language for type awareness plus a
TypeScript browser workspace, which is a three language repository before the first feature ships. The
same dive said so plainly: "the biggest weakness of my own recommendation is that it makes the
differentiating analysis feature the one thing living outside the primary language."

**Rust core with a JSON-RPC boundary to a TypeScript UI and a type sidecar.** Scored second. Rejected
for a first release because it owns a protocol boundary before there is evidence that any boundary is
needed. Prisma removed exactly this architecture and published a 3.4x query improvement and a bundle
reduction from about 14 MB to 1.6 MB after moving its engine into TypeScript and WASM, citing cross
language serialisation and per platform binary distribution as the reasons.

**Go.** Excellent at process orchestration, cross compilation and OTLP, and it has no mature library
for TypeScript or Python semantic analysis, no first party MCP SDK at the time of the survey, and it
still leaves the browser workspace in TypeScript.

**Python.** Best in class for its own AST, weakest for TypeScript, and it puts an interpreter and a
virtual environment between the user and `npx`.

**C++.** No credible ecosystem for any of the seven requirements. Recorded for completeness.

**Deno and Bun as the runtime.** Deno 2.9 is installed on the development machine and starts faster
than Node, and both offer single file compilation. Rejected because coding agents install tools with
`npm` and `npx`, and `node:sqlite`, the MCP SDK and the npm publishing path all assume Node.

## Selected stack

| Layer | Choice | Note |
| --- | --- | --- |
| Language | TypeScript 7.0.2 in `--noEmit` mode | Strict, `erasableSyntaxOnly`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` |
| Runtime | Node.js 24 LTS, `engines.node >=24.0.0` | Runs `.ts` directly through type stripping, so there is no build step for development or tests |
| Package manager | pnpm 10 workspaces | Internal packages resolve to source through `exports` |
| Build | esbuild 0.28 | One bundler for the CLI and for the browser workspace |
| Contracts and validation | `@sinclair/typebox` 0.34 | Schemas are JSON Schema, so `schemas/` is emitted rather than converted |
| JavaScript and TypeScript analysis | `oxc-parser` 0.141 | Measured 16.6 MB/s, prebuilt bindings, WASI fallback |
| Python analysis | `web-tree-sitter` 0.26 with `tree-sitter-python` 0.25 WASM grammar | Measured 5.8 MB/s, no compiler at install |
| Storage | `node:sqlite` | SQLite 3.53.3 in the local build, WAL, `STRICT` tables, `user_version` migrations |
| Runtime ingestion | Hand written OTLP/HTTP receiver on loopback | Accepts `application/json` and `application/x-protobuf` |
| Graph layout | `@dagrejs/dagre` 3.0 in the CLI | MIT, deterministic across runs, positions baked into the report |
| Browser rendering | `sigma` 3.0 with `graphology` 0.26, `preact` 10.29 for the shell | WebGL canvas for the graph, accessible DOM table for the same data |
| Agent interface | `@modelcontextprotocol/sdk` 1.29 | Official SDK, stdio transport |
| CLI parsing | `commander` 15 | Bundled, adds about 3 ms to startup |
| Scenario files | `yaml` 2 | No code execution, comments and anchors preserved |
| Tests | `node:test` with `--experimental-test-coverage`, Playwright for the browser | No test framework dependency on the Node side |
| Lint and format | Biome 2.5 | One tool, includes cognitive complexity limits |
| Boundaries | dependency-cruiser 18 | Layering and cycles enforced in CI |
| Dead code | knip 6 | Unused files, exports and dependencies |

## What this choice gives up

- About 50 ms of process startup on every invocation against a native binary.
- Single file distribution. Users must already have Node 24 or newer. This is stated in the README
  rather than hidden.
- Type aware TypeScript analysis in the first release. Discovery is syntactic and module resolution
  based, which is honest about what it can and cannot see, and the deferral has a written trigger
  condition in ADR 0001.
- Python analysis throughput. WASM parsing is roughly three times slower per byte than the native
  TypeScript path, so Python scanning depends on bounded concurrency and content hash caching.
- Ownership of the OTLP decoder, including future proto revisions. This cost is the same in Rust and
  in Python, and it is the price of not requiring users to run a collector.

## Conditions that should reopen the decision

1. Measured cold discovery on a defined corpus exceeds its budget after content hash caching and
   worker parallelism are already in place, and profiling attributes more than half of wall clock time
   to parsing. Then evaluate a native parsing addon, and require an end to end win of at least 2x
   before adopting it.
2. Recall measurement shows that syntax plus module resolution misses more than about 15 percent of
   components or handoff edges that a type aware pass recovers on real repositories. Then add the type
   aware layer behind the port described in ADR 0001.
3. Node 24 leaves maintenance, or a required capability lands only in a later line. Then move the
   `engines` floor rather than the language.
