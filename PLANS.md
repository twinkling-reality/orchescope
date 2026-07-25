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
| 17. Measured against real repositories | in progress | milestones 1 to 3 done: `pnpm corpus` across fourteen pinned repositories |

594 unit and integration tests, 85 end to end tests, 10 browser tests. `pnpm verify` is green.

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
- **The ceiling of a per framework reader is now visible.** An adapter that claims a framework, runs, and
  contributes nothing while a parsed file imports that framework is reported as a coverage gap naming both the
  framework and the adapter. Before this, a repository using LangGraph's functional API was told "no agent system
  was detected", which reads as a fact about the repository and was a fact about Orchescope. Evidence: four tests,
  one that fires it and three that prove it stays quiet, plus five real repositories that report no gap.
- **The LangGraph prebuilt agent is read.** `create_react_agent(model, tools=[...])` is the form the library's own
  example uses, and it declared nothing at all before: no graph, no nodes, nothing. One call now yields the agent, the
  model, the provider, the tools at their own definitions, and the relations between them. A model written as
  `provider:model` is a shared concept between two frameworks, so it lives in `model-reference.ts` rather than twice.

- **Three precision defects found by auditing a repository that is not an agent system.** A 924 file TypeScript
  monorepo reported 286 components: 258 of them were string literals the prompt adapter had matched on ordinary
  English, and it also reported a strength saying the topology was reachable, acyclic and narrow when no agent had
  been found at all. A prompt now requires a model or an agent in the graph for it to reach, which is what the
  adapter always documented and never enforced; the topology strength requires an agent and a relation to judge;
  and a scan that mapped components of other kinds says so instead of reading as an empty scan. The same repository
  now reports 28 components and no strength. Evidence: five tests, and the demonstration unchanged at 33 components
  with three strengths.

- **A real repository crashed it, and no longer does.** The first open source project it was pointed at,
  `openai/openai-agents-python`, ended in an internal error: the effects adapter synthesised an entry point
  identity for the scope around a retry loop without ever adding that component, and one unbuildable relation
  ended the audit of 843 files. The adapter now creates the component it names, and the builder discards a
  relation it cannot build, keeps the graph valid, and reports the discard against the adapter that caused it
  rather than abandoning the scan. Evidence: three builder tests, and that repository now completing with 1473
  components and 351 relations in 2.3 seconds.

**Not done:**

- **Not published to npm.** `npm install -g orchescope` does not work yet. Publishing needs a registry credential this
  repository deliberately does not hold, so it stays a maintainer action with a checklist.
- **No release workflow.** Adding one would mean claiming a secret exists.
- **Ecosystem support is unchanged**: the same two languages and the same five framework adapters. Nothing here widened
  what is claimed.

## Phase 17: measured against real repositories

Milestones 1 to 3 are done, one remains. The reason for the phase is in the numbers above: every defect in phase 16 that
mattered was found by pointing the tool at a real repository, and none of them could have been found by the fixtures.
Every adapter is validated against a fixture written by whoever wrote the adapter, which is circular: the fixture
encodes what the author already believed.

**The thesis. Measurement before more features.** A harness that runs discovery across many pinned real repositories
and holds the numbers is worth more than three more adapters, because it says which adapters matter, it catches
framework drift in the field, and it turns "does it work" into a gate. Adapter count is linear grind; the corpus says
where the grind pays.

### Milestone 1: the corpus harness. Done.

`corpus/corpus.yaml` pins fourteen repositories: name, source, commit, `kind: agent_system | not_agent_system`, and why
each one is in the corpus. Third party source is never vendored; a git entry is cloned at its pinned commit into
`corpus/.cache`, which git ignores, because licence compliance is a constraint rather than a footnote. A local entry
names a directory of this repository and is copied from its tracked files, so it measures the working tree.

`corpus/expected/<name>.json` is committed and holds what a scan produces: components by kind, relations by kind, which
adapters contributed and how much, blind spots, discarded relations, findings by rule and by severity, files parsed over
files discovered, and whether an agent system was detected. `scripts/corpus.mjs` runs the real command line, diffs
against the expectation and never rewrites it: `--record` is a separate, explicit action whose output is a diff to read.

Holding blind spots and discarded relations apart needed the coverage report to say which of the three causes an
unsupported area has, so `UnsupportedArea` now carries `language_not_analysed`, `adapter_blind_spot` or
`discarded_relation`. Nothing has to match prose to tell a limit of this release from a reader that is behind from a
defect in an adapter.

**Acceptance evidence.**

