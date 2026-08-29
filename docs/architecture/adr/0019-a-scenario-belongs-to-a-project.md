# ADR 0019: A scenario is identified by its project and its name

- Status: accepted
- Date: 2026-08-28
- Deciders: repository maintainers

## Context

The store keyed the `scenario` table on the scenario identifier alone, and three of that table's four
readers took an identifier and no project: `scenarioById`, `scenarioSourceById` and, one table over,
`scenarioResults`. `saveScenario` upserted `ON CONFLICT(id)` and its update clause did not include
`project_id`.

Every other identifier this store keys on is minted from content. A run, a scan, a report and a finding all
carry a digest projection, so two of them collide only when they are the same thing. **A scenario
identifier is the one an author types**, bounded to `^[a-z0-9][a-z0-9-]{1,63}$`, and `example` is the
identifier this product's own `init --scenario` writes into every template it hands out. The name most
likely to be shared between two repositories is the one the product supplies.

One store holds two projects whenever a repository is copied together with its `.orchescope` directory: a
project identifier is minted from the scan root, the database travels with the copy, and the copy scans a
different root. That is not exotic. It is `cp -r`, a CI cache, a container image, a worktree, and it is
what a corpus measurement does 56 times.

**What that produced, run end to end through the command line.** A repository declaring
`scenarios/example.yaml` was audited, copied, and its scenario file and target script deleted from the
copy. The copy then reported `scenarioCount: 0`, and `orchescope test --scenario example` **loaded the
original repository's scenario and spawned its argv**, under that scenario's permissions, budgets and
evaluators rather than any the copy had declared. The recorded symptom, that a copy lists none of its own
scenarios, was the smaller half.

## Falsifier stated before this record was written

Reject this record unless all of these hold.

1. Saving a scenario under one project neither moves nor hides another project's scenario of the same name.
2. A repository holding no scenario file cannot load or run one belonging to another project in the same
   store, and is told so with a remediation.
3. The repository that does declare it still runs it.
4. A store written by the previous version upgrades in place, keeping its scenarios, results and runs.
5. The corpus does not move.

## Decision

### 1. A scenario's identity in the store is its project and its name

Migration 3 rebuilds `scenario` with `PRIMARY KEY (project_id, id)`. Rebuilt rather than altered, because
SQLite cannot add a column to a primary key in place, and rows carry over exactly as they are: a row under
a project that no longer scans this root becomes invisible to the project that does, which is the correct
answer and is repaired by the next audit. Nothing references the table, so the rebuild needs no foreign key
suspension.

### 2. Every read of a scenario names the project asking

`scenarioById`, `scenarioSourceById` and `scenarioResults` take a project identifier. Every caller already
held one; not one of them had to reach for anything new, which is what says the parameter was missing
rather than unavailable.

The source path is scoped for the same reason as the document: it is repository relative, so two
repositories both holding `scenarios/example.yaml` are two different files under one string, and the
edited-on-disk path resolves that string against whichever root is asking.

### 3. The results are scoped too, on a column that was already there

`scenario_result` stamped `project_id` on every row and the query did not use it. A goal is judged from the
newest result of the scenario its plan reruns ([ADR 0017](0017-a-goal-is-judged-against-the-same-work-twice.md)),
so a result read across projects decides a goal in one repository from a run recorded in another. Scoping
the scenario and leaving its results unscoped would have been half a sentence.

## Consequences

**The store schema version becomes 3, and that is one way.** An older Orchescope build opening a store this
one has written refuses it: "The store is at schema version 3 and this build understands 2", with the
remediation already in place. That is the existing contract for a forward-only migration and it is the cost
of the fix.

**A copied repository sees none of the original's scenarios, by design.** Before this it saw all of them
and could run them. After it, the copy's next `audit` rediscovers whatever scenario files it actually has
and stores them under its own project. Nothing is lost that the copy declared.

**Three store methods changed signature**, and the fake stores in `packages/usecases/test` did not fail to
compile when they did, because each test wrote its own object literal of lambdas behind an `as never` cast.
Only the runtime assertions caught them, in four tests, none of which named the cause. **That has since
been fixed**: those tests now share one store double written against the real `Store`, and one set of
document builders with nothing cast in them. Re-running this change's signature edit against that double
produces both a compile error and a runtime failure naming the project identifier arriving where a run
identifier was expected.

## What the measurement said

All five falsifier conditions were met.

The end-to-end case fails on the tree before this change with "a repository with no scenario file loaded
one from another repository", and passes after it: the copy is refused with "No scenario named example. Add
a scenario file under scenarios/ in this repository", while the declaring repository still runs its own and
passes. The store-level case fails on the old tree through `listScenarios`, whose signature this change does
not touch, with "saving under the second project overwrote or hid the first project scenario". The three
cases that exercise the new signatures are labelled guards and are not counted, because a call shape the old
tree does not have discriminates nothing.

**Upgrade, measured on a populated store written by the previous build.** Version 2, one scenario, one
result, one run. Opened with this build: version 3, one scenario, one result, one run,
`PRAGMA integrity_check` ok, `PRAGMA foreign_key_check` empty, the primary key composite, and the audit
still reporting the scenario.

    pnpm check              exit 0, 13 documents, 532 modules and 2396 dependencies cruised
    pnpm test               1797 pass, 0 fail, 381 suites
    pnpm test:metamorphic   591 pass, 0 fail, 113 suites
    pnpm test:e2e           234 pass, 0 fail, 52 suites
    pnpm corpus             48 matched, 0 differing, 0 not measured, 8 skipped

## What would reverse this

**A scenario that is deliberately shared between repositories.** Nothing supports one today, and a
federated system joins graphs rather than scenarios. If sharing ever becomes a thing the product does, the
identity has to become explicit rather than implied by a table key.

**Another author-chosen identifier keyed globally.** This record is about one table because one table had
the property. `runById` and `findingById` are unscoped too and are safe only because their identifiers are
minted from content. If anything ever mints one of those from a name, it inherits this defect and this is
the record that says what it costs.
