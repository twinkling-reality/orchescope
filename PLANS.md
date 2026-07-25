# PLANS.md

The plan of record. Kept in sync with the repository: a phase is marked done when its acceptance evidence exists, not when
the code was written.

## The thesis

The defensible centre is the **join** between what a repository declares and what a run exercises, pinned to a revision, plus
the **loop** that turns a finding into a bounded goal whose outcome is verified by rerunning the same scenario. Everything
else exists to make that join accurate or that loop trustworthy. A change that serves neither probably belongs in a different
tool.

## Status

| Phase | State | Evidence |
| --- | --- | --- |
| 1. Research and stack selection | done | `docs/research/`, `docs/architecture/adr/0001-stack-selection.md` |
| 2. Contracts and domain core | done | `packages/schema`, `packages/domain`, twelve documents under `schemas/` |
| 3. Source analysis and discovery | done | `pnpm --silent orchescope --cwd apps/demo audit`, adapter fixtures per ecosystem |
| 4. Graph, identity, invariants | done | `packages/graph/test/graph.test.ts`, 23 tests |
| 5. Runtime observation and reconciliation | done | `packages/traces/test/traces.test.ts`, the delta in the demo audit |
| 6. Findings and severity policy | done | 23 rules evaluated against the demo, severity capping tested, `packages/findings/test/static-rules.test.ts` |
| 7. Storage and versioned schemas | done | `packages/persistence/test/store.test.ts`, migration and refusal tests |
| 8. Scenarios, benchmarks, chaos | done | `pnpm orchescope --cwd apps/demo chaos --scenario support-desk-faults` |
| 9. Comparison and the goal loop | done | `tests/e2e/improvement-loop.test.ts` |
| 10. Command line surface | done | `tests/e2e/cli-contract.test.ts`, 25 tests |
| 11. Report bundle and browser workspace | done | `tests/ui/workspace.spec.ts`, 10 tests in Chromium |
| 12. Agent interface | done | `packages/mcp/test/contract.test.ts`, 15 tests |
| 13. Security controls | done | `packages/report-server/test/server.test.ts`, `packages/redaction/test/redact.test.ts` |
| 14. Packaging and distribution | done | `pnpm package`: stage `release/stage`, install the tarball and audit a project with it |
| 15. Documentation and open source setup | done | `README.md`, `docs/`, `SECURITY.md`, `CONTRIBUTING.md`, CI workflows |
| 16. Installable product | in progress | see below |

567 unit and integration tests, 78 end to end tests, 10 browser tests. `pnpm verify` is green.

## Phase 16: what a stranger meets

Phases 1 to 15 built the loop. This phase is about the path a person who has never seen this repository takes through it,
and it is listed item by item because only some of it is done.

**Done, with evidence:**

- **The publishable unit is real.** `release/stage` is staged, checked for a surviving `workspace:` range, for a declared
  binary that exists, for a `files` entry that does not, and for the browser workspace, then packed and installed.
  `pnpm package` prints the directory to publish from, and `docs/guides/release.md` is the maintainer checklist.
  Evidence: `release/release-summary.json` records `publishableUnit`, `workspaceDependencies: []` and a passing install
  smoke test that audits a TypeScript and Python project with the installed binary.
- **The manifest escape hatch works.** Both documented examples were rejected by the validator; both are corrected and
  `tests/e2e/documented-manifests.test.ts` audits every documented manifest example through the real reader. A manifest
  the validator rejects is now a failed adapter run whose detail names the field, printed on the terminal and shown in the
  report rather than swallowed. `orchescope init --manifest` writes a template that validates and declares nothing.
- **A repository with nothing detected gets a report rather than a shrug**: what was looked for, what could not be
  inspected, and `orchescope init --manifest` as the next step instead of a trace that cannot help.
- **An empty traced run names its causes**: the receiver address, the OpenTelemetry variables that were set, the three
  things that actually cause an empty run, and the two ways forward that need no instrumentation.
  Evidence: `tests/e2e/runtime-onboarding.test.ts`, which also proves that honouring the endpoint variable is the whole
  contract by exporting one span by hand.
- **The report leads with signal**: the reconciliation delta or an explicit static only statement, the three worst
  findings by severity, and the next step derived from the report. Identifiers, adapter runs, the evidence legend and the
  capability table are collapsed. Every command the report prints is checked against the real command line surface by
  `tests/e2e/report-commands.test.ts`, which found seven invocations that did not exist.
- **The agent interface is exercised over a real transport**: `tests/e2e/mcp-stdio.test.ts` speaks newline delimited
  JSON-RPC to `orchescope mcp serve`, and holds that standard output carries protocol traffic and nothing else.
- **The JSON contract holds on failure as well as on success.** A failure document now carries `command`, `version` and a
  null `data` beside its `error`, `export --json` answers with the same document shape as everything else, and
  `audit --serve --json` writes one document carrying the URL instead of two. Evidence:
  `tests/e2e/json-contract.test.ts`, which found four commands that deviated.
- **A green gate needs no credential.** The secret scan runs the gitleaks command line at a pinned version, verified
  against the checksum its release publishes, over the history rather than the working tree. The action it replaces
  requires a licence key for an organisation, which is a gate this repository could never have passed.
