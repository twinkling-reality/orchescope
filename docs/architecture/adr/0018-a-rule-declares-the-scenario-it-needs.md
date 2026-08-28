# ADR 0018: A rule declares the scenario it needs as data, and the product composes it

- Status: accepted
- Date: 2026-08-28
- Deciders: repository maintainers

## Context

Three rules refuse to let a goal be cut until the repository has a scenario that could decide it, and each
one wrote the search for that scenario out longhand as a `context.scenarios.find`, with a second, separate
sentence beside it explaining what was missing. One rule stated twice is two answers, and the drift had
already happened: `prompt-injection-boundary` accepted a fault aimed at `*`, at the component identifier
and at both of its names, while `retry-around-non-idempotent-operation` accepted neither `*` nor the
identifier. Nothing anywhere argued for either reading.

The second half was worse. When no scenario satisfied the predicate the finding **dropped**
`suggestedExperiment` entirely and left prose, so the one case where a reader needs the specification of a
scenario, the case where no such scenario exists, was the case that withheld it.

And the product could not produce one. `orchescope init --scenario` wrote a static template with
`faults: []`, one `exit_code` evaluator and a commented out `expect` block, which satisfies no rule's
predicate, so moving it verbatim left every scenario gated finding exactly as ineligible as before.

**Measured over all 56 pinned repositories, one audit each in a copy-on-write clone.** 101 findings, 19
goal eligible, **12 findings gated on a scenario in 12 repositories, none eligible, none carrying a
suggested experiment, none stating what a scenario would have to contain**. Four of those repositories had
no goal eligible finding at all: `crewai`, `openai-cs-agents-demo`, `openai-cs-agents-demo-exercised` and
`job-hunter`.

## Falsifier stated before this record was written

Reject this record unless all of these hold.

1. A finding ineligible for want of a scenario carries a machine readable statement of the scenario that
   would satisfy it, naming the fault kind, the resolved target and the evaluators.
2. A scenario the product composes from that statement, with only `target.command` supplied by a person,
   makes the finding goal eligible.
3. A rule that declares such a statement and has no repository proving both of the above fails a check.
4. A requirement no file can satisfy is carried and named rather than skipped.
5. The template never offers a command without saying what decides whether it can be a target.
6. The corpus does not move, and no finding's eligibility moves.

## Decision

### 1. The predicate is data, declared on the rule beside its remediations

A `ScenarioRequirement` names the fault kinds any one of which satisfies it, the spellings the audit
resolved for what the fault is aimed at, the evaluator kinds the scenario must all declare, whether
`expect.prohibitedEffects` must name an effect, and, where the rule is about recorded work rather than a
declaration, the scenarios its evidence belonged to.

The constant clauses live on the rule, in the same place and for the same reason `remediations` does: so a
check enumerates the promises rather than being handed a list. The resolved names are bound at evaluation
through one function, so a rule cannot search for a fault kind it did not declare.

The matcher and the sentence that says what is missing live in `@orchescope/domain`, because the composer
that writes the file is in `workspace` and the search that reads it is in `findings`, and a composer that
disagrees with the search writes a file the rule then refuses.

### 2. Where the two rules disagreed, the wider reading wins

A fault aimed at `*` satisfies any fault clause, because the schema defines `*` as every match and a fault
aimed at everything is aimed at this component too. The component identifier is accepted alongside both
names, because the identifier is the spelling a prior audit's `--json` handed the operator. A refusal of a
name this product itself printed is a refusal nobody can act on.

### 3. A rule about recorded work carries a requirement no file answers, and says so

`duplicate-side-effect` asks which repeatable set the run that produced its evidence belonged to. Nothing
written into a file satisfies that; only a run does. The clause is carried anyway and the composed file
names the finding with what would satisfy it, because a requirement skipped in silence leaves the finding
that asked as the one thing the file does not explain. **No content clause was added to that rule.** It
has never asked what a scenario declares, and inventing one here would change a shipped answer on no
evidence.

### 4. The finding carries the requirement when it is unmet, and names the command that writes one

`Finding.scenarioRequirement` is present exactly when the rule wanted a scenario and found none, so
presence is the machine readable form of "ineligible for want of a scenario". `goalReason` is generated
from the same record, in the schema's own vocabulary, so the sentence a reader acts on cannot drift from
the predicate that decided them. `suggestedExperiment` stops being dropped: on the unmet branch it names
`orchescope init --scenario`, which is the command that now writes the scenario the finding is asking for.

### 5. `init --scenario` composes, and branches on no rule identifier

The command reads the requirements the last audit's findings carry and hands them to the workspace as
data. Everything the composer writes comes from a requirement: the faults, the evaluators, the expectation
and the note naming what it could not declare. If a branch per rule is ever needed, the requirement is not
carrying enough and the requirement is what changes.

**The effect the composed expectation forbids is this build's own word**, written into the injected
instruction in the same file, so the instruction the fault injects asks for exactly the effect the
expectation forbids. An effect kind is a word the target writes, so nothing an audit reads supplies one,
and a plausible invented kind would forbid something nothing ever records. The file says what makes that
expectation decide and what leaves it undecided.

### 6. The template states what decides a command it offers, because no evaluator can

