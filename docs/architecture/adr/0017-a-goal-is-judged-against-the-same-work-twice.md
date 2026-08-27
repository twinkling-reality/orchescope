# ADR 0017: A goal is judged against two executions of the same work, and where it cannot be, it says so

- Status: accepted
- Date: 2026-08-27
- Deciders: repository maintainers

## Context

The improvement loop ends in a comparison: a finding becomes a goal, somebody changes the code, the goal's
plan reruns something, and the difference between before and after decides whether the change worked. That
last step is the product's claim, and it rested on two rules that shared no input.

The baseline was the newest completed runs in the project, whatever they were, sliced to three. The
scenarios the plan would rerun came from matching a scenario's tags against the finding's tags and against
substrings of its component identifiers, falling back to every scenario in the project when nothing
matched. Neither rule could see the other, and nothing checked that what the plan reran was what the
baseline recorded.

**Run end to end, that produced a comparison of two different things and reported it as a result.** On the
demonstration system, the plan the product printed for `independent-calls-run-sequentially`, followed
verbatim, compared a `support-desk` recording against a `support-desk-faults` rerun under fault plan
`fp_5cab10f8c615cb56`. It returned `regressed`, with `successRate 1 -> 0` and
`totalTokens 1395 -> 394 improved`. The first is the failures that scenario exists to inject and the second
is a smaller task doing less work. The comparison document's limitations mentioned neither. An operator who
changed nothing was told their goal regressed.

**The name matching was measured and refused.** Evaluating the shipped clause verbatim over all 56 pinned
repositories, using the vocabulary a real audit produces (101 findings, 371 distinct component identifiers,
10 distinct finding tags), and giving the rule the most favourable input it can have, a scenario tagged with
the exact name of a component the finding is about: **20.4 per cent of the matches it makes inside one
repository are wrong**, in 15 of the 50 repositories that have findings, and **63.6 per cent across the
corpus vocabulary**. The tag `agent` matches 57 of 101 findings while being about 6. On the demonstration
system the matching never fires at all: three goals cut from three findings with disjoint tags received the
identical three scenarios, because the fallback returned everything.

**The join needed already existed.** The audit writes, per run, which graph components that run executed
(`packages/usecases/src/audit.ts`, `saveComponentMetrics`), keyed by the same identifiers `finding.components`
uses. Asking it backwards answers "which recorded work is this finding about" from execution rather than
from names, and it discriminates: on the demonstration store, `support-desk` covers six of six components
the finding names and `support-desk-faults` covers three, because its injected faults stop the run.

## Falsifier stated before this record was written

Reject this record unless all of these hold.

1. A goal's plan names a baseline recorded from the same scenario its own commands rerun last.
2. A scenario recorded exercising the components is preferred over one sharing every tag and exercising
   none of them.
3. A baseline of one repetition yields no criterion about a distribution, and still yields the one decided
   by presence.
4. A comparison whose sides ran different scenarios, variants or fault plans says so in its limitations.
5. A metric criterion is not decided from such a comparison.
6. The corpus does not move.

## Decision

### 1. Which recorded work a goal is about is decided by execution, and by nothing that reads like a name

The store is asked which completed runs recorded a component metric for a component the finding names, and
how many of them each run covered. That is one scoped query answered from an index, not a window over
recent runs. Component identifiers are graph identifiers, so no framework name, tag or scenario name enters
the rule at any point.

**Coverage ranks before recency.** A run that touched one of six named components and a run that touched all
six are both matches, and preferring the more recent would choose a baseline measuring a sixth of the thing
being changed.

### 2. The baseline is a recorded scenario result, whole, with the conditions it was recorded under

A `ScenarioResult` is already the coherent unit: one scenario, one environment, its repetitions kept
together. It is also what a named run resolves back to on the comparison, so naming one of its runs on the
printed command reassembles the set without new grammar.

A result whose repetitions disagree about the variant or the fault plan is not one condition and is refused
rather than described by whichever repetition happens to be first. The conditions travel with the plan, so
the document states what the comparison holds fixed instead of leaving a reader to recover it from run
identifiers.

### 3. Conditions are required for selection, reported for a comparison, and refused at judgement

Three layers, because they are three different failures.

- **Selection requires them.** A goal's baseline and the candidate its plan produces are the same scenario,
  variant and fault plan.
- **The comparison reports them.** `orchescope compare A B` is a general tool and comparing two different
  things on purpose is a thing a person may legitimately want. What they must not get is silence, which is
  what produced the measured defect.
- **The judgement refuses to decide from them.** A metric criterion is decided only by a comparison whose
  sides describe the same work. This is the layer that protects the verdict, because it is the only one an
  operator typing commands by hand cannot route around, and it is what lets the plan rely on ordering for
  `latest` without that being a silent hazard: a plan run out of order produces a comparison that says its
  sides differ and a criterion that stays undecided, rather than a regression nobody caused.

An absent condition claims nothing and blocks nothing. A side that reports none is not evidence that its
runs agreed.

### 4. The sample floor belongs to the criterion, not to the comparison

