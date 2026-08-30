# The judge

Design written before product code. It answers the losing Round 3 in
[orchescope-against-an-agent.md](orchescope-against-an-agent.md): Orchescope must not ship as “an agent
that audits.” The only remaining bet is a deterministic, agent-callable verifier of whether a change
**improved**, **left unchanged**, or **regressed** an agent system, judged against the same work twice
([ADR 0017](../architecture/adr/0017-a-goal-is-judged-against-the-same-work-twice.md)).

Nothing here re-derives Round 1–3 measurements. Detection breadth is conceded to the coding agent unless a
new measurement overturns Round 1. This document decides what to build, what to stop claiming, and what
falsifies the bet.

## What failed last time (one paragraph)

Round 3 decided the product. On `email-agent` a static audit produced one info finding
(`observability-coverage`) that `goal create` refuses as an operator next step, so Orchescope emitted no
verdict while the agent labelled improve / noop / regress correctly. On `openai-agents-js` the only
goal-eligible finding was `model-call-without-timeout`; the printed plan was `audit` → `goal validate`,
decided solely by static `finding_resolved`. A real attempt inside the write scope moved the grouped title
count 6→4 and still failed AC-01 (the openai-agents adapter never puts `timeoutMs` /
`timeoutDeclaredAt` on Agent `invokes_model` edges). Comment-only and added-agent clones also failed AC-01
with the same text. Binary presence of the finding cannot separate those three. Round 2 separately recorded
that audit JSON is not byte-identical (`durationMs`, fresh ids) while finding **content** is stable after
those volatiles are stripped.

## What “the judge” means

The judge is the function that, given a **baseline** and a **candidate** that claim to be two executions of
the same work, returns exactly one of:

| verdict | meaning |
| --- | --- |
| `improved` | the candidate is better on the dimensions under judgement, with no regression those dimensions care about |
| `unchanged` | nothing under judgement moved enough to call |
| `regressed` | at least one judged dimension got worse |
| `mixed` | improvements and regressions both present |
| `insufficient_evidence` | the two sides are not comparable, or neither side supplies a decidable signal |

That vocabulary already exists on `Comparison` (`packages/schema/src/comparison.ts`). It is **not** what
`goal validate` returns today. Validate collapses every criterion into a boolean `validated`, so three
distinct worlds that all leave AC-01 unsatisfied print the same failure. The no-op is decisive: a side that
calls the no-op an improvement has failed; a side that cannot tell the no-op from a regression has also
failed.

The judge is **not**:

- a broader static scanner, more adapters, or a bid to beat an agent on finding count
- “MCP so agents can audit”
- a claim that prompt injection, chaos, or agent execution is safe
- a binary gate that only says whether one finding disappeared

## Architecture

### J1. One surface: comparison is the verdict; goals point at it

Today:

- `orchescope compare` / `compare_runs` already produce `ComparisonVerdict` from **metrics**, and optionally
  attach `findingDelta` that does **not** feed the verdict.
- `goal validate` / `validate_improvement_goal` ignore that vocabulary and answer only `validated: boolean`.
- A static-only goal (no recorded scenario under ADR 0017) banks only `finding_resolved` and prints a plan
  that cannot distinguish scale-down, no-op, and scale-up of the same grouped finding.

Required:

1. **Scan-to-scan comparison is first-class same work.** Two audits of the same repository root, with no
   scenario in play, are two executions of the audit work. They already share a project once the store is
   the clone’s; the missing piece is a verdict driven by findings (and graph, where useful), not only by
   run metrics.
2. **Finding delta must drive the static verdict, and must see scale.** Identity alone
   (`findingsShareIdentity`) treats Round 3’s 6→4 / 6→6 / 6→7 as three “unchanged” findings: the grouped
   `model-call-without-timeout` occurrence key does not include the count. The judge reads, for each
   shared identity, the stored occurrence / subject scale (the `occurrences` metric grouping already
   writes, plus severity). Dropping scale without introducing a worse finding is `improved`; equal scale
   is `unchanged`; rising scale or a newly introduced risk is `regressed` (or `mixed` when both happen).