- **Two frameworks are claimed in Python that were only claimed in JavaScript.** The adapters already read both
  dialects, but nothing held it, so nothing was claimed. Fixtures written from each library's own documented examples
  found three gaps and they are fixed: `add_node(fn)`, which LangGraph documents as taking the function's name, was
  dropped; an MCP server whose command is nested inside `params`, which is the Python shape, was recorded with an unknown
  transport; and `needs_approval` on a `@function_tool` decorator was not read, so an approval boundary went unrecorded.
  Evidence: nine tests in `packages/discovery/test/adapters.test.ts`, and an audit of a two framework Python repository
  reporting six components across five relations.
- **A sixth framework adapter: Pydantic AI.** It reads the `provider:model` string into a provider and a model with the
  relation between them, attributes a tool to the agent its decorator names, takes the agent name from the variable
  when none is declared because that is what the library infers at run time, and records a tool's `retries` as a
  bounded retry with unknown backoff and unknown idempotency. Evidence: seven tests, and an audit of a Pydantic AI
  repository where the existing retry safety rule fires on the declared ceiling without any rule being changed.
- **The LangGraph prebuilt agent is read.** `create_react_agent(model, tools=[...])` is the form the library's own
  example uses, and it declared nothing at all before: no graph, no nodes, nothing. One call now yields the agent, the
  model, the provider, the tools at their own definitions, and the relations between them. A model written as
  `provider:model` is a shared concept between two frameworks, so it lives in `model-reference.ts` rather than twice.

**Not done:**

- **Not published to npm.** `npm install -g orchescope` does not work yet. Publishing needs a registry credential this
  repository deliberately does not hold, so it stays a maintainer action with a checklist.
- **No release workflow.** Adding one would mean claiming a secret exists.
- **Ecosystem support is unchanged**: the same two languages and the same five framework adapters. Nothing here widened
  what is claimed.

## What each phase had to establish

**1. Research.** Which ecosystems exist and what they emit; where the boundary against observability, evaluation and
gateways is; what stack can parse two languages, ingest OTLP, run a browser workspace and install without a compiler. The
stack decision diverges from the research recommendation in one place, and the record says why.

**2. Contracts.** Every persisted document defined once, versioned, emitted as JSON Schema, with a drift check in CI. Identity
that survives an edit.

**3. Discovery.** One traversal, language neutral facts, one adapter per ecosystem, and honest coverage. The rule that shaped
this phase: an unparsed file is reported, never ignored.

**4. Graph.** Identifiers minted once, invariants asserted before anything is stored, and a merge that unions evidence rather
than picking a winner.

**5. Runtime.** OTLP in both encodings without a protobuf toolchain, both attribute dialects, self time and parallelism, and a
join with explicit rules where an ambiguous match is recorded rather than guessed.

**6. Findings.** Four rule families, evidence required, severity capped by basis and confidence, and strengths reported
alongside risks.

**7. Storage.** SQLite with no native dependency, forward only migrations, a content addressed artifact store, and a refusal to
read a database from a newer build.

**8. Experiments.** One dimension per benchmark, one fault per chaos plan, quantiles withheld below thresholds, and
limitations attached to every report.

**9. The loop.** A finding becomes a bounded goal; a change is verified by measured comparison; a criterion that could not be
judged is undecided rather than passed.

**10. Command line.** Stable exit codes, one JSON document per command including on failure, and a refusal that names its
setting.

**11. Report.** Loopback only, capability token, strict content security policy, eight sections, a map with a keyboard
navigable equivalent, and no control that fails when pressed.

**12. Agent interface.** Fifteen tools with explicit schemas, bounded output, and read only tools annotated as such.

**13. Security.** The controls in `docs/security/threat-model.md`, each with a test.

**14. Packaging.** A tarball that installs and audits a project, with a checksum and a manifest listing only what the bundle
actually needs at runtime.

**15. Documentation.** Enough for someone who has never seen this to audit their system, and enough for a contributor to
extend it without reading every file.

## Known limitations, stated rather than hidden

- **Two language ecosystems.** JavaScript with TypeScript, and Python. Anything else is declared in the manifest and reported
  as not inspected.
- **Six framework adapters**, each with a fixture: OpenAI Agents SDK, LangGraph, CrewAI, Pydantic AI, Vercel AI SDK, and
  model SDKs, plus MCP configuration and the manifest. The OpenAI Agents SDK and LangGraph carry a Python fixture as well
  as a JavaScript one; CrewAI and Pydantic AI are Python only because the frameworks are; the Vercel AI SDK is JavaScript
  only for the same reason.
- **One repository at a time.** Cross repository identity is not designed.
- **No answer quality measurement.** Behaviour, cost, reliability and structure only.
- **Cost is derived from token counts and a configured price table.** No price table ships, so cost is absent until one is
  configured, and every cost figure carries the `estimated` basis.
- **Model based analysis is off by default** and contributes only `model_interpreted` findings capped at medium severity.
- **The dependency direction check needs its own TypeScript.** dependency-cruiser supports the compiler API up to version 6,
  and the repository typechecks with 7, so it is given a private copy. Without that it silently cruises nothing.
- **Browser tests run in Chromium only.** Support for other engines is not claimed because nothing tests it.

## What would come next

Nothing here is committed work, and none of it is required for the product to be useful. It is recorded so a reader knows the
shape of the boundaries.

- A price table format, so cost stops being absent by default.
- More adapters, each gated on a fixture that makes the claim true.
- A design for cross repository identity, which is the prerequisite for auditing a system split across services.
- Import from a collector rather than only from a file, for teams whose runs happen elsewhere.
