# Performance spikes

Every number below was measured on the machine described under "Environment". Nothing here is quoted
from a vendor benchmark. Commands are given so a reader can reproduce or refute the result.

Numbers marked "spike" were produced by throwaway scripts before the repository existed. The scripts
are not part of the repository; the commands shown reproduce them. Numbers marked "in repo" come from
committed code and can be rerun with the stated command.

## Environment

| Property | Value |
| --- | --- |
| Machine | MacBook Pro, Apple M3 Pro, 12 cores, 18 GiB |
| OS | macOS 26.5.1 (Darwin 25.5.0, arm64) |
| Node.js | 24.15.0 (Homebrew build) |
| pnpm | 10.7.1 |
| Python | 3.14.6 |
| Rust | 1.97.1 |
| clang | Apple clang 17.0.0 |
| sqlite3 CLI | 3.51.0 |

Timing harness: 15 to 25 iterations per command, reporting minimum, median and p95 of wall clock time
measured from a Python parent process with `subprocess.run` and output discarded.

## Process startup

The question that decides whether a managed runtime is acceptable for a CLI.

| Command | min | p50 | p95 |
| --- | --- | --- | --- |
| `node --version` | 17.4 ms | 17.9 ms | 18.9 ms |
| `node -e ''` | 47.1 ms | 48.9 ms | 51.5 ms |
| `node script.mjs` (one `console.log`) | 51.4 ms | 52.6 ms | 54.6 ms |
| `python3 -c pass` | 18.2 ms | 20.2 ms | 21.7 ms |
| `deno eval ''` | 14.0 ms | 15.0 ms | 15.3 ms |
| Rust `clap` CLI, release, stripped | 2.0 ms | 2.2 ms | 2.5 ms |

The Rust binary was built for this comparison only: `cargo build --release` with `lto = true`,
`codegen-units = 1`, `strip = true`, producing a 567,664 byte executable in 8 s wall clock.

Dependency load cost, measured by bundling with esbuild and timing the whole process:

| Entry | p50 |
| --- | --- |
| Zero dependency script | 53.2 ms |
| Bundled CJS with `commander` | 55.8 ms |
| Bundled ESM with `commander` | 61.5 ms |
| Bundled CJS with `commander` + `@sinclair/typebox` + `yaml` | 62.4 ms |
| Bundled CJS with `commander` + `zod@4` + `yaml` | 69.6 ms |
| Unbundled ESM importing `commander`, `ajv`, `zod`, `oxc-parser` | 104.3 ms |

Reading:

- Node bootstrap is about 35 ms of the 53 ms floor, and application code adds single digit
  milliseconds once bundled. Unbundled ESM with several dependencies doubles startup, so the shipped
  artifact is bundled.
- TypeBox costs about 4.7 ms of startup against Zod's 12 ms, on top of producing JSON Schema directly
  rather than through a lossy conversion. This is one input into
  [ADR 0001](../architecture/adr/0001-stack-selection.md).
- Rust would remove about 50 ms per invocation. That is real and it is the strongest argument for a
  native core. It is also small against the multi-second work an audit performs, and it does not
  offset the analysis and UI consequences recorded in the ADR.
- `NODE_COMPILE_CACHE` made no measurable difference to a small bundle (56.9 ms against 55.8 ms,
  inside noise). It is enabled anyway because it does help once the MCP server and parsers are loaded.

## Source parsing throughput

Corpora were cloned at depth 1 for measurement:

```
git clone --depth 1 https://github.com/openai/openai-agents-js.git
git clone --depth 1 https://github.com/openai/openai-agents-python.git
git clone --depth 1 https://github.com/langchain-ai/langgraphjs.git
git clone --depth 1 https://github.com/crewAIInc/crewAI.git
```

TypeScript, on `openai-agents-js` (856 files excluding declaration files, 7.69 MB), single threaded:

| Parser | Time | Throughput |
| --- | --- | --- |
| `oxc-parser` 0.141.0 `parseSync` | 463 ms | 16.6 MB/s |
| `@swc/core` 1.15.46 `parse` | 654 ms | 11.8 MB/s |
| `typescript` 7.0.2 `unstable/ast` | not applicable | no `createSourceFile` export |

Directory traversal of that repository took 32 ms.

Python, on `openai-agents-python` (840 files, 10.91 MB), `web-tree-sitter` 0.26.11 with the
`tree-sitter-python.wasm` grammar that ships inside the `tree-sitter-python` 0.25.0 package:

| Operation | Time | Throughput |
| --- | --- | --- |
| `Parser.init()` | 5 ms | one time |
| `Language.load(wasm)` | 4 ms | one time |
| Parse 840 files | 1898 ms | 5.8 MB/s, zero parse errors |
| Parse plus two captures over 300 files (1.81 MB) | 272 ms | 6.6 MB/s |

Reading: query evaluation is a rounding error next to parsing, and the WASM grammar needs no compiler
at install time. Python parsing is roughly three times slower per byte than `oxc` on TypeScript, which
is why analysis is bounded by concurrency and content hash caching rather than by hope.

## Embedded storage

`node:sqlite` on Node 24.15.0, no flags, no `ExperimentalWarning` emitted:

| Operation | Result |
| --- | --- |
| Bundled SQLite version | 3.53.3 |
| Open a new database file | 0.4 ms |
| Insert 50,000 span rows in one transaction, `STRICT` table, WAL | 234 ms, 214,016 rows/s |
| `GROUP BY component_id` aggregate over 50,000 rows | 139.7 ms |
| Fetch one trace by indexed `trace_id` (100 rows) | 0.2 ms |
| `PRAGMA user_version` read and write | works, used for migrations |
| `json_extract`, FTS5, `PRAGMA integrity_check` | all available |

Reading: no native module and no compiler are needed for storage. The aggregate cost is the reason
per component roll ups are computed once during ingestion and stored, rather than recomputed per
report request.

## Graph construction and layout

In memory graph, 5,000 nodes and 20,000 edges, built as plain maps and arrays:

| Operation | Time |
| --- | --- |
| Build nodes and edges | 26 ms |
| `JSON.stringify` | 7 ms, 1.71 MB |
| SHA-256 of the serialised form | 6 ms |
| `JSON.parse` back | 42 ms |
| Adjacency index plus depth first traversal | 2 ms |

Layered layout with `@dagrejs/dagre` 3.0.0, run twice per size to check determinism:

| Size | Time | Deterministic across runs |
| --- | --- | --- |
| 50 nodes, 50 edges | 14 ms | yes |
| 600 nodes, 600 edges | 122 ms | yes |
| 5,000 nodes, 5,000 edges | 1161 ms | yes |

`elkjs` 0.12.0 was evaluated as the alternative layout engine and rejected: its package metadata
declares `EPL-2.0 OR GPL-3.0-or-later`, which is avoidable licence friction for an Apache-2.0 project
when `@dagrejs/dagre` is MIT, deterministic and fast enough. Layout runs in the CLI and the positions
are stored in the report bundle, so no layout engine ships to the browser.

## Loopback server and process orchestration

| Operation | Result |
| --- | --- |
| `node:http` listen on 127.0.0.1 with port 0 | 6.2 ms |
| First request round trip | 12.5 ms |
| 200 sequential requests | 54 ms |
| 12 concurrent `node` subprocesses, each sleeping 50 ms | 166 ms total, all exit 0 |

Cancelling a child process through `AbortController` works and terminates the child, and it also
emits an `error` event on the child. A `spawn` call that passes a signal without an `error` listener
crashes the parent with `AbortError`. Every process supervisor in this repository therefore attaches
an error handler before it attaches a signal.

## OpenTelemetry ingestion

The receiver design depends on what an unmodified SDK actually sends, so both paths were captured
against a local `node:http` server.

With `OTEL_EXPORTER_OTLP_PROTOCOL=http/json`, `@opentelemetry/sdk-node` 0.221.0 sent one request:

```
POST /v1/traces  content-type: application/json  3321 bytes  no content-encoding
{"resourceSpans":[{"resource":{"attributes":[...]},"scopeSpans":[{"spans":[...]}]}]}
```

Span objects carried `traceId` and `spanId` as lowercase hex strings, `kind` as an integer,
`startTimeUnixNano` and `endTimeUnixNano` as decimal strings, and attributes as
`{"key":"gen_ai.request.model","value":{"stringValue":"gpt-4o-mini"}}`.

With no protocol variable set, the same SDK sent:

```
POST /v1/traces  content-type: application/x-protobuf  1064 bytes  no content-encoding
```

Reading: `http/protobuf` is the SDK default, so a receiver that only accepts JSON would require every
user to change an environment variable before their existing instrumentation reached Orchescope. The
receiver therefore decodes both, and the protobuf decoder is tested against bytes produced by the real
SDK rather than against a fixture written by hand.

`@opentelemetry/semantic-conventions` 0.221.0 exposes 130 generative AI constants under its
`/incubating` entry point and none under the stable entry point, which is consistent with the upstream
status recorded in [ecosystem-analysis.md](ecosystem-analysis.md).

## TypeScript compiler API availability

`typescript@7.0.2` is the current `latest` on the registry. Verified directly:

```
node -e "const ts=require('typescript'); console.log(ts.version, typeof ts.createSourceFile, typeof ts.createProgram)"
7.0.2 undefined undefined
```

Its `exports` map publishes only `./unstable/sync`, `./unstable/async`, `./unstable/ast` and related
subpaths, and it ships platform binaries through 20 `optionalDependencies` such as
`@typescript/typescript-darwin-arm64`. The snapshot API requires `updateSnapshot({ openProjects })`
before `getProject`, and it drives the native binary out of process.

Consequence for Orchescope: type aware TypeScript analysis is available only through an API whose own
subpath says `unstable`, or by pinning the TypeScript 6 line. Discovery in this release is therefore
built on syntax and module resolution, and the type aware layer is deferred with an explicit trigger
condition recorded in [ADR 0001](../architecture/adr/0001-stack-selection.md).

## Toolchain checks

| Check | Command | Result |
| --- | --- | --- |
| Node runs TypeScript across workspace links | `node apps/cli/src/main.ts` | works with no flags |
| Native test runner on `.ts` | `node --test packages/*/test/**/*.test.ts` | works, coverage via `--experimental-test-coverage` |
| Whole workspace type check | `tsc --noEmit` | 113 ms on the probe workspace |
| Strict settings enforced | adding `enum` with `erasableSyntaxOnly` | error TS1294 as expected |
| Bundling workspace sources | `esbuild --bundle --platform=node` | single file runs correctly |

These four results are why the repository has no build step for development or tests, and one bundling
step for the published artifact.
