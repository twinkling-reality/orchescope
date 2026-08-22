# ADR 0005: The corpus gate holds invariants that `--record` cannot rewrite

- Status: accepted
- Date: 2026-08-20
- Deciders: repository maintainers

## Context

Twenty seven pinned repositories with committed expectations are the only thing that has ever caught a
confident wrong answer in this build. If readers get cheaper and the corpus does not, the corpus becomes
the bottleneck and then the blind spot. Four measurements say it is already both.

**The corpus is the largest share of the cost of a framework.** Written the way the repository now
requires, one framework end to end is a median of 957 committed lines: adapter 262.5, test and inline
fixture 215, corpus entry, expectation and run script 476.5, wiring 3. **The corpus half is 49.8%, larger
than the adapter at 27.4%.** A new adapter additionally adds six lines to every existing expectation, 162
lines at 27 entries, and the per adapter coverage block is already 2,160 of 3,939 expectation lines.

**An expectation has no polarity.** `corpus/expected/crewai-examples-exercised.json` records
`runtime.exercisedComponents: 0`. Zero is the fix: it is the refusal that replaced three joins to a file
the run never entered. The file stores it as a number. Had the wrong join shipped, `--record` would have
printed 0 becoming 3 with `ambiguousNames` emptied, which reads as more of the declared graph exercised
and fewer refusals, and a reviewer would have committed it as an improvement. The only place the sentence
"zero is the fix" exists is `CHANGELOG.md`.

**The same is true of the fourth recorded failure.** Reading `graph.node.parent_id` would have moved
`exercisedEdges` off zero and added entries to `runtime.joined`, which is exactly the shape of a fix. What
caught it was a person reading the instrumentor's source. No expectation key can distinguish an edge
derived from a declaration echoed through a span from an edge a run exercised.

**`--record` overwrites every leaf, and the claim is held somewhere it cannot reach.** An expectation is
written whole from the observation, so `agentSystemDetected` is as rewritable as any count: flipping
`corpus/expected/flask.json` to `true` by hand and running `node scripts/corpus.mjs --record flask`
writes it straight back to `false`. What no recording can do is silence the claim, because the claim is
not read from the expectation. `claimDifference` at `scripts/corpus/comparison.mjs:57` checks the scan
against the `kind` declared in `corpus.yaml`, and `tests/e2e/corpus.test.ts:52-65` asserts the recorded
leaf against that same `kind` out of band: with `flask` recorded as detected, the corpus test fails with
"flask is pinned as not_agent_system and its expectation disagrees". So one claim per entry is held by a
file `--record` does not write, and the other 2,468 of the 2,495 leaves are held by a reviewer reading a
diff.

**And the corpus did not catch two of the four failures it is credited with.** The `.mcp.json` failure was
found by a field sweep across 33 to 36 real repositories; no corpus entry pins a `.mcp.json` in a
repository that is not already an agent system. The express `agents.yaml` failure was found by two hand
constructed fixture repositories; no negative entry holds an `agents.yaml`. The next failure of that class
is nameable and uncovered: a repository that genuinely depends on an agent framework, so the dependency
gate passes, and also holds an unrelated roster whose entries carry a `role` and a `goal`.

Two patterns in this repository already do the right thing and show what it looks like.
`tests/e2e/rule-input-producers.test.ts` derives both halves of its check rather than being handed a list,
and `tests/e2e/goal-eligible-rules.test.ts` enumerates every remediation a rule can print. Both exist
because a filter that never matches looks exactly like a filter with nothing to match. Meanwhile
`tests/e2e/corpus.test.ts:23` declares `FRAMEWORK_ADAPTERS` as a hand written array of six where
`DEFAULT_ADAPTERS.filter(a => a.packages.length > 0)` is eight, omitting `adapter:mcp` and
`adapter:search-index`. The anti pattern those two tests were written to replace is sitting inside the
test that guards the corpus.

## Decision

**The corpus gate holds invariants alongside expectations, and an invariant is not something `--record`
can rewrite.**

An expectation records what a scan produced and is read by a person. An invariant states what must be true
of every entry, holds with no per entry file, and fails the gate when it does not hold. Three families,
adopted in this order.

**1. A generated negative corpus.** The five `not_agent_system` entries crossed with an injection table of
the shapes that have fooled this build: a `.mcp.json` with one server, a root `agents.yaml` of hosts and
ports, a `deploy/agents.yaml` of account executives carrying a `role` and a `goal`, a `wrangler.toml`, an
`mcpServers` key. The assertion is the invariant rather than a number: no component of an agent system kind
counts toward detection, `agentSystemDetected` stays false, and each injected shape either declines or
records as `developer_tooling`. Adding a shape is one table row and applies to every negative at once, so
this grows with the failure log rather than with the reader count. Two of the four recorded failures were
found this way already, by hand.