3. **Metric comparison stays ADR 0017.** When a goal’s plan names a baseline scenario result and the
   candidate reruns the same scenario / variant / fault plan, metric deltas decide as they do today.
   Conditions that differ still refuse metric criteria and report limitations; they do not invent a
   regression.
4. **`goal validate` reports the comparison verdict as its primary answer.** The boolean `validated`
   remains as “every acceptance criterion is satisfied” (full clear of `finding_resolved`, metric floors
   met, scenarios passed). Agents and the release gate score the **verdict**, not the boolean. The printed
   plan must name the command that produces the verdict (compare of baseline scan vs latest scan, or
   compare of baseline run vs latest under the named scenario) so an operator following the plan does not
   need a side channel.
5. **MCP exposes the same document.** Prefer extending `validate_improvement_goal` (and/or `compare_runs`)
   so the structured payload carries `verdict` + `verdictReason` + `findingDelta` / `metricDeltas`. Do not
   add a parallel “audit for agents” tool surface.

### J2. What a static goal’s plan must print

When `comparisonUnavailable` would previously leave only `audit` → `goal validate`:

```
orchescope audit --json
orchescope compare <baselineScanId> latest --goal <id>
orchescope goal validate <id>
```

`goal create` freezes the baseline scan id into the validation plan (same role `baselineRunIds` already
plays for runs). `latest` means the newest completed scan for the project after the post-change audit.
Validate refuses to claim `validated` on an undecided criterion, and additionally surfaces the comparison
verdict so three failures of AC-01 are three different documents when the finding’s scale moved.

When ADR 0017 evidence exists, the existing plan shape (audit → test scenario → compare runs → validate)
stays; the validate document must still lead with the comparison verdict.

### J3. Eligibility and subjects the judge can see

Round 3’s `email-agent` failure was not a missing feature of `goal validate`; it was a subject with no
goal-eligible finding and no Orchescope-visible delta for the planted application changes. The judge does
not invent detection. Consequences:

- **Do not cut goals from operator-next-step findings** (`observability-coverage` without runs, design
  topology, and the other `goalEligible: false` reasons). That refusal stays.
- **Measurement subjects for the re-run must be repositories where Orchescope already emits a signal the
  planted changes can move.** Prefer two third-party corpus entries with at least one goal-eligible risk
  finding on a static audit. `email-agent` is not such a subject for the planted confirmation/trash
  changes; replacing it for the re-measurement is honesty, not moving the goalposts past the
  pre-registered losing conditions. The prior run’s email-agent result stands as evidence that the judge
  cannot answer questions outside its measured dimensions.
- **Adapter honesty is in scope only where a remediation the product prints cannot clear the finding it
  names.** On `openai-agents-js`, either the openai-agents adapter learns the timeout spellings the
  remediation describes, or that rule stops claiming a closable static goal on edges it cannot observe.
  The judge’s ternary scale verdict must work even when the finding is not fully cleared; fixing the
  adapter is required before claiming “satisfied `finding_resolved`” on that repository, not before
  claiming the three-way distinction.

### J4. Reproducibility (Round 2 defect)

Any claim that audits are reproducible must either:

- produce byte-identical `--json` across identical inputs, or
- document the volatile fields and exclude them from the claim.

Volatiles already observed: `durationMs` (and sibling timings), fresh scan / report / evidence / finding
display ids where identity is semantic. The stable core is rule id, polarity, severity, semantic subject,
occurrence scale, and evidence counts. The judge’s finding comparison keys on semantic identity and
scale, never on display ids. `auditFingerprint` in `@orchescope/domain` strips those volatiles for
tests and measurement claims.

### J5. What is deleted or stopped claiming

Stop claiming, in README / human docs / MCP descriptions that imply it:

