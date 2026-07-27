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
| 17. Measured against real repositories | done | `pnpm corpus` across fifteen pinned entries, `docs/architecture/adr/0002-deterministic-analysis.md` |
| 18. The joins the pipeline computed and dropped | done | see below |
| 19. The map named the harness and missed the system | done | see below |

657 unit and integration tests, 92 end to end tests, 10 browser tests. `pnpm verify` is green.

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

All four milestones are done. The reason for the phase is in the numbers above: every defect in phase 16 that
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

- **`pnpm corpus:exercise` passes over fourteen entries**, ten agent systems and four that are not, across thirteen
  distinct repositories: one is pinned twice, once measured statically and once with a run in it. Every framework adapter
  contributes to at least one: OpenAI Agents SDK in both languages, LangGraph in both, CrewAI, Pydantic AI, the Vercel
  AI SDK read from an application rather than from the library that defines it, and the model SDK adapter from
  `anthropic-quickstarts`. `tests/e2e/corpus.test.ts` holds that coverage claim rather than trusting it, and fails if a
  framework adapter stops appearing anywhere in the corpus.
- **The summary reports parse rate, adapter contribution and blind spots per repository.** Twelve of the fourteen
  entries parse every file in a language this build reads; the two that do not are the two pins of `pydantic-ai`, which
  parse 596 of 600 because four Python files are past the size limit. Four blind spots are recorded across three repositories, each naming a framework a
  repository imports and the adapter that read nothing from it.
- **The first number the corpus reported was wrong, and the corpus is what caught it.** The summary divided files
  parsed by files discovered and called it a parse rate, so `pydantic-ai` read as 33% when every Python file in it had
  been parsed: the repository holds 1233 test fixtures in YAML and 598 Python files, and the denominator counted the
  fixtures. Coverage now carries `filesInSupportedLanguages`, which counts the files this build claims to read
  including the ones it was refused, and the rate is against that. Evidence: one test that counts a Python file too
  large to read and excludes a YAML fixture that was never claimed.
- **Breaking one adapter deliberately fails the check and names it.** Making the LangGraph adapter skip every module it
  had matched took `langgraphjs` from 750 components to 119, and the check exited 1 reporting
  `adapters.adapter:langgraph.componentsFound: expected 1240, observed 0` first, with the blind spot line naming
  `@langchain/langgraph, langgraph, @langchain/core used in source, read by adapter:langgraph`. The same break in the
  manifest adapter fails the offline subset. Both were reverted; the working tree is clean.
- **The required gate runs the offline subset.** `pnpm corpus:offline` is a job in `ci.yml` and is also run through the
  real script by `tests/e2e/corpus.test.ts`. The pinned corpus needs network access the required gate refuses to depend
  on, so it runs from `optional-live.yml` on dispatch and uploads its summary.

**What the corpus already says**, before a single new adapter is written:

- **No relation was discarded anywhere.** The phase 16 fix holds across fourteen entries and 9198 components rather
  than across the one repository that produced the crash.
- **`pydantic-ai` is the only repository that does not read everything it claims to.** Four Python files are past the
  size limit, so 596 of 600 are parsed. Every other entry reads all of them, which is a stronger statement than the
  corpus could make before the denominator was fixed.
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

**Both of the questions this raised were answered in phase 18.** A run that happens elsewhere is collected with
`orchescope receive` rather than exported to a file first. And the accidental match was never an identity problem:
identity is already scoped to a module, and what was missing was a delta that says which joins rest on a name alone.

### Milestone 4: the breadth ceiling, decided from evidence. Done.

**The model based path was scaffolding with nothing behind it, and it is gone.** The configuration block, the policy
gate, the doctor check, the evidence builder and the scenario judge hook were all present and nothing called a model.
[ADR 0002](docs/architecture/adr/0002-deterministic-analysis.md) records the decision, and the corpus is what made it
answerable rather than a preference: no pinned repository contains a language no parser here reads, so the case the
model path existed for does not occur in the corpus, and every gap the corpus does report is an adapter form in a
language already parsed. Teaching an adapter a form is deterministic, cheaper and already scoped by the blind spot
report, which names the framework and the adapter for each one.