- **`pnpm corpus` passes over fourteen repositories**, ten agent systems and four that are not. Every framework adapter
  contributes to at least one: OpenAI Agents SDK in both languages, LangGraph in both, CrewAI, Pydantic AI, the Vercel
  AI SDK read from an application rather than from the library that defines it, and the model SDK adapter from
  `anthropic-quickstarts`. `tests/e2e/corpus.test.ts` holds that coverage claim rather than trusting it, and fails if a
  framework adapter stops appearing anywhere in the corpus.
- **The summary reports parse rate, adapter contribution and blind spots per repository.** The parse rates run from 33%
  on `pydantic-ai` to 96% on `openai-agents-python`, which is a number nothing in this repository could previously have
  told anyone. Four blind spots are recorded across three repositories, each naming a framework a repository imports and
  the adapter that read nothing from it.
- **Breaking one adapter deliberately fails the check and names it.** Making the LangGraph adapter skip every module it
  had matched took `langgraphjs` from 750 components to 119, and the check exited 1 reporting
  `adapters.adapter:langgraph.componentsFound: expected 1240, observed 0` first, with the blind spot line naming
  `@langchain/langgraph, langgraph, @langchain/core used in source, read by adapter:langgraph`. The same break in the
  manifest adapter fails the offline subset. Both were reverted; the working tree is clean.
- **The required gate runs the offline subset.** `pnpm corpus:offline` is a job in `ci.yml` and is also run through the
  real script by `tests/e2e/corpus.test.ts`. The pinned corpus needs network access the required gate refuses to depend
  on, so it runs from `optional-live.yml` on dispatch and uploads its summary.

**What the corpus already says**, before a single new adapter is written:

- **No relation was discarded anywhere.** The phase 16 fix holds across 14 repositories and 9198 components rather than
  across the one repository that produced the crash.
- **`pydantic-ai` parses 596 of 1808 discovered files.** Two thirds of that repository is invisible to the readers, and
  the expectation says so on every run instead of leaving it to be discovered again.
- **`axios` yields 128 components, all of them from the effect reader, and no agent system.** That is the ceiling for
  what the retry, timeout and side effect rules cost on code that has nothing to do with agents.
- **`packages/discovery` yields nothing at all.** Every framework name this product knows appears in that directory as a
  string literal, and no reader claims a component from it.

### Milestone 2: findings that survive a real repository. Done.

`openai/openai-agents-python` produced 439 findings, 211 from `topology-shape` and 193 from
`configured-tool-has-no-caller`. Two hundred instances of one pattern is one problem, not two hundred, and a `low`
finding repeated 193 times buried every `high` one under it.

A draft now names the pattern it is an instance of, and drafts from one rule naming the same pattern become one finding
carrying the occurrence count, the affected components and the sites. The component list stops at twenty five with the
number withheld stated in the text and carried as a metric with its sample size, because a list that stops without
saying so reads as a complete list. Findings are ordered by severity, then risks before strengths, then whether the
finding can become a bounded goal, then how much of the system it touches.

**Acceptance evidence.**

- **The same repository yields a report a person can read.** 439 findings became 8, and the count of two hundred moved
  from the length of the report into the title of one finding: `208 components cannot be reached from any declared
  entry point`, `193 tools are defined and nothing in this repository calls them`. The five `medium` findings now sit
  above the three `low` ones, and within each the ones that can become a goal come first.

  | Rule | Before | After |
  | --- | --- | --- |
  | `topology-shape` | 211 | 2 |
  | `configured-tool-has-no-caller` | 193 | 1 |
  | `model-call-without-timeout` | 15 | 1 |
  | `prompt-injection-boundary` | 13 | 1 |
  | `retry-around-non-idempotent-operation` | 3 | 1 |
  | `unbounded-retry` | 3 | 1 |
  | `observability-coverage` | 1 | 1 |
  | **total** | **439** | **8** |

  The same collapse across the rest of the corpus: `openai-agents-js` 149 to 5, `pydantic-ai` 58 to 7, `crewai` 12 to
  5, `langgraph` 24 to 3, the demonstration 9 to 7. Every one of those is a committed diff in `corpus/expected`.
- **Rule tests for grouping**, including one that proves the withheld count is stated: forty instances become one
  finding whose `componentsWithheld` metric is 15 with a sample size of 40, whose component list is 25 long, and whose
  explanation says `15 of the 40 affected components are not listed here`. A pattern that happened once carries no
  occurrence metric and keeps its own title.