A target that does not exit is stopped at `target.timeoutMs` and recorded `timeout`, and
`everyRepetitionPassed` requires `completed` before it consults a single evaluator. So a long running
server fails whatever evaluator the scenario declares, and changing the evaluator with the candidate, which
was the other option considered, does not exist. Nothing this build reads says which of a repository's
declared commands exits on its own, and running one to find out is what candidate discovery exists not to
do, so the template asks the question and states the consequence rather than guessing.

### 7. Eligibility stays a static read of the file, and the trap it opens is already closed one layer down

A four line unrunnable scenario satisfying a predicate flips `goalEligible`. Run end to end: without a
recorded run, `goal create` refuses outright, because these rules require runtime evidence. With one, the
goal is cut and carries **one** acceptance criterion, a static rescan; it names no validation scenario,
prescribes no rerun, and records `comparisonUnavailable` saying the runs that exercised the components
belong to no scenario.

That is [ADR 0017](0017-a-goal-is-judged-against-the-same-work-twice.md) working as decided: what a goal is
judged against is chosen from recorded execution, and an unrunnable scenario has no recorded execution.
Eligibility is a claim that a bounded change exists and a check exists which could decide it, not a claim
that anybody has run anything.

**What was deliberately not done about it.** A finding could say whether the scenario it matched has ever
run. It does not, because the only run population a rule may read is the window the audit reconciled, and
"never run" derived from a bounded window is a claim about the window presented as a claim about the
repository.

## Consequences

**One schema document gains an optional field and its version does not move.** `Finding` gains
`scenarioRequirement`. Optional additions need no migration, which is the reasoning
[ADR 0016](0016-two-proofs-of-a-source-location.md) applied to the content proof and ADR 0017 applied to
`ComparisonSide` and `ValidationPlan`.

**`prompt-injection-boundary` searches against the sources its finding names rather than every source in
the graph.** It used to range over all of them while the document listed at most five, so eligibility could
turn on a source the reader was never shown. A scenario faulting a source outside that list still satisfies
the requirement by aiming at `*`.

**A grouped finding states the requirement of its first instance**, which is already how `goalEligible`,
`goalReason` and `suggestedExperiment` behave under grouping. Made visible rather than introduced.

**`@orchescope/workspace` gains a development dependency on `@orchescope/scenarios`**, for one test that
composes a file, parses it with the real parser and asks the real matcher whether it satisfies the
requirement it was composed from. That pair is exactly what drifts, and the round trip is what stops it.

**A new check enumerates the rules that declare a requirement**, in the shape
`tests/e2e/goal-eligible-rules.test.ts` uses for remediations, so a rule that starts gating a goal on a
scenario with no repository behind it fails rather than passing quietly.

## What the measurement said

All six falsifier conditions were met.

Over all 56 pinned repositories, one audit each in a clone, before and after:

    findings                    101 -> 101
    risks                        99 -> 99
    goal eligible                19 -> 19
    scenario gated findings      12 -> 12,  eligible 0 -> 0
    carrying a requirement        0 -> 12
    carrying a suggested experiment for a gated finding   0 -> 12
    findings whose identity or eligibility moved          0

Then, in each of the 12 repositories whose findings asked for a scenario: `init --scenario` composed one in
**12 of 12**, and filling in only `target.command` and moving the file made the finding goal eligible in
**12 of 12**, with none still asking.

`pnpm corpus` is unmoved: 48 matched, 0 differing, 0 not measured, 8 skipped; 1588 of 1588 semantic
assertions; 88 of 88 injected shapes; 87 recognition names, 78 matched.

**End to end on a real repository, driven keyless.** On a copy of the pinned `openai-agents-js` checkout:
the audit reported `prompt-injection-boundary` ineligible, naming `orchescope init --scenario` as the
experiment; that command composed a scenario declaring the `prompt_injection_in_content` fault at a
resolved tool, the `no_duplicate_effects` evaluator and the prohibited effect; only `target.command` was
filled in, pointing at a driver that supplies the model through the SDK's own `setDefaultModelProvider`;
the rescan reported the finding goal eligible; and the scenario ran, three repetitions, all passing, with
no credential anywhere.

**What that run did not decide, reported because the composed file says it in advance.** `faultsApplied`
was empty and `sideEffects` was zero: the target implements no cooperative fault protocol, so the injection
was never delivered, and the prohibited effect expectation passed over an empty population. The scenario is
real, runnable and decidable; the boundary question is what it did not answer, and the file said so before
anybody ran it.

## What would reverse this

**A rule whose requirement needs a clause this record's shape cannot express.** The composer branches on no
rule identifier, and the moment it has to, the declaration is not carrying enough. The fix is the
declaration; a special case in the composer is the failure.

**The composed expectation being taken for a boundary test.** It forbids a word this build wrote, and on a
target reporting no effects it decides nothing. If operators start reading a passing composed scenario as
evidence that injection was refused, the expectation has to become something the product can only write
from recorded evidence, or not be written at all.

**Eligibility mattering more than it does.** The defence in decision 7 rests entirely on ADR 0017 choosing
what a goal is judged against from recorded execution. If that ever loosens, a static read of a YAML file
becomes a route to a banked criterion, and eligibility has to start asking for a recording.