What went: `semanticAnalysis` and with it the `config` document at version 2, `semanticAnalysisDecision`, the doctor
check, `modelInterpretationEvidence`, the `judge` hook no caller supplied, the workflow job that asserted over an
empty array, and every documentation sentence claiming the product interprets a repository with a model. What stayed:
`model_interpreted` in the basis vocabulary with its cap, the report capability answered permanently unavailable with
its reason, and the `model_judge` evaluator kind, because those are terms in versioned contracts rather than controls
that do nothing. A configuration file that still carries the retired block is read and the omission is reported, not
refused, because configuration is committed and an upgrade should not fail an audit on a key that used to work.
Evidence: four tests in `packages/workspace/test/config.test.ts`, including one that reads a version 1 file with the
block in it.

**Language breadth is not taken on, and the corpus is why.** Go, Rust, Java and C# are still reported as not
inspected. `languagesNotAnalysed` is empty in all fourteen expectations: not one pinned repository, agent system or
not, contains a file in a language this build does not read. A parser and a fact extractor are the most expensive work
available here, and nothing measured asks for one yet. The manifest remains the escape hatch, and the corpus is where
the evidence to reverse this will appear: an entry whose expectation records a language gap next to an agent system in
it.

### The failure modes this repository actually produces

Four shapes, every one of them found here rather than imagined. Look for them in anything you touch.

1. **Documentation describing behaviour the code does not have.** Two documented manifest examples the validator
   rejected. A model analysis feature with no implementation, described across eight documents. A prompt adapter whose
   comment stated the right rule while the code implemented a weaker one. A parse rate that divided by the wrong
   denominator and called the result coverage.
2. **Fixtures that agree with their author.** Fixtures written from a framework's own published source found three
   defects in adapters assumed to work. A fixture written from memory finds nothing.
3. **Vacuous claims.** A strength about a topology with no agent in it. A workflow asserting over an empty array. A
   precision gate that fires on ordinary English.
4. **Silence where a limit belongs.** "No agent system was detected" when the truth was that the reader was behind.
   A crash where a dropped relation and a reported defect were the right answer.

### Out of scope for this phase

All interface work. The report leads with signal well enough to work with, and what limits the product today is the
depth and breadth of what it has to report. Interface work comes after these four milestones.

### What phase 17 left open, and what became of it

Every item here was taken up in phase 18. What that phase found is recorded above; this is the ledger.

- **Import from a running collector.** Answered by receiving rather than fetching: `orchescope receive`.
- **Component identity scoped to a module rather than a repository.** Identity already was module scoped. The real
  defects were a path alias splitting one component into two, and a weak match rule that looked like a strong one from
  outside. Both are fixed, and a join now reports the rule that made it.
- **Four blind spots with names on them.** Two were false, one was a matcher defect shared by every Python adapter,
  and one is a true statement about a repository that declares nothing to read.
- **A second exercised entry, in JavaScript.** `vercel-ai-chatbot-exercised`, six spans, one joined tool, and an
  identity defect found in the process.

## Phase 18: the joins the pipeline computed and dropped

Four numbers were derived correctly, carried most of the way, and then discarded before anything could read them.
None of them failed loudly: an absent overlay looks exactly like a system that did nothing, and a criterion that
cannot be judged reads as an honest refusal rather than as a missing wire. Every one was found by reading the code
rather than by a failing test, which is why the packages they lived in now have tests.

**Per component runtime metrics were never stored.** `deriveTopology` computes executions, self time, tokens, errors
and retries per observed name, and `audit` builds the map from observed name to component identity, and nothing
joined the two: every caller of `saveRun` passed an empty list. The consequences were quiet and wide. The map carried
no runtime overlay at all, because all five are gated on that array. `latency-concentrated-in-one-component` reported
"no self time was recorded" and `tokens-concentrated-in-one-component` reported "no token usage was reported by the
instrumentation" on a run whose own record carried 1379 input and 84 output tokens, which is an inference presented as
an observation. Attribution now happens where both halves exist, during the audit that reconciled them, and it covers
components that only exist because they ran as well as ones that met a declaration. Evidence:
`packages/usecases/test/runtime-attribution.test.ts`, `packages/report/test/overlays.test.ts`, and
`tests/e2e/runtime-metrics.test.ts`, which asserts on the numbers rather than on an exit code because that is the only
way this class of defect announces itself.