- **Two rules re examined, and both were reporting an inference as an observation.** `configured-tool-has-no-caller`
  said "either the wiring is missing, or the tool is left over". Neither was true of the 193 it fired on: the callers
  are in a tool list assembled at run time, or in an application that is not this repository, because this repository
  is a library. `topology-shape` made the same mistake about reachability. Both now state what was observed, name the
  third cause, and report the proportion with its sample size: 193 of 271 discovered tools, 208 of 917 components that
  participate in control flow. Those proportions are what tell a reader that the shape belongs to the repository
  rather than to any one component, and they are the measurement that a threshold could later be built on. The rules
  discriminate rather than fire everywhere: `pydantic-ai` has 471 tools and no orphan among them, and the
  demonstration has none either.

### Milestone 3: the runtime join on something other than the demonstration. Done.

The delta had only ever been shown on `apps/demo`, which Orchescope also wrote, and a join that only works on its
author's code is not evidence of anything.

**Acceptance evidence.**

- **A corpus entry with a stored run whose delta is asserted.** `pydantic-ai-exercised` pins the same commit as the
  static entry and carries an `exercise` block: `pnpm corpus:exercise` builds a virtual environment under the ignored
  cache, installs the checkout's own packages, and runs the repository's `bank_support` example through
  `orchescope trace` with the library's own offline model. No provider is called, no credential is used, and the
  driver turns model requests off so an attempted one raises instead of being sent. Four spans arrive, and
  `corpus/expected/pydantic-ai-exercised.json` holds the delta by identity rather than by count: joined
  `model:test` and `tool:customer_balance`, exercised and never declared `agent:agent`, three of 917 components
  exercised. It is a second entry rather than a flag on the first because a stored run adds components and relations
  to the graph, and one expectation cannot describe a repository both with and without its own run. Without
  `--exercise` it is skipped and the skip is printed.
- **A written account of every name that failed to match and why**, in
  [`docs/research/runtime-join-on-third-party-code.md`](docs/research/runtime-join-on-third-party-code.md). In short:
  a decorated tool joined with nothing configured, which is the result that matters; an agent the example never named
  arrived as `agent` and could not join, so the same agent was counted in both directions; a model named `test` joined
  to a declaration in a different file, which is a real match for the wrong reason and a consequence of identity being
  scoped to a repository rather than to a module; and the provider was never attempted, because provider identity is
  read from a declaration and not from a span.
- **A name that cannot match is now a finding about observability rather than a silent gap.**
  `exercised-not-declared` used to say the component "runs without being declared anywhere in the repository", which
  was false: it was declared, under a name the run did not report. `observed-name-carries-no-identity` reports that
  case instead, with the bounded fix and a rerun as its check. The comparison is on the shape of the name rather than
  on a list of the fallback names each library uses, because such a list is wrong the moment one of them changes.
  Evidence: five tests in `packages/findings/test/reconciliation-rules.test.ts`.

**Still open.** `trace --import` reads a file; importing from a running collector is the missing path and still needs
a design. Scoping component identity to a module rather than to a repository is the fix for the accidental match, and
it is a design question rather than a patch.

### Milestone 4: the breadth ceiling, decided from evidence

**The model based path is scaffolding with nothing behind it.** The configuration, the policy gate, the doctor check,
the report capability, the `model_interpreted` basis and the severity cap all exist, and nothing in the product ever
calls a model: `modelInterpretationEvidence` has no caller outside tests. So the gate opens onto nothing, the README
implies a feature that is absent, and the optional workflow asserts over an empty array and passes vacuously. Either
implement it as proposals and never as facts, meaning a bounded, opt in, content hash cached pass that reads the
facts of a file no adapter could read and proposes components as a manifest draft for a person or an agent to accept,
or remove the dead interface and state that analysis is deterministic. Record the decision as an ADR.

**Language breadth follows demand.** Go, Rust, Java and C# are reported as not inspected, and each needs a parser and
a fact extractor, which is the most expensive work available here. Take one on only when the corpus shows agent
systems in it. The manifest remains the honest escape hatch until then.

### The failure modes this repository actually produces

Four shapes, every one of them found here rather than imagined. Look for them in anything you touch.

1. **Documentation describing behaviour the code does not have.** Two documented manifest examples the validator
   rejected. A model analysis feature with no implementation. A prompt adapter whose comment stated the right rule
   while the code implemented a weaker one.
2. **Fixtures that agree with their author.** Fixtures written from a framework's own published source found three
   defects in adapters assumed to work. A fixture written from memory finds nothing.
3. **Vacuous claims.** A strength about a topology with no agent in it. A workflow asserting over an empty array. A
   precision gate that fires on ordinary English.
4. **Silence where a limit belongs.** "No agent system was detected" when the truth was that the reader was behind.
   A crash where a dropped relation and a reported defect were the right answer.

### Out of scope for this phase

All interface work. The report leads with signal well enough to work with, and what limits the product today is the
depth and breadth of what it has to report. Interface work comes after these four milestones.

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