`compareMetric` refuses a direction below three samples a side, and no selection rule can manufacture
samples nobody recorded, so the floor is asked before a criterion is written rather than discovered after
an operator has run everything.

**But not of every criterion.** A metric counting something that must not happen at all is decided by
presence: an effect that happened once and now happens never is a categorical change, not a claim about a
distribution. Gating those on the floor withdrew the criterion the improvement loop most often closes on
from the one scenario shape that produces it. So reachability asks whether the two sides describe the same
work, and the floor is asked separately of the criteria that are claims about distributions.

A goal whose baseline is below the floor therefore states the criteria that can be decided, prescribes the
command that decides them, and says in its own document that the baseline supplies fewer samples than a
direction needs, so the terms it does not state are accounted for rather than merely absent.

### 5. Where there is no comparable pair, the plan says which question failed

A repository with no scenario, a finding whose components nothing exercised, exercising runs belonging to no
scenario, a scenario with no result recorded under one set of conditions. Each has a different remedy, and
the note that said only "no baseline run was recorded" sent every reader after a run when some of them
needed more repetitions of the one they had.

## Consequences

**Two schema documents gain optional fields and neither version moves.** `ComparisonSide` gains
`scenarioId`, `variantId` and `faultPlanId`; `ValidationPlan` gains `baseline` and `comparisonUnavailable`,
with the invariant that exactly one of the two is present. Optional additions need no migration, which is
the same reasoning [ADR 0016](0016-two-proofs-of-a-source-location.md) applied to the content proof.

**One database migration, forward only.** `component_metric`'s primary key is `(run_id, component_id)`,
which cannot answer a question asked with a component and no run. Version 2 adds an index on the component.

**`baselineRunIds` now means what its schema comment always claimed.** It carries the runs of the comparable
result and nothing when there is none, so `CreateGoalInput` gains `exercisingRunIds` for the separate
question the `requiresRuntimeEvidence` guard asks. A goal whose finding rests on real recorded runs is not
refused merely because none of them forms a set large enough to compare against; that is a reason to omit
the metric criteria and say so.

**A repository with no runs gets a goal that names no scenario.** The rule this replaces named up to three,
because its fallback returned all of them. Nothing is lost: the goal document is not what tells an operator
to run a scenario. The loop's third step reports itself blocked with "written down, none has ever run" and
prescribes `orchescope test --scenario <id>` in the same terminal document, which is the surface that
advances the loop. A scenario that has never run is unknown rather than irrelevant, and running it is a
remediation rather than an acceptance criterion.

**[ADR 0015](0015-the-asymmetric-invariant.md) is strengthened rather than amended.** A name list was
removed from the runtime half and nothing replaced it, which is the direction that record asks for.

**The floor has one definition.** `MINIMUM_SAMPLES_PER_SIDE` and `metricDecidedByPresence` live in
`@orchescope/domain`, because `goals` cannot import `comparison` under the layering and two independent
threes are two numbers that can drift apart.

## What the measurement said

All six falsifier conditions were met.

Driven through the real command line on a copy of the demonstration system, the plan that previously
compared `support-desk` against `support-desk-faults` now names a baseline and a candidate that are both
`support-desk-duplicate` under fault plan `fp_543e36f62ddab59f`, three runs each side, with no
cross-condition limitation because there is no cross-condition. A comparison typed by hand across the two
scenarios reports "the two sides ran different scenarios, support-desk against support-desk-faults" and
"only the candidate side ran under an injected fault plan".

Against the tree before this change, the new tests fail as follows: the plan "compares a recording of alpha
against a rerun of beta"; scenario selection returns `['shares-every-tag']` where `['exercises-it']` was
required; a success rate criterion is "stated against one recorded sample". The tests asserting that like
against like is still compared, and still decided, pass on both trees and are guards.

`pnpm corpus` is unmoved: nothing here touches a discovery reader, an adapter, a matcher or a rule.

## What would reverse this

**A run whose component metrics were never written.** The whole rule rests on the audit having reconciled a
run, so a run recorded after the last audit is invisible until the next one. The plan's first command is
`orchescope audit`, which makes this self-correcting inside the loop, but a goal cut between a run and an
audit sees less than the store holds. If that gap ever matters more than the false matches it replaced, the
rule has to change rather than be widened.

**A repository whose scenarios all differ in conditions.** Requiring the conditions to match means a system
that never records the same scenario twice under one condition gets no comparison at all. That is the honest
answer today; if it turns out to be the common case rather than the rare one, the requirement is what to
revisit, not the reporting.

**A metric decided by presence that is not really.** The split between distribution and presence is what
lets a one-repetition baseline still carry a criterion. If a metric is added to that set whose zero
crossing is noise rather than a categorical change, this becomes a route to a confident claim on one sample,
which is the failure the sample floor exists to prevent.

**The environment being part of the conditions.** A baseline recorded on a loaded machine is weaker evidence
than one recorded on an idle one, and `RunEnvironment` records enough to tell. Conditions here mean the
scenario, the variant and the fault plan, and nothing about the machine. If timing comparisons turn out to
be dominated by that, the set of what counts as one condition is wrong.
