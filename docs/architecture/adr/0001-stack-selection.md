# ADR 0001: Implementation stack

- Status: accepted
- Date: 2026-07-24
- Deciders: repository maintainers

## Context

Orchescope has to do seven things at once: read multi language source code well enough to name the
components of an agent system, serve an interactive local browser workspace under a strict content
security policy, receive OpenTelemetry traces from a process the user starts, persist a versioned
graph with its evidence, expose an MCP server, install without a compiler, and stay maintainable by
people who build agent systems.

Six candidate stacks were scored against thirteen weighted criteria in
[stack-evaluation.md](../../research/stack-evaluation.md). Measurements are in
[performance-spikes.md](../../research/performance-spikes.md). Three facts found during the work
changed the shape of the decision:

1. `typescript@7.0.2`, the current release, does not export the classic compiler API.
   `require('typescript').createProgram` is `undefined`, and the package publishes only `./unstable/*`
   subpaths driving a native binary out of process. Type aware TypeScript analysis is therefore either
   pinned to the TypeScript 6 line or built on an API that names itself unstable.
2. `@opentelemetry/sdk-node` sends `application/x-protobuf` by default. A receiver that accepts only
   JSON would require every user to change an environment variable before their existing
   instrumentation reached Orchescope.
3. Node 24 runs TypeScript directly through type stripping, across pnpm workspace links, with no
   flags. A whole workspace type check takes about 113 ms with the native `tsc`. This removes the build
   step from development and from tests.

## Decision

Build Orchescope as a single process TypeScript application on Node.js 24 LTS.

- TypeScript 7.0.2 used as a type checker only, with `--noEmit`, `strict`,
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `erasableSyntaxOnly`.
- Node 24 as the runtime, `engines.node >= 24.0.0`. Source runs directly; the published artifact is
  bundled once with esbuild.
- pnpm workspaces for module boundaries. Internal packages resolve to their source through `exports`,
  so there is no per package build.
- `@sinclair/typebox` for every persisted or exported contract, because the schema is JSON Schema and
  `schemas/` is emitted from it rather than converted.
- `oxc-parser` for JavaScript and TypeScript syntax, `web-tree-sitter` with the vendored
  `tree-sitter-python` WASM grammar for Python. Neither needs a compiler at install time.
- `node:sqlite` for embedded storage, behind a repository layer so that its release candidate status
  is one file of risk rather than a leak through the codebase.
- A hand written OTLP/HTTP receiver on loopback that decodes both `application/json` and
  `application/x-protobuf`.
- `@dagrejs/dagre` for deterministic layered layout in the CLI, with positions stored in the report
  bundle. No layout engine ships to the browser. **Superseded, see the note below.**
- `sigma` with `graphology` for the interactive graph and `preact` for the surrounding shell, both
  built with the same esbuild used for the CLI.
- `@modelcontextprotocol/sdk` over stdio for the agent interface.
- Distribution as one pure JavaScript npm package with no native modules, no platform subpackages and
  no install scripts.

Static discovery in this release is syntactic and module resolution based. There is no type aware
analysis layer, and no port is created for one, because an interface with no implementation is dead
code.

This last point is a deliberate divergence from the research recommendation, which scored a bounded
hybrid highest on the strength of "type aware analysis behind one swappable out of process port". The
port is not built now for two reasons. First, the only available TypeScript backends are an API that
names itself unstable and a pinned previous major line, so the port's shape would be guessed rather
than derived. Second, an unused interface cannot be tested and cannot be trusted. Reopen condition 2
below states the measurement that would justify building it, and the discovery pipeline is structured
so that type derived facts would be additive annotations on a graph that is already complete without
them: components carry a `discoveredBy` list, a `basis` and a `confidence`, and adding a producer does
not change any existing identity.

## Consequences

Accepted:

- Every invocation pays about 50 ms of Node startup that a native binary would not.
- Users must already have Node 24 or newer. The README says so rather than implying a self contained
  binary.
- Discovery cannot resolve a component that only a type checker could see, for example a model client
  reached through an injected interface. Confidence values and the coverage report say what was and
  was not established, and unsupported areas are listed in every scan.
- Orchescope owns its OTLP decoder, including future proto revisions. This cost exists in every
  candidate language except Go.
- Python parsing is roughly three times slower per byte than the TypeScript path, so Python scanning
  depends on bounded concurrency and content hash caching rather than on raw speed.

Gained:

- One language and one type system across the CLI, the report server, the browser workspace, the MCP
  server and the demonstration harness. The report bundle the browser reads is validated by the same
  schema package that produced it.
- No build step for development or tests, which keeps the contribution loop to `pnpm install` and
  `pnpm test`.
- No compiler on the install path, verified by the packaging check in CI.
- The most mature MCP SDK, which is a primary integration surface.

## Reopen conditions

Each condition names the evidence that would justify revisiting, so this decision can be overturned by
measurement rather than by taste.

1. **Native parsing addon.** Cold discovery on a defined corpus misses its budget after content hash
   caching and worker parallelism are in place, and a profile attributes more than half of wall clock
   time to parsing. Adoption additionally requires a measured end to end improvement of at least 2x,
   because a process or ABI boundary can consume the gain.
2. **Type aware analysis layer.** A recall measurement on real repositories shows that syntax plus
   module resolution misses more than about 15 percent of the components or handoff edges that a type
   aware pass recovers. The layer is then added as an optional, budgeted enrichment behind a narrow
   port with three operations, defaulting to off, and the graph must remain complete without it.
3. **Runtime floor.** Node 24 leaves maintenance or a required capability lands only in a later line.
   Move the `engines` floor, not the language.
4. **Single binary distribution.** Node ships a single executable flow that does not depend on
   `postject` and produces an artifact small enough to publish for six targets. Revisit distribution
   only, not the language.

## Alternatives considered

Rust as the primary language, a Rust core with a JSON-RPC boundary to a TypeScript workspace and a
type checking sidecar, Go, Python, C++, and Deno or Bun as the runtime. Scores, reasoning and the
specific evidence that decided each one are in
[stack-evaluation.md](../../research/stack-evaluation.md). The closest call was Rust, which wins on
startup, distribution and store throughput and loses on the one thing the product is for: reading
TypeScript and Python well enough to be believed.

## Superseded in part: graph layout, phase 20

The layered layout was chosen on licence and determinism, and both of those still hold of
`@dagrejs/dagre`. What was never measured was whether a layered layout suits the graphs this product
actually produces, and it does not. Every agent system in the pinned corpus is hub and spoke with a
median degree of one or two, and a layered layout puts every leaf of a hub in one rank:
`openai-agents-python` laid out at 848 by 19050, rendered into a canvas of aspect 2.3.

The layout is now concentric, still deterministic, still computed in the CLI with the positions baked
into the bundle, and it needs no library at all, so the dependency is gone. The same graph lays out at
2997 by 3000. Nothing else in this record changed: `sigma`, `graphology` and `preact` are unaffected,
and no layout engine ships to the browser. The measurements are in
[../../design/report-system.md](../../design/report-system.md).