**2. A dependency property, checked on every entry with no expectation.** *A component attributed to an
adapter whose declared packages the repository does not use must carry `details.role:
'developer_tooling'` and must not count toward `agentSystemDetected`.* Re-derived over the corpus after
the fact model work landed, 6,032 components are attributed to a framework adapter, and the count the
property asks for is **0 under `projectUses`, the predicate `appliesTo` itself asks, and 1 under the
stricter reading of a source import alone**. That one is `mcp_server:gpt-researcher`, which declares
`mcp>=1.9.1` in `requirements.txt` and imports it in no file, and it carries `role: developer_tooling`.
**Zero violations under either reading, and the exception under the stricter one is the fix for the first
recorded failure.** For six of the eight package declaring adapters the property is true by construction,
because `appliesTo` is `projectUses`. The two exceptions are `crewai` and `mcp`, each of which ORs a
configuration door into `appliesTo`, and those two adapters produced both recorded detection failures.
`dependencyEvidence` cannot be what makes this answerable, which was the mechanism proposed here and is
measurably the wrong one. It records that a manifest declares a package, and a manifest declaration answers
the question on 12 of the 27 entries: on 15 a framework adapter's packages are used and named in no manifest
this build reads, and 9 of those declare nothing at all because `readManifests` reads the repository root
and they are monorepos or per directory applications. `crewai-examples` is the sharpest case, with no root
manifest of any kind and `crewai` answered entirely by imports, and it is also the entry holding 18 of the
21 components declared only by a configuration document. So the evidence would fire on 1 of those 21. It is
deleted rather than wired, and it is not alone: `scenarioOutcomeEvidence` has no producer either, and
`model_interpretation` has none by decision, so three of the ten `Evidence` kinds are terms in a published
contract that nothing writes.

**And the property has almost no population on the pinned corpus, which is what decides where it is
held.** At most one component satisfies its antecedent across all twenty seven entries, and none at all
under the predicate the build uses to decide whether an adapter runs. A gate holding this property over the
pinned entries alone asserts over an empty set, which is the shape named three paragraphs above and the
reason `rule-input-producers.test.ts` exists. The generated negatives are what give it a population by
construction: an injected `.mcp.json` in a repository depending on express is a component attributed to
`adapter:mcp` in a repository importing no MCP SDK, which is the antecedent, on every negative at once. So
this is not a second family. It is the first family read over a wider set of components, and it is asserted
where that set exists: over the same table of shapes crossed with a repository declaring one ordinary web
framework, with the adapters read from `DEFAULT_ADAPTERS` rather than written down.

**Stated as a universal invariant it is also false, and the counterexample is a correct answer.**
`crew.jsonc` is a name CrewAI owns outright: its generator writes one and its `pyproject.toml` names it.
Injected into a repository depending on express, the CrewAI adapter reads it through its configuration
door, declares the two agents the document lists, and reports an agent system, none of it carrying
`developer_tooling`. That is the property violated and the answer right. The line the table is drawn along
is therefore narrower than the property: these are the names that belong to nobody, where `agents.yaml` is
a word and `servers` is a word and a `.mcp.json` belongs to whoever is reading the repository. A shape whose
name a framework owns is not a lookalike, and a property that cannot tell the two apart is a check on the
doors rather than a law about them.

**3. An anti circularity check between the two halves.** *An observed relation exactly rederivable from a
declaration is a circular join, not a join.* This is the fourth recorded failure stated as a property. An
observed relation records the span input that says the relation happened separately from the inputs that
name its endpoints. When a declared relation's supposed trigger is only an endpoint attribute, and no span
field contributed to it, reconciliation refuses to mark the declaration exercised. A real parent span and
a handoff event remain observations because each carries an independent runtime trigger.

**And every list the build can derive, it derives.** `FRAMEWORK_ADAPTERS` comes from `DEFAULT_ADAPTERS`,
and so does the adapter set the dependency property is asked over, which is what covers a fourteenth reader
on the day it declares its `packages`.

Asking every `Evidence` kind against something that writes it is not adopted, and the measurement is why.
Three of the ten have no producer: `dependency` and `scenario_outcome` had a builder each and no caller,
and `model_interpretation` is a term ADR 0002 kept on purpose after removing the path that would have
written it. The builders are deleted, which leaves the kinds in the published `Evidence` union with nothing
writing them, and closing that gap means narrowing the union, which moves a published document version.
That is a decision on its own evidence and not a check to bolt onto this one. What is recorded here instead
is the number, so the next reader finds three rather than rediscovering it.

Expectations stay. They are what catches a framework moving in the field, and nothing else does. What
changes is that they stop being the only thing between a wrong answer and a release.

## Consequences

**The corpus stops growing linearly with the reader count.** An invariant covers adapters that do not exist
yet. The dependency property is the clearest case: a fourteenth adapter is covered the day it declares its
`packages`.