**Scenario evaluator outcomes never reached the report.** `test --scenario` judges every criterion and stores the
result, and the report bundle hardcoded an empty list for each scenario run, so the workspace showed that runs had
happened and never what they were judged by. The browser test passed throughout, on a bundle written by hand.

**Goal validation never received the scenario results it needed.** A goal created from a finding carries a
`scenario_passes` criterion whenever a scenario exists, and neither the command line nor the agent interface passed
any results to judge it with, so it was always undecided and a goal carrying one could never validate. That is the
end of the loop this product is built around. The results are now read from the store inside the use case, so both
surfaces are fixed at once, and a result that predates the goal leaves the criterion undecided with the reason
stated: judging a change against its own baseline is the one mistake the criterion exists to prevent.

**The price table had no way in.** `estimateCost` and `PriceTable` had no caller and configuration had no `pricing`
key, while the README and the cost overlay both described a configured price table. Configuration now carries one,
`init` writes it empty so it is discoverable, and cost is estimated from observed tokens against the provider and
model the spans reported. A component whose model has no configured price carries no cost rather than a cost of zero,
and the report answers a `cost_estimate` capability saying which half is missing: no price configured, or no tokens
observed to apply one to.

### What the corpus said about the same release

- **Two of the four blind spots were never blind spots.** `langgraphjs` imports the Vercel AI SDK and an OpenAI client
  in `import type` statements, which are erased before the program runs and can construct nothing. An adapter reading
  nothing from them is correct, and counting them was the reader accusing itself.
- **The other two were one defect in the shared matcher.** `from mcp.server import FastMCP` did not match the package
  `mcp`, because module matching understood `@scope/pkg/sub` and not `pkg.sub`, while the coverage report already
  split on the dot. One reader behind the other is what a blind spot looks like from outside. Teaching the matcher the
  dotted form, and teaching the MCP adapter the `@mcp.tool()` decorator the Python SDK documents, closed both:
  `anthropic-quickstarts` gained the server and tool it declares, and six MCP servers with 65 tools appeared in
  `openai-agents-python`. The same fix widened four Python repositories, because `from crewai.tools import ...` and
  `from langgraph.graph import ...` now resolve.
- **And it immediately over-matched, and the corpus caught that too.** A repository with its own `agents` package had
  every `from agents.agent import Agent` read as the OpenAI Agents SDK, eight components in a repository that uses
  none. A specifier rooted in one of the repository's own top level Python packages is never a distribution, and
  `anthropic-quickstarts` went back to reporting no such adapter.
- **`crewai` keeps its blind spot, and the reason it prints was wrong.** Its FastMCP servers are inside string
  literals that its tests write to disk, so there is nothing to read. The reason now names the second cause: a
  repository can import a framework as a client and declare nothing an adapter could read.

### The join in JavaScript, and the identity defect it found

`vercel-ai-chatbot-exercised` pins the same commit as the static entry and drives the application's own offline model
and its own tool through the SDK's OpenTelemetry integration. Six spans arrive, no provider is called, and the tool is
invoked on the branch of its own code that answers without contacting a weather service.

Two things worth recording. The SDK emits nothing from version 7 until `@ai-sdk/otel` is registered, so a driver
written against the previous documentation runs, succeeds, and exports zero spans. And what it emits is the generative
AI convention rather than a dialect of its own, so nothing had to be taught to the reader.

The tool arrived and joined nothing, because the repository declared it twice: once where `tool()` is called and once
where it is passed into a `tools` map in another module. Identity is `(kind, module, local name)`, and the reference
in the second module never resolved to the first because the symbol index followed relative specifiers only and the
import is `@/lib/ai/tools/get-weather`. An unresolved reference becomes a new component, so a path alias was quietly
splitting one tool into two. The index now resolves `@/` and `~/`, which cannot be package names because an npm scope
is never empty; the repository went from 46 components to 41 with all 30 relations kept.

