# Finding lifecycle

A finding is a claim about a system that a reader is expected to act on. Everything in this path exists to make that claim
either supportable or absent.

```
rule ──► outcome (fired | clear | insufficient_evidence | not_applicable)
             │
             ▼
          drafts ──► evidence check ──► severity cap ──► identifier ──► finding
                          │                                                │
                          └──► dropped, and the drop is recorded           ▼
                                                              conflict linking, sorting
```

## Rules

A rule owns one question, declares the category it reports under, and returns one of four outcomes:

- **`fired`**, with drafts. Something was found.
- **`clear`**, with a reason. The rule ran, had the evidence it needed, and found nothing. This is a result, and the report
  shows it.
- **`insufficient_evidence`**, with what was missing. The rule could not decide. This is not the same as clear, and
  conflating the two is how a tool implies safety it never established.
- **`not_applicable`**. The rule does not apply to this system at all.

The four families of rules are:

| Family | Reads | Examples |
| --- | --- | --- |
| Reconciliation | the four deltas | a duplicated side effect; a declaration contradicted by behaviour; a component declared and never exercised |
| Static policy | the graph alone | a retry around an operation with no established idempotency; a model call with no declared timeout; a component nothing can reach; a prompt that interpolates untrusted input |
| Runtime | ingested runs | sequential independent calls that could have overlapped; repeated context across steps; a loop that did not converge |
| Experiment | benchmarks and chaos reports | an agent count that costs latency without improving success; throughput that stops rising with concurrency; behaviour under one injected fault |

## Categories

`architecture`, `performance`, `cost`, `reliability`, `resilience`, `security`, `permissions`, `agent_complexity`,
`maintainability`, `scenario_coverage`, `observability`. A finding also carries a **polarity**: `risk` or `strength`.

Strengths are not decoration. A report that lists only problems tells a reader nothing about what to preserve, and a
reviewer who has just been handed twenty risks needs to know which parts of the design are load bearing and working. A
strength is always `info` severity and appears in its own section.

## Every finding carries its support

- **`components`** and **`edges`** it is about, by identifier. A finding attached to nothing is refused by an invariant.
- **`evidence`**, identifiers of records that support it. A draft with no evidence is dropped, and the drop is recorded as
  an `insufficient_evidence` outcome so the omission is visible rather than silent.
- **`basis`**: `observed`, `discovered`, `inferred`, `estimated`, `simulated` or `model_interpreted`.
- **`confidence`**, from the banded set, so numbers mean the same thing across rules.
- **`metrics`**, each with a value, a unit, a sample size, a basis and optionally the baseline it is compared against. A
  number with no sample size is not reportable.
- **`sourceLocations`**, so a reader can open the file.
- **`recommendation`**: what to change, in ordered steps, with an effort and a risk estimate.
- **`suggestedExperiment`**: the command that would confirm the problem or the fix, and the signal to look for.
- **`goalReadiness`**: whether this finding can become a bounded goal, and if not, why. A finding needing a design
  decision or more repetitions says so instead of offering a button that produces a bad goal.
- **`taxonomy`**, references into published catalogues where one applies.

## Severity is bounded by what supports it

A rule proposes a severity. The engine lowers it until the basis and the confidence can carry it, and records why.

**Ceiling by basis:**

| Basis | Highest severity it can reach |
| --- | --- |
| `observed` | critical |
| `discovered` | critical |
| `simulated` | high |
| `inferred` | high |
| `estimated` | medium |
| `model_interpreted` | medium |

**Floor by confidence:** critical needs at least `0.90`, high `0.75`, medium `0.60`, low `0.40`.

So a rule that infers something at `0.6` confidence and proposes `critical` produces a `medium` finding carrying
`severity-capped` and the reason. An inference cannot be dressed as an observation, and a low confidence claim cannot be
made loud by asserting it more strongly.

## One pattern is one finding

A rule that fires on every instance it sees produces a report nobody reads: `openai/openai-agents-python` produced 439
findings, 211 from one rule and 193 from another, and a `low` finding repeated 193 times buries every `high` one under
it. A draft therefore names the pattern it is an instance of, and drafts from one rule that name the same pattern become
one finding with the occurrence count, the affected components and the sites.

Nothing is dropped silently. The component list stops at twenty five, and the number withheld is stated in the
explanation and carried as a metric with its sample size, because a list that stops without saying so reads as a
complete list. The same repository now produces eight findings, and the count of two hundred is in the title of one of
them rather than in the length of the report.

## Identifiers, ordering and conflicts

Identifiers are `OSC-<CATEGORY>-<NNNN>`, assigned from a deterministic ordering of drafts, so the same scan produces the
same identifiers and a goal can reference one. Findings are then sorted by severity, then risks before strengths, then
whether the finding can become a bounded goal, then how much of the system it touches, with identifier order as the tie
break. That order is what a person should read them in, and it is deterministic, so report output stays byte for byte
reproducible.

When two rules disagree about the same component in the same category, the conflict is recorded on both findings rather
than one being dropped. A reviewer needs to see that two rules disagreed; silently keeping one is how a report becomes
confidently wrong.

## Model produced findings

Model based analysis is off by default. When it is enabled, anything a model proposes is reviewed before it can become a
finding: it must cite evidence that exists, its claim must be about components that exist, and its severity is capped by
the `model_interpreted` basis. A proposal that fails review is discarded, and the fact that it was discarded is recorded.

## Where to look

- `packages/findings/src/rule.ts`: the outcome types.
- `packages/findings/src/engine.ts`: evidence checks, severity capping, identifiers, ordering, invariants.
- `packages/findings/src/grouping.ts`: the collapse of many instances into one finding, and the withheld count.
- `packages/findings/src/rules/`: the four families.
- `packages/domain/src/severity.ts`: the caps.
- `packages/findings/src/review.ts`: conflict linking and model review.
- [../protocols/finding-schema.md](../protocols/finding-schema.md): the document, field by field.
