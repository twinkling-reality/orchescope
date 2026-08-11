# Module boundaries

Each package owns one responsibility and states what it may depend on. `pnpm deps` fails the build when a dependency
points the wrong way, so this document describes rules that are enforced rather than intentions.

## The layers

| Layer | Packages | May depend on |
| --- | --- | --- |
| Contracts | `schema` | nothing |
| Domain | `domain` | `schema`, and `node:crypto` alone among platform APIs |
| Core | `graph`, `discovery`, `traces`, `findings`, `scenarios`, `benchmark`, `chaos`, `comparison`, `goals`, `report`, `policy`, `redaction`, `observability`, `source-analysis`, `runtime` | `schema`, `domain`, other core packages |
| Adapters | `persistence` | `schema`, `domain` |
| Assembly | `workspace`, `usecases` | everything below |
| Edges | `apps/cli`, `packages/mcp` | `usecases` and `workspace`; never storage directly |
| Target | `apps/demo` | nothing in the workspace |

## What each package owns

**`schema`** Versioned data contracts. Every persisted document is defined here once, as a TypeBox schema that yields both
the TypeScript type and the JSON Schema emitted to `schemas/`. It imports nothing, touches no platform API, and contains
no logic beyond validation helpers. A change here is a change to a published contract.

**`domain`** Identity, invariants, canonical serialisation, hashing, severity policy, statistics, deadlines, bounded
parallelism, cost arithmetic and the error taxonomy. Pure functions over schema types. It may reach `node:crypto` for
hashing and nothing else: no filesystem, no clock, no environment, no network.

**`graph`** Building the system graph from drafts, minting identifiers once at build time, asserting invariants,
reconciling the static graph against runtime topologies, computing the four deltas, indexing for lookup, analysing entry
points and cycles, and diffing two graphs.

**`source-analysis`** Repository traversal with limits and skip reasons, content addressed file reading with a cache, and
one fact extractor per language: `oxc-parser` for JavaScript and TypeScript, tree-sitter for Python. It produces
language neutral facts (imports, calls, definitions, texts, control flow, environment reads) and knows nothing about
agents.

**`discovery`** Turning facts into component and edge drafts. One adapter per ecosystem, each declaring what it applies to
and reporting what it found, plus adapters for effects, prompts, MCP configuration and the manifest. Adapters never touch
the filesystem or run code.

**`traces`** OTLP decoding for both protobuf and JSON, span normalisation with attribute limits, and derivation of the
runtime topology: components, relations, self time, parallelism, retries and side effects.

**`runtime`** The loopback OTLP receiver, supervised process execution with an allow list and no shell, and the fault
proxy. This is the only package that starts a process or opens a listening socket for a target.

**`persistence`** SQLite through `node:sqlite`, forward only migrations, and a content addressed artifact store. Composed
from repositories by aggregate: projects, scans, runs, findings, goals, scenarios, experiments, reports.

**`policy`** Every allow or refuse decision, as pure functions over configuration. A refusal names the setting that would
grant the action. No subsystem decides for itself.

**`redaction`** Secret detection and redaction, applied to every string that leaves the process. Preserves the shape of
what it removed and never reports that nothing was found.

**`observability`** Progress events and structured logging for Orchescope itself, redacted on the way out.

**`findings`** Rules, the evaluation engine, severity capping, evidence requirements, attribution of a finding to
components, and review of anything a model proposed.

**`scenarios`** Scenario parsing and loading, the environment contract handed to a target, deterministic evaluators, and
repeated execution with per repetition results.

**`benchmark`** One dimension at a time, warmup exclusion, quantiles withheld below sample thresholds, and limitations
attached to every report.

**`chaos`** The bounded fault set, one plan per fault so an outcome is attributable, and the measurements that make a
resilience claim: completion, recovery, duplicated effects, retry and cost amplification, intervention.

**`comparison`** Baseline against candidate for runs, graphs and findings, with per metric direction, sample sizes and a
verdict that refuses to call a latency win an improvement when success declined.

**`goals`** A finding becomes a bounded goal: scope, acceptance criteria, validation commands, rollback. Also renders the
prompt handed to an implementer and judges a goal against a comparison.

**`report`** Assembling the report bundle, deterministic graph layout, overlays, and exports to Mermaid and SARIF.

**`workspace`** Resolving paths, loading and validating typed configuration, reading git facts, and constructing the
store, the redactor, the logger and the progress reporter. The composition root.

**`usecases`** The application services each command calls: audit, trace, scenario, benchmark, chaos, compare, goal,
doctor, capabilities. This is where policy checks, persistence and progress are wired together.

**`mcp`** The agent facing surface: one handler per advertised tool, argument validation against the same schema the tool
advertises, and bounded output.

**`testkit`** Deterministic builders and temporary workspaces, used by tests only and never shipped.

## Rules the tooling enforces

- `packages/schema` imports nothing from the workspace and no platform API.
- `packages/domain` imports only `packages/schema` and `node:crypto`.
- No core package imports `persistence`, `workspace`, `usecases` or `mcp`.
- No package imports an app.
- `apps/demo` imports nothing from the workspace.
- `apps/cli` reaches storage through `workspace` and `usecases`, never directly.
- No cycles anywhere.
- No orphan modules: every source file is reachable from a package entry point.
- No runtime source imports a development dependency.

## Rules that are conventions

These are not machine checked, and a reviewer should hold them:

- No `utils`, `helpers`, `common`, `misc`, `shared` or `manager` module. A name that describes where code sits rather than
  what it does becomes a dumping ground.
- One concept per file, named for the domain responsibility it holds.
- No business logic in a rendering path. A terminal summary or a browser component formats what it is given.
- No environment reads and no logging inside the domain layer.