**A `--record` diff gets smaller and more meaningful.** Leaves that an invariant now asserts do not need a
reviewer's attention, and the ones left are the ones where a person's judgement is the point.

**Two failure classes get a permanent home.** Precision failures on a repository that is not an agent
system become a table row. Circular joins become a property. Neither depends on somebody remembering.

**The acquisition boundary was decided separately.** This record left 25 of 27 entries outside the required
gate because third party source was not vendored for licence reasons. ADR 0010 admits three static third-party
entries through bounded full-commit archives pinned by normalized source tree and licence digests. Five of the
28 entries now run in required CI; the other 23 remain in the full clone-backed or exercised corpus because
their additional coverage does not fit the selected acquisition, environment or time bounds.

## What the measurement said

Every adopted check is built. The dependency property was measured and folded into the generated
negative family rather than kept as a separate family, for the reason this record already gave.

**The generated negatives found five live precision failures on their first run.** Eleven shapes crossed
with the five pinned repositories that are not agent systems is 55 injections, and 5 of the 11 broke the
invariant on every one of them. All five were one defect: the ten paths this build opens on every scan were
recorded as one reason for opening when they are three, so `agents.yaml`, `config/agents.yaml` and this
build's own manifest were handed to whichever reader recognised a key inside them. A roster of account
executives at the root declared two agents in a repository depending on express and nothing else, and an
`mcpServers` key in any of the three declared a server the repository was said to connect to. The same
documents one directory down, found by the traversal, were declined. The fix is that the origin travels
with the path; neither adapter needed a new gate, because both were already asking the right question and
being handed the wrong answer.

That is the family working as proposed, and it is the number this record cared about: two of the four
recorded failures were found by hand outside the corpus, and the next five were found inside it, before a
release rather than after a field report.

**The dependency property was measured and not reversed, and it turned out to be the same family.** The
count that would have demoted it is 0. Its antecedent is empty on the pinned corpus and non empty by
construction on the negatives, so it is asserted there, over the adapter set derived from
`DEFAULT_ADAPTERS`. Its proposed mechanism, `dependencyEvidence` at manifest read time, is measurably
insufficient and is deleted rather than wired.

**The anti circularity check is built in its general form.** `packages/traces` records per field provenance
for every observed component and relation: the attributes that supplied kind, name and code location, the
attributes that named both relation endpoints, and the independent span input that says the relation
happened. Reconciliation asks the property rather than an attribute list. A declared edge whose relation
trigger is wholly rederived from its endpoint attributes is not marked exercised; the identical edge from
real parent span nesting is. `graph.node.parent_id` remains the recorded witness and now exercises the
property rather than occupying a named refusal table.

The same provenance makes the missing half of code location coverage explicit. A reconciliation reports
`code.file.path` with the number of observed components that lacked it. `byCodeLocation` remains 0 on all
eight exercised entries, but it no longer leaves a reader to infer whether zero means the attribute was
absent or present and unmatched.

The population that check would have to work over is worth recording beside it. Across all eight exercised
entries the runs join **21 components, 20 of them on a name alone, and 6 relations**. That is what the
observed half of this join amounts to today, and it is why the general form is a prerequisite question
rather than a coverage question.

**And the premise this record opened on was wrong.** `--record` overwrites every leaf including
`agentSystemDetected`. What it cannot do is silence the claim, which is checked against `corpus.yaml` in two
places that a recording never touches. The distinction matters because it names what an invariant actually
is here: not a leaf `--record` skips, but an assertion that has no leaf at all.

## What would reverse this

**The dependency property having more than one exception on the corpus after the fact model work lands.**
An invariant with a growing exception list is an expectation wearing an invariant's name, and it must be
demoted rather than excused. The measurement is the count of components attributed to a framework adapter
whose packages the repository does not use and that do not carry `developer_tooling`.

That measurement was run once [ADR 0003](0003-fact-model-breadth.md) landed, which is what it was waiting
for, and **it did not reverse this: the count is 0.** The fact model work moved the proxy the first
version of this record quoted and did not move the answer. Components attributed to a framework adapter
fell from 6,116 to 6,032, the 84 being the CrewAI join folding one declared agent and the call that
builds it into one component, 40 on each `crewai-examples` entry and 4 on `crewai`. The ones declared
only by a configuration document fell from 104 to 21, because 39 agents on each of those two entries now
carry a source location beside their config location. Neither number is the property. The property's own
count was 1 before and is 1 now under a source import alone, 0 under `projectUses`, and 0 violations
throughout.

**Or a generated negative that fails for a true reason.** If an injected shape genuinely makes a repository
an agent system, the injection table is wrong rather than the build, and a row that has to be excused per
entry is a row that belongs in an expectation instead.