- Orchescope as the thing you ask instead of a coding agent for **breadth of static audit**
- That `goal validate` alone answers improve / noop / regress when it only printed a boolean
- That a remediation clears a finding on a framework edge the adapter does not read

**Adapter honesty (step 5), decided under contact.** Joining every `new OpenAI({ timeout })` in a
module onto every Agent string-model `invokes_model` edge would clear edges the Agent does not use.
That join was refused. The client remediation now states that a sibling client timeout does not clear
an Agent string-model edge, and that clearing means removing the untimed pin or invoking through a
client call this build reads a deadline on. The judge’s scale verdict still separates improve / noop /
regress when the grouped finding’s occurrence count moves without a full clear.

Out of scope for this build (do not start):

- New discovery adapters aimed at Round 1 breadth
- Browser or second UI
- Making `observability-coverage` goal-eligible
- Silent downgrades when comparison conditions differ

Keep:

- The declare / exercise join (substrate the judge needs when runs exist)
- ADR 0017 / 0018 machinery (baseline selection, scenario requirements, composition)
- MCP as the agent invocation path for the **same** judge document the CLI prints
- Corpus and e2e gates in `AGENTS.md`

## Implementation sequence (separable)

Each step has a falsifier. No step expands static detection breadth.

| step | change | falsifier |
| --- | --- | --- |
| 1 | Freeze baseline scan on static goals; plan prints `compare <baselineScan> latest` | A static goal’s plan names a baseline scan; validate without a post-create candidate comparison cannot claim a three-way verdict |
| 2 | Occurrence-/severity-aware finding judgement feeds `ComparisonVerdict` when metrics are absent or empty | Constructed baselines: scale-down → `improved`, equal → `unchanged`, scale-up or new risk → `regressed`; identity-only delta must **not** call Round-3-shaped inputs `unchanged` for all three |
| 3 | `goal validate` JSON and MCP carry `verdict` (from the prescribed comparison) alongside `validated` | Three fixtures that all fail `finding_resolved` produce three distinct verdicts |
| 4 | Document volatile audit fields; fingerprint helper excludes them | Three audits of an unchanged clone: raw MD5s may differ; fingerprints equal |
| 5 | Adapter or eligibility fix for `model-call-without-timeout` on openai-agents | Either a timeout declared in a spelling the adapter reads clears the edge, or the finding is not goal-eligible on those edges |
| 6 | Re-measure Round 3 protocol on ≥2 third-party corpus clones (not `apps/demo` except smoke) | See falsifier below |

## Falsifier for the product bet

Pre-register before the re-measurement runs (prompts verbatim from
[orchescope-against-an-agent.md](orchescope-against-an-agent.md) Round 3 agent prompt; Orchescope follows
only its printed plan).

On each of ≥2 third-party corpus entries, three separate COW clones (`cp -Rc` out of `corpus/.cache`;
never audit inside the cache):

1. a real improvement Orchescope’s own dimensions can see
2. a no-op (comment-only or equivalent)
3. a regression Orchescope’s own dimensions can see

**Orchescope passes** only if, for every repository, the verdict from the prescribed plan is `improved` /
`unchanged` / `regressed` respectively (or an equivalently distinct ordered triple that does not call the
no-op an improvement). The no-op is decisive.

**Release** only if that Orchescope pass holds **and** audit reproducibility is byte-identical or the
volatile fields are documented and excluded from any measurement claim.

**Do not release — keep building** if the verdict surface is correct in tests but the third-party
re-measurement fails for a fixable reason (plan not followable, baseline scan not frozen, adapter still
lying).

**Abandon** if, after the implementation above, a coding agent still distinguishes the three and
Orchescope’s prescribed verdict does not, on the chosen third-party subjects — or if neither side
distinguishes the no-op from the improvement.

No “both have strengths.”

## Measurement appendix (to be filled after the build)

See [the-judge-measurement.md](the-judge-measurement.md). Closing word from that run: **release**
(narrowed to the judge; detection breadth still conceded).
