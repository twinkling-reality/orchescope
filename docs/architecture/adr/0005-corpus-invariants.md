# ADR 0005: The corpus gate holds invariants that `--record` cannot rewrite

- Status: proposed
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

**`--record` can overwrite everything except one boolean.** `claimDifference` at
`scripts/corpus/comparison.mjs:57` checks `agentSystemDetected` against the `kind` declared in
`corpus.yaml`. Every other leaf, 2,497 of them, is a recorded number that a reviewer either reads or does
not.

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
adapter whose declared packages the repository does not import must carry `details.role:
'developer_tooling'` and must not count toward `agentSystemDetected`.* Measured over the corpus today,
6,116 components are attributed to a framework adapter and 104 are declared only by a configuration
document; 103 of those sit in repositories that do declare `crewai`, and the one remaining is
`mcp_server:gpt-researcher`, which carries `role: developer_tooling`. **One exception, and the exception is
the fix for the first recorded failure.** For six of the eight package declaring adapters the property is
true by construction, because `appliesTo` is `projectUses`. The two exceptions are `crewai` and `mcp`, each
of which ORs a configuration door into `appliesTo`, and those two adapters produced both recorded
detection failures. `dependencyEvidence` is wired at manifest read time as part of this, so the property is
answerable from the bundle: it is exported at `packages/domain/src/evidence.ts:54` and called by nothing,
0 of 20,873 evidence records.

**3. An anti circularity check between the two halves.** *An observed relation or identity that is exactly
rederivable from a declaration is a circular join, not a join.* This is the fourth recorded failure stated
as a property, and it would have fired the moment `graph.node.parent_id` was read, because `crew.agents[i-1]`
rederives exactly. It also catches a `runtime_name` join made against a name an adapter invented, which is
the third failure from the other side. It requires per attribute provenance on the trace side, which
`packages/traces` does not carry, and that prerequisite is the reason it is third rather than first.

**And every list the build can derive, it derives.** `FRAMEWORK_ADAPTERS` comes from `DEFAULT_ADAPTERS`.
Every `Evidence` kind is asked against something that writes it, which fails immediately on `dependency`
and is the point.

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

**One thing is deliberately not fixed here.** 25 of 27 entries still run outside the required gate,
because third party source is not vendored for licence reasons. A cached clone job or a pinned tarball
digest would close that, and it is a packaging decision rather than a verification one.

## What would reverse this

**The dependency property having more than one exception on the corpus after the fact model work lands.**
An invariant with a growing exception list is an expectation wearing an invariant's name, and it must be
demoted rather than excused. The measurement is the count of components attributed to a framework adapter
whose packages the repository does not import and that do not carry `developer_tooling`.

**Or a generated negative that fails for a true reason.** If an injected shape genuinely makes a repository
an agent system, the injection table is wrong rather than the build, and a row that has to be excused per
entry is a row that belongs in an expectation instead.