**A join is now reported with the rule that made it.** Identity was already scoped to a module, so the open question
was never identity: it was that a match on kind and name alone is the weakest rule and looked like every other join
from outside. The delta carries the counts and names the components joined on a name alone, which is what makes the
`model:test` match in `pydantic-ai` visible as the weak join it always was rather than a footnote in prose.

### Spans from a system Orchescope did not start

`orchescope receive --for 10m` stands the receiver up for a window and stores whatever arrives. It is receiving rather
than fetching, and that is the design decision: OTLP is a push protocol with no query interface, and every backend
that stores spans has its own API, so fetching would have meant choosing a vendor and calling it the integration. It
prints the endpoint the moment it is listening, ends on the deadline or on an interrupt without losing what arrived,
and stays bound to loopback. Evidence: `tests/e2e/receive.test.ts`.

### What the first repository outside the corpus found

Pointed at a private TypeScript monorepo with a menu bar application and a mobile target in it, three defects that
fourteen pinned repositories had not produced:

- **8,591 skipped files in one coverage report**, 8,590 of them symbolic links inside a CocoaPods header directory.
  That is unbounded output, which this repository prohibits, and it was also useless: every line described a vendored
  dependency. `Pods`, `.build`, `DerivedData`, `Carthage` and `.gradle` are now excluded like `node_modules`, and the
  list is bounded at twenty per reason with the withheld count stated.
- **Bounding it changed a measurement, and the corpus caught that within the hour.** `pydantic-ai` went from 596 of
  600 files parsed to 596 of 596, which reads as complete coverage and was a truncated list: the denominator counts
  skipped files in a language this build reads, and four of them fell outside the sample. Counting now happens over
  the whole list and bounding only over what is listed, with the total carried separately as `filesSkipped`.
- **Fifty one Swift files went unmentioned.** The coverage report said every file in a language this build reads had
  been read, which was true and was not the whole answer, while the README promises that a file in a language it
  cannot parse is reported rather than ignored. Swift and Kotlin are now named.

One more thing that repository found: the comment beside the duplicated exclusion list said the two copies were kept
in step by a test, and there was no such test. The first time one list gained an entry the other did not, which is
how the vendored directories stayed unexcluded through a full run of the gate. That test exists now.

## Phase 19: the map named the harness and missed the system

The same repository was scanned again and its graph was wrong in a way a passing gate could not see. It reported a
`sqlite` database whose every source location was a test double or a port scaffold, while the database the repository
actually runs on, a Cloudflare D1 binding behind fifty seven prepared statements in twenty four modules, was not in the
graph at all. Nothing failed. The scan was fast, the coverage was honest about files, and the picture was inverted.

Four defects, each with a test that fires it and a test that stays quiet without it.

**A client root matched any member of itself.** `axios.get` is a request and `axios.isCancel` is not, and the matcher
accepted both because it compared only the root. Two things followed. A promise chain repeats the root at every link,
so one `fetch(url).then().then().catch()` became four components and four edges at one source location. A test double
is configured through the same shape, so `fetch.mockResolvedValue(...)` was recorded as a call to an unresolved host,
which made the heaviest edge in that repository's graph twelve lines of mock setup in a single test file. The operation
names this build already recognised were the vocabulary that separated them. What the corpus said about the old
behaviour is the point: of the `httpx` members `langgraph` was counting as service calls, `httpx.get` appeared three
times, against 218 `httpx.AsyncClient`, 193 `httpx.Response` and 116 `httpx.ASGITransport`, none of which issues a
request. Its `calls_service` count fell from 353 to 4 and became true.

