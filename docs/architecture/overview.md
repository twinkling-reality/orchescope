# Architecture overview

## The shape of it

One command line application, one browser workspace, twenty two library packages, and a demonstration agent system that
exists to be audited. Dependencies point inward and the direction is enforced by `pnpm deps`, not by convention.

```
                 apps/cli        packages/mcp      packages/report-server      apps/web
                     |                 |                     |                   |
                     +--------+--------+---------------------+                   |
                              |                                                  |
                       packages/usecases                                         |
                              |                                                  |
                      packages/workspace                                         |
                              |                                                  |
   +--------------+-----------+-----------+--------------+--------------+        |
 graph        discovery      traces     findings      scenarios      report      |
 comparison   goals          policy     benchmark     chaos          redaction   |
 observability             source-analysis          runtime        persistence   |
   +--------------+-----------+-----------+--------------+--------------+        |
                              |                                                  |
                       packages/domain                                           |
                              |                                                  |
                       packages/schema  <-------------------------------------- types only
```

`apps/demo` sits outside this graph entirely: it imports nothing from the workspace, because it is an audit target rather
than a component.

## The data flow

```
repository ──► file set ──► language facts ──► adapter drafts ──► system graph (static)
                                                                        │
your process ──► OTLP spans ──► normalized spans ──► runtime topology ───┤
                                                                        ▼
                                                                  reconciliation
                                                                        │
                                        ┌───────────────────────────────┼───────────────┐
                                        ▼                               ▼               ▼
                                  findings                       report bundle       goals
                                        │                               │               │
                              scenario, benchmark, chaos ──► runs ──► comparison ──► verdict
```

Every arrow crosses a package boundary, every artefact in the diagram is a versioned document with a JSON Schema under
`schemas/`, and each step records evidence rather than only a result.

## Decisions that shape everything else

**Identity is not a location.** A component is identified by `(kind, namespace, local name)`, where the namespace is a
module path without its extension, a configuration file path, `manifest`, or `runtime`. An edit that moves a definition
down a file does not change its identity, so a finding survives a refactor and two scans can be compared. Line numbers
are recorded as evidence, never as identity. See [system-graph.md](system-graph.md).

**Two graphs, one join.** The static graph and the runtime topology are built independently and joined by an explicit
sequence of match rules, strongest first: a shared code location, then a runtime name declared in a manifest, then kind
and name, then a bare name when the runtime qualifies it with a namespace. A match that could go two ways is recorded as
ambiguous rather than guessed. See [runtime-observation.md](runtime-observation.md).

**Evidence is a first class document.** Ten kinds of evidence exist, each with a producer, a basis and enough detail to
return to the source: a source span, a configuration entry, a trace span, a span event, a metric sample, a fault
injection, a derived record citing its inputs, and so on. A finding cites evidence identifiers; a report resolves them.

**Severity is capped by what supports it.** A rule proposes a severity; the engine reduces it to what the basis and the
confidence can carry. An inference cannot produce a critical finding. The cap is recorded on the finding so a reader can
see it happened.

**Deterministic before clever.** Parsing, graph construction, layout, reconciliation, rule evaluation and report
generation are pure functions of their inputs. The same repository at the same revision produces the same identifiers,
the same layout coordinates and the same report content. Randomness comes from a seeded generator and time from an
injected clock.

**Refusal over downgrade.** Policy decisions are pure functions returning either an allowance or a refusal that names the
setting. No subsystem decides for itself, and nothing runs in a weaker mode while reporting as though it ran in the
stronger one.

## Runtime model

- **No global mutable state.** Every subsystem takes its clock, its randomness, its logger, its progress reporter and its
  policy as arguments. The workspace object is the composition root.
- **Deadlines, not timeouts scattered around.** A deadline is created once per command and threaded through. Long
  operations check it and stop cooperatively.
- **Bounded everything.** Concurrency, spans per run, attribute size, request size, retries, run count, cost and duration
  all have ceilings that come from configuration.
- **Cancellation is a first class path.** Ctrl+C stops the current phase, closes the store, and exits `130`. A partially
  written store is a bug, not an accepted outcome.
- **No shell, ever.** Processes are started with an argument array through `spawn` or `execFile`, and the executable is
  checked against an allow list first.

## Storage

SQLite through `node:sqlite`, so there is no native dependency and no compiler at install time. The database holds the
columns worth querying; large documents (graphs, trace bundles, report bundles) live in a content addressed artifact store
next to it, referenced by digest. The schema version lives in `PRAGMA user_version`, migrations are forward only, and a
database written by a newer build is refused rather than read.

State lives in `.orchescope/state/` inside the audited repository. Configuration lives in `.orchescope/config.json` and is
meant to be committed; state is not.

## The edges

- **Command line** (`apps/cli`): commander, a calm phase oriented progress display, stable exit codes, and a single JSON
  document per command when `--json` is passed.
- **Agent interface** (`packages/mcp`): the same use cases over the Model Context Protocol, with bounded output, explicit
  schemas, and read only tools annotated as such.
- **Report server** (`packages/report-server`): loopback only, capability token exchanged for a same site cookie, a Host
  allow list, Fetch metadata checks, and a strict content security policy with no inline script.
- **Browser workspace** (`apps/web`): preact, sigma for the map, two self hosted type faces, and no dependency on any
  Orchescope package other than the schema types. It reads a bundle; it cannot reach the store. What it is assembled from
  is recorded in [../design/report-system.md](../design/report-system.md).

## Where to look next

- [module-boundaries.md](module-boundaries.md) for what each package owns.
- [discovery-lifecycle.md](discovery-lifecycle.md) for how a file becomes a component.
- [finding-lifecycle.md](finding-lifecycle.md) for how a rule becomes a finding.
- [goal-lifecycle.md](goal-lifecycle.md) for how a finding becomes a verified change.
- [adr/0001-stack-selection.md](adr/0001-stack-selection.md) for why TypeScript on Node rather than Rust or a hybrid.