**A test harness reaches real clients at fakes.** Effects discovered only in a test file describe the harness, and
carrying them into the graph manufactures an unexercised declaration for every one of them, which is the rule the join
exists to run. The effects adapter now skips test files by the conventions the three ecosystems share. `spec` alone is
deliberately not one of them: a directory of that name holds API documents at least as often as tests. The corpus
priced it honestly. `langgraph` has 740 datastore client constructions under test paths and 53 outside, and its
`queries_database` count fell from 168 to 14. Every one of `pydantic-ai`'s 97 `consumes_from_queue` relations came from
`tests/test_temporal.py`, where a Temporal `Worker` had been read as a BullMQ one.

**A binding exists only in the deployment manifest.** `env.EVENTS_DB` is a property access whose meaning is in a file no
source reader opened, so a worker's database, namespaces, buckets and queues were invisible. `adapter:workers-bindings`
reads a Cloudflare Workers manifest and joins it to the code through the binding name, which is the one identifier both
halves share. Reading it needed the traversal to run before configuration, because the manifest sits beside the worker
it deploys and not at the repository root; the candidates come from that bounded walk under the same exclusions and the
same file limit, and the count read is capped. The relation carries the reach and claims nothing about the operation,
because passing a binding to a function is not evidence of what happens to it there. That repository went from one
false datastore to three real ones and 21 relations reaching them.

**And the terminal divided by the wrong number.** The line a reader meets on a repository with no agent system read
`929 of 962 files in a language this build parses were read`, when 929 of 929 had been read and the other 33 were JSON,
YAML and TOML, which `isSupportedLanguage` excludes by name. Phase 18 added `filesInSupportedLanguages` and corrected
discovery, the schema, the corpus scripts and the guides, and touched no file under `apps/cli`. The corpus could not
catch it because the corpus compares JSON and this was prose.

Thirteen corpus entries were re-recorded. Every movement is a number falling toward what the repository contains.

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

- **Two language ecosystems.** JavaScript with TypeScript, and Python. Go, Rust, Java, Kotlin, Swift, C#, Ruby and PHP
  are named in the coverage report as not inspected; anything else is declared in the manifest.
- **Six framework adapters**, each with a fixture: OpenAI Agents SDK, LangGraph, CrewAI, Pydantic AI, Vercel AI SDK, and
  model SDKs, plus MCP configuration, Cloudflare Workers bindings and the manifest. The OpenAI Agents SDK and LangGraph
  carry a Python fixture as well as a JavaScript one; CrewAI and Pydantic AI are Python only because the frameworks are;
  the Vercel AI SDK is JavaScript only for the same reason.
- **One deployment platform reads its bindings.** Cloudflare Workers only. A repository on another platform declares its
  infrastructure in the manifest, and its stores are otherwise discovered from client constructions in source.
- **Effects in test files are not mapped.** A component only a test constructs cannot appear in a run, so carrying it
  into the graph would report an unexercised declaration for every double. Test files are recognised by naming
  convention, so a test written somewhere no convention names is still read as source.
- **One repository at a time.** Cross repository identity is not designed.
- **No answer quality measurement.** Behaviour, cost, reliability and structure only.
- **Cost is derived from observed token counts and the price table in `pricing`, which is empty until it is filled in.**
  No price table ships, because a price this repository guessed would be wrong the week a provider changed it. Until one
  is configured, tokens are reported and cost is not, and the report says which of the two halves is missing. Every cost
  figure carries the `estimated` basis.
- **Nothing calls a model.** Analysis is deterministic, and the model based path that was scaffolded and never
  implemented was removed rather than finished. The decision, the corpus evidence behind it and what would reverse it
  are in [ADR 0002](docs/architecture/adr/0002-deterministic-analysis.md).
- **The dependency direction check needs its own TypeScript.** dependency-cruiser supports the compiler API up to version 6,
  and the repository typechecks with 7, so it is given a private copy. Without that it silently cruises nothing.
- **Browser tests run in Chromium only.** Support for other engines is not claimed because nothing tests it.

## What would come next

Nothing here is committed work, and none of it is required for the product to be useful. It is recorded so a reader knows the
shape of the boundaries.

- More adapters, each gated on a fixture that makes the claim true.
- A design for cross repository identity, which is the prerequisite for auditing a system split across services.
- Import from a collector rather than only from a file, for teams whose runs happen elsewhere.
