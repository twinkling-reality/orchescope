# Comparisons: every state

92 states across 36 blocks. 62 of them are reached by no report in `corpus/.cache/bundles`, so `pnpm states` will not show them to you and the fourth column says what would.

Source: `Comparisons screen (apps/web/src/sections/comparisons.tsx)`.

## Thresholds

| Constant | Value | Where | What it switches | Why that number |
| --- | --- | --- | --- | --- |
| `minimumSamplesPerSide (metric caveat floor)` | 3 | `packages/comparison/src/compare.ts:117 passing packages/domain/src/statistics.ts:84` | Below three samples on either side every differing metric is Indeterminate with `needs at least 3 samples per side, has X and Y`. At three or more the spread test decides and a direction can be claimed. | Taste, undocumented. The function's own default is five and compareMetric overrides it to three at the call site with no comment. |
| `meaningful difference ratio` | 2 times the combined standard error | `packages/domain/src/statistics.ts:108-117` | At or above two, the metric gets Improved or Regressed with no caveat. Below two it is Indeterminate and the caveat quotes the ratio to one decimal. | Documented as deliberately conservative: the comment states orchescope does not claim statistical significance and compares the difference of means against the pooled spread instead. |
| `limitation run-count floor` | 5 runs per side | `packages/comparison/src/compare.ts:273` | Below five runs on either side a sample size limitation is added and the refusal panel appears. At five or more on both sides that limitation is absent, and the panel can disappear entirely. | Taste, undocumented, and it contradicts the 3 used one file away for the per metric caveat, so a four run comparison shows directional verdicts while the panel says five runs are needed for one. |
| `incident metric zero boundary` | 0 | `packages/comparison/src/compare.ts:74-97` | For duplicateSideEffects, prohibitedSideEffects, policyViolations and userInterventions, a mean of zero on either side skips the sample size and spread tests altogether and returns Improved or Regressed with a presence caveat. Any other pair of values falls through to the distribution rule. | Documented at compare.ts:66-73: crossing zero on a metric counting something that must not happen is a categorical change decided by presence, not a statistical claim, because a duplicated payment that now happens never is not a sample size question. |
| `relative change divisor guard` | baseline mean === 0 | `packages/domain/src/statistics.ts:73-74` | A baseline mean of exactly zero omits relativeChange, so the Relative change cell reads muted `unknown` while Absolute change still shows a number. Four of demo-populated's nine rows are in this state. | Arithmetic: a ratio against zero has no value. Undocumented in the UI, so the cell reads as missing data rather than as an undefined ratio. |
| `empty-sample delta filter` | baselineSamples > 0 \|\| candidateSamples > 0 | `packages/comparison/src/compare.ts:268` | A metric with no samples on either side is dropped from the table entirely. A metric with samples on exactly one side is kept, and renders a row where two of the five value columns say `not measured` or `unknown`. | Taste, undocumented. It is what makes a scan against scan comparison produce zero rows and therefore the vacuous `every metric was indeterminate` limitation. |
| `stored comparison list limit` | 20 | `packages/persistence/src/repositories/experiments.ts:93,96` | Up to twenty comparisons reach the bundle, newest first. The twenty first and older are absent from the screen with no statement that anything was omitted. | Taste, undocumented at that call site, though the neighbouring latestComparisonForGoal comment at experiments.ts:102-111 argues explicitly about this limit hiding a goal's own comparison. |
| `default compared metric count` | 9 | `packages/comparison/src/compare.ts:190-200` | Fixes the metric delta table at nine rows for any run against run comparison, and the eyebrow count with it. No shipped caller overrides the list, so a wider or narrower table needs a new producer. | Taste, undocumented. The list omits costUsd, which is why the cost limitation at compare.ts:278 can never fire. |
| `navigation count visibility` | count > 0 | `apps/web/src/ui/shell.tsx:135,158` | A count appears beside `Comparisons` in the chrome only above zero; at zero it is omitted. | Documented at shell.tsx:118-123: a navigation of zeros reads as chrome while the screen itself refuses in a sentence that says more than a nought would. |

## Comparisons, whole screen

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| No comparison has been made <br> *load bearing* | `bundle.comparisons.length === 0` | `apps/web/src/sections/comparisons.tsx:161-177` | orchescope-discovery, flask, express, axios, demonstration-system, vercel-ai-chatbot, vercel-ai-chatbot-exercised, anthropic-quickstarts, langgraphjs, openai-agents-js, langgraph, crewai, openai-agents-python, pydantic-ai, pydantic-ai-exercised |
| The screen offers no control at all: no way to create, filter, sort or collapse a comparison, present or disabled <br> *load bearing* | `always; the only compare_runs capability control lives on the finding card, and the refusal panel offers a CLI command instead` | `apps/web/src/sections/comparisons.tsx:165-174 against apps/web/src/ui/finding-card.tsx:226-242` | every bundle |

## Comparisons, whole screen, under the document banner

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Refusal panel preceded by the repaired banner naming `comparisons` <br> *edge* | `the loaded document has no `comparisons` key or it is not an array, so it is defaulted to [] and `repaired` contains 'comparisons'; the screen then renders the same panel claiming no comparison was made` | `apps/web/src/bundle.ts:31,137-141 and apps/web/src/ui/shell.tsx:252-259 feeding comparisons.tsx:161` | **nothing here.** delete the `comparisons` key from a copy of corpus/.cache/bundles/demo-populated.json |

## Comparisons, block list

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A single comparison block <br> *load bearing* | `bundle.comparisons.length === 1` | `apps/web/src/sections/comparisons.tsx:180-282` | demo-populated |
| N fully expanded blocks stacked newest first, no index, no collapse, no filter, no per-block anchor <br> *load bearing* | `bundle.comparisons.length > 1; order is created_at DESC as the store returned it and the section applies no sort of its own` | `apps/web/src/sections/comparisons.tsx:181 and packages/persistence/src/repositories/experiments.ts:96` | **nothing here.** run `orchescope compare` twice in apps/demo, then regenerate the bundle |
| Only the newest twenty comparisons exist in the bundle and the screen does not say so <br> *edge* | `more than 20 comparisons stored for the project; listComparisons(projectId, limit = 20) caps the bundle and no ceiling sentence is rendered` | `packages/persistence/src/repositories/experiments.ts:93-100, consumed at packages/usecases/src/audit.ts:285` | **nothing here.** record 21 comparisons in apps/demo and regenerate |

## Chrome, Comparisons nav item

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Section name with a count beside it <br> *ordinary* | `bundle.comparisons.length > 0` | `apps/web/src/ui/shell.tsx:129,133,152` | demo-populated |
| Section name with no count <br> *ordinary* | `bundle.comparisons.length === 0` | `apps/web/src/ui/shell.tsx:133,152` | flask, langgraphjs, pydantic-ai, and every other bundle with no comparison |

## Comparison block, meta line

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Meta reads `Improved` <br> *load bearing* | `comparison.verdict === 'improved', which requires at least one improved metric, no regressed metric, and successRate not regressed` | `apps/web/src/sections/comparisons.tsx:187 and packages/comparison/src/compare.ts:236-239` | **nothing here.** compare five runs against five faster runs of the same scenario in apps/demo |
| Meta reads `Regressed` <br> *load bearing* | `comparison.verdict === 'regressed'` | `apps/web/src/sections/comparisons.tsx:187 and packages/comparison/src/compare.ts:210-215,230-235` | **nothing here.** compare a healthy baseline against the support-desk-faults runs already stored in apps/demo |
| Meta reads `Mixed` <br> *load bearing* | `comparison.verdict === 'mixed', at least one improved and one regressed metric with successRate not regressed` | `apps/web/src/sections/comparisons.tsx:187 and packages/comparison/src/compare.ts:224-229` | **nothing here.** compare two run sets where duration falls and token count rises |
| Meta reads `Unchanged` <br> *load bearing* | `comparison.verdict === 'unchanged', no improvement and no regression but not every metric indeterminate` | `apps/web/src/sections/comparisons.tsx:187 and packages/comparison/src/compare.ts:222` | demo-populated |
| Meta reads `Insufficient evidence` <br> *load bearing* | `comparison.verdict === 'insufficient_evidence', every metric delta indeterminate (including the case of no metric deltas at all)` | `apps/web/src/sections/comparisons.tsx:187 and packages/comparison/src/compare.ts:216-221` | **nothing here.** compare two single runs whose durations differ; or compare scan against scan, which produces no deltas at all |
| Meta has two items only, no goal word at all <br> *load bearing* | `comparison.goalId === undefined, which is every comparison run without `--goal`` | `apps/web/src/sections/comparisons.tsx:189` | **nothing here.** run `orchescope compare latest run_x` without --goal |
| A goal identifier naming a goal the report does not contain <br> *edge* | `comparison.goalId is set but no goal in bundle.goals carries that id; nothing checks and nothing links either way` | `apps/web/src/sections/comparisons.tsx:189` | **nothing here.** delete the matching goal from bundle.goals in a copy of demo-populated.json |

## Comparison block, lede

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Lede reads `task success declined, so no latency or cost improvement makes this an improvement` <br> *load bearing* | `the successRate delta has direction 'regressed'; this sentence pre-empts every other wording` | `apps/web/src/sections/comparisons.tsx:185 and packages/comparison/src/compare.ts:210-215` | **nothing here.** compare runs where taskSuccess is true on the baseline side and false on the candidate side |
| Lede reads `no metric moved enough to call` <br> *load bearing* | `no improved and no regressed delta, and at least one delta not indeterminate` | `apps/web/src/sections/comparisons.tsx:185 and packages/comparison/src/compare.ts:222` | demo-populated |
| Lede reads `no metric produced a supportable direction: ` followed by the first delta's caveat verbatim <br> *ordinary* | `metricDeltas.length > 0 and every direction is indeterminate; the sentence quotes indeterminate[0].caveat, so the lede changes wording with whichever metric happens to sort first` | `apps/web/src/sections/comparisons.tsx:185 and packages/comparison/src/compare.ts:216-221` | **nothing here.** compare two single runs that differ in durationMs only |
| Lede reads `no metric produced a supportable direction: sample sizes were too small` with no metric behind it <br> *load bearing* | `metricDeltas.length === 0, so indeterminate[0] is undefined and the fallback clause is used; the same block also shows `No metric was compared.`` | `packages/comparison/src/compare.ts:220 rendered at comparisons.tsx:185` | **nothing here.** compare scan against scan (`orchescope compare scan_a scan_b`), or two git refs with no runs recorded at either commit |
| Lede reads `N metric(s) improved and M regressed`, with the literal parenthetical plural <br> *ordinary* | `regressions.length > 0 and improvements.length > 0` | `packages/comparison/src/compare.ts:224-229 rendered at comparisons.tsx:185` | **nothing here.** compare two five-run sets where duration falls and retries rise |
| Lede is a comma list of regressed metric names followed by `regressed` <br> *ordinary* | `regressions.length > 0 and improvements.length === 0; the list is unbounded and can reach all nine default metrics` | `packages/comparison/src/compare.ts:230-235 rendered at comparisons.tsx:185` | **nothing here.** compare a clean baseline against a run set that is worse on every metric |
| Lede is a comma list of improved metric names followed by `improved with no regression` <br> *ordinary* | `improvements.length > 0 and regressions.length === 0` | `packages/comparison/src/compare.ts:236-239 rendered at comparisons.tsx:185` | **nothing here.** compare a slow baseline against a faster five-run candidate set |

## Comparison block, meta line, third item

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Meta carries `goal OSC-GOAL-0001` as plain text <br> *load bearing* | `comparison.goalId !== undefined` | `apps/web/src/sections/comparisons.tsx:189` | demo-populated |

## Comparison block, Baseline and Candidate definition rows

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Side described as `Run <run id>` <br> *load bearing* | `side.kind === 'run'` | `apps/web/src/sections/comparisons.tsx:19-26,193-194` | demo-populated |
| Side described as `Scan <scan id>, no runs` <br> *load bearing* | `side.kind === 'scan'; runIds is always empty for this kind and scanId is never shown separately` | `apps/web/src/sections/comparisons.tsx:25 and packages/usecases/src/compare.ts:79` | **nothing here.** `orchescope compare scan_a scan_b` |
| Side described as `Git ref <ref> at <ref> <40 char commit>, N runs`, repeating the ref twice <br> *load bearing* | `side.kind === 'git_ref'; the git clause is always populated for this kind with dirty false` | `apps/web/src/sections/comparisons.tsx:19-25 and packages/usecases/src/compare.ts:112-119` | **nothing here.** `orchescope compare HEAD~1 HEAD` in a repository with a scan at each commit |
| Side described as `Benchmark variant <id>` <br> *edge* | `side.kind === 'benchmark_variant'` | `packages/schema/src/comparison.ts:18-23 rendered at comparisons.tsx:25` | **nothing here.** no producer emits this kind; resolveSide in packages/usecases/src/compare.ts:34-123 never returns it, so it needs a hand written comparison or a new resolver |
| Side sentence with no revision clause at all <br> *load bearing* | `side.git === undefined` | `apps/web/src/sections/comparisons.tsx:21-23` | demo-populated |
| Revision clause with a dangling space before the comma: `at main , 1 runs` <br> *edge* | `side.git !== undefined and side.git.commit === undefined; the template interpolates '' for the commit and the separating space remains` | `apps/web/src/sections/comparisons.tsx:23` | **nothing here.** set `git: { ref: 'main', dirty: false }` on a side in a copy of demo-populated.json |
| Revision clause reads `at unknown ref <commit>` <br> *edge* | `side.git !== undefined and side.git.ref === undefined` | `apps/web/src/sections/comparisons.tsx:23` | **nothing here.** set `git: { commit: 'abc1234', dirty: false }` on a side in a copy of demo-populated.json |
| Revision clause degenerates to `at unknown ref ,` <br> *edge* | `side.git !== undefined with both ref and commit undefined, which the schema permits since only `dirty` is required` | `apps/web/src/sections/comparisons.tsx:23 and packages/schema/src/comparison.ts:34-43` | **nothing here.** set `git: { dirty: false }` on a side in a copy of demo-populated.json |
| Revision clause ends `(dirty)` <br> *ordinary* | `side.git.dirty === true, inherited from the run's own git record` | `apps/web/src/sections/comparisons.tsx:23 and packages/usecases/src/compare.ts:52,68` | **nothing here.** record a run with a dirty working tree, then compare against it |
| Side sentence ends `no runs` <br> *load bearing* | `side.runIds.length === 0, which is every scan side and any git ref with no run at that commit` | `apps/web/src/sections/comparisons.tsx:24` | **nothing here.** `orchescope compare scan_a scan_b` |
| Side sentence reads `1 runs`; there is no singular form <br> *load bearing* | `side.runIds.length === 1` | `apps/web/src/sections/comparisons.tsx:24` | demo-populated |
| Side sentence reads `N runs`, up to 50 for a git ref side and 10 for `latest` <br> *ordinary* | `side.runIds.length > 1` | `apps/web/src/sections/comparisons.tsx:24 and packages/usecases/src/compare.ts:107-110` | **nothing here.** `orchescope compare HEAD~1 HEAD` with several runs recorded at each commit |
| The two sides are different kinds, so one carries runs and the other cannot <br> *edge* | `comparison.baseline.kind !== comparison.candidate.kind, for example a scan baseline against a run candidate` | `apps/web/src/sections/comparisons.tsx:191-196 and packages/usecases/src/compare.ts:127-128` | **nothing here.** `orchescope compare scan_a latest` |

## Comparison block, Metric deltas group

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Eyebrow count 0 and the note `No metric was compared.` <br> *load bearing* | `comparison.metricDeltas.length === 0, which happens when neither side carries runs because every delta with zero samples on both sides is dropped` | `apps/web/src/sections/comparisons.tsx:30-32,199-201 and packages/comparison/src/compare.ts:268` | **nothing here.** `orchescope compare scan_a scan_b`, or two git refs with no run recorded at either commit |
| A nine column table, one row per metric, inside a horizontally scrolling container <br> *load bearing* | `comparison.metricDeltas.length > 0; nine rows is the default metric set` | `apps/web/src/sections/comparisons.tsx:34-92 and packages/comparison/src/compare.ts:190-200` | demo-populated |

## Metric deltas table, Direction column

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Cell reads `Improved` <br> *load bearing* | `delta.direction === 'improved'` | `apps/web/src/sections/comparisons.tsx:86 and packages/comparison/src/compare.ts:110-111` | **nothing here.** compare five slower runs against five faster ones |
| Cell reads `Regressed` <br> *load bearing* | `delta.direction === 'regressed'` | `apps/web/src/sections/comparisons.tsx:86 and packages/comparison/src/compare.ts:110-111` | **nothing here.** compare five fast runs against five slower ones |
| Cell reads `Unchanged`; the two means are exactly equal, so this is decided before any sample size test <br> *load bearing* | `baselineMean === candidateMean` | `apps/web/src/sections/comparisons.tsx:86 and packages/comparison/src/compare.ts:87` | demo-populated |
| Cell reads `Indeterminate`, always accompanied by a caveat <br> *load bearing* | `delta.direction === 'indeterminate'; reached by too few samples, too small a difference against the spread, one side having no samples, or no defined improvement direction` | `apps/web/src/sections/comparisons.tsx:86 and packages/comparison/src/compare.ts:99-108,126-129` | demo-populated |

## Metric deltas table, Caveat column

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Muted `none recorded` <br> *load bearing* | `delta.caveat === undefined, which is every unchanged row and every improved or regressed row that is not an incident metric crossing zero` | `apps/web/src/sections/comparisons.tsx:87` | demo-populated |
| `needs at least 3 samples per side, has X and Y` <br> *load bearing* | `either side has fewer than 3 samples and the means differ; the number three is the caveat's floor and disagrees with the five quoted in the limitations panel` | `packages/domain/src/statistics.ts:86-90 via packages/comparison/src/compare.ts:99-101, rendered at comparisons.tsx:87` | demo-populated |
| `difference is only X.X times the combined standard error` <br> *load bearing* | `three or more samples on both sides but the difference of means is under twice the pooled standard error` | `packages/domain/src/statistics.ts:114-117 via compare.ts:99-101, rendered at comparisons.tsx:87` | **nothing here.** compare two sets of five runs of the same scenario with similar durations |
| `no improvement direction is defined for <metric>` <br> *edge* | `the metric is in neither LOWER_IS_BETTER nor HIGHER_IS_BETTER; unreachable through the default metric list, since all nine defaults are classified` | `packages/comparison/src/compare.ts:102-109, rendered at comparisons.tsx:87` | **nothing here.** call compare() with a custom `metrics` list naming an unclassified metric; no shipped caller passes one, so today it needs a hand written comparison |
| `both samples are identical` can never render <br> *edge* | `the reason is produced only when the difference of means is zero, and that case has already returned 'unchanged' with no caveat one branch earlier` | `packages/domain/src/statistics.ts:103-106 against packages/comparison/src/compare.ts:87` | **nothing here.** unreachable by construction; do not design for it |

## Metric deltas table, whole row

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| `one side has no samples`, with Baseline or Candidate, Absolute change and Relative change all empty of values <br> *load bearing* | `one side's sample array is empty while the other is not; the delta survives the filter because the other side has samples, and baseline, candidate, absoluteChange and relativeChange are all omitted` | `packages/comparison/src/compare.ts:121-130,268, rendered at comparisons.tsx:57,63,71,77,87` | **nothing here.** compare a run whose metrics record taskSuccess against one that does not, which leaves successRate with samples on one side only |

## Metric deltas table, Direction and Caveat columns

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| `Improved` together with `decided by presence rather than by distribution: the event no longer occurs` <br> *load bearing* | `the metric is duplicateSideEffects, prohibitedSideEffects, policyViolations or userInterventions, the means differ, and the candidate mean is 0; this bypasses the sample size test entirely, so it can be claimed from one run per side` | `packages/comparison/src/compare.ts:74-97, rendered at comparisons.tsx:86-87` | **nothing here.** compare a support-desk-faults run that recorded a duplicate side effect against a clean run |
| `Regressed` together with `decided by presence rather than by distribution: the event now occurs` <br> *load bearing* | `same incident metric set, means differ, baseline mean is 0 and candidate mean is not` | `packages/comparison/src/compare.ts:88-97, rendered at comparisons.tsx:86-87` | **nothing here.** reverse the baseline and candidate of the case above |

## Metric deltas table, Baseline column

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Muted `not measured` where a number would be <br> *load bearing* | `delta.baseline === undefined` | `apps/web/src/sections/comparisons.tsx:57-62` | **nothing here.** see caveat-one-side-no-samples; the same condition produces it |

## Metric deltas table, Candidate column

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Muted `not measured` where a number would be <br> *load bearing* | `delta.candidate === undefined` | `apps/web/src/sections/comparisons.tsx:63-69` | **nothing here.** see caveat-one-side-no-samples; the same condition produces it |

## Metric deltas table, Absolute change column

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Muted `unknown` <br> *ordinary* | `delta.absoluteChange === undefined, which only happens when one side had no samples` | `apps/web/src/sections/comparisons.tsx:71-76 and apps/web/src/format.ts:12` | **nothing here.** see caveat-one-side-no-samples |

## Metric deltas table, Relative change column

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Muted `unknown` beside an absolute change of 0 <br> *load bearing* | `delta.relativeChange === undefined because the baseline mean is exactly 0 and a ratio against zero has no meaning; four of demo-populated's nine rows are in this state` | `apps/web/src/sections/comparisons.tsx:77-83 and packages/domain/src/statistics.ts:73-74` | demo-populated |
| A signed percentage to one decimal, for example `-13.0%` <br> *load bearing* | `delta.relativeChange !== undefined` | `apps/web/src/sections/comparisons.tsx:81 and apps/web/src/format.ts:93-98` | demo-populated |

## Metric deltas table, Baseline, Candidate and Absolute change columns

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Raw numbers with the unit carried only in the row header, so a duration reads `200` beside `durationMs (ms)` rather than `200 ms` <br> *load bearing* | `always; the section calls formatNumber, not formatMetricValue, so ms, fraction, tokens and count all render identically` | `apps/web/src/sections/comparisons.tsx:60,66,74 against apps/web/src/format.ts:125-143` | demo-populated |

## Metric deltas table, Baseline and Candidate columns

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A mean over several runs prints two decimals, a mean over one run prints whole <br> *ordinary* | `Number.isInteger(mean) selects the whole form; a mean of several unequal runs is fractional` | `apps/web/src/format.ts:35-47 via comparisons.tsx:60,66` | demo-populated reaches the whole form only |

## Metric deltas table, numeric columns

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Thousands separated by a space, for example `1 430` tokens <br> *ordinary* | `absolute value at or above 1000` | `apps/web/src/format.ts:14-24,26-33` | demo-populated |

## Metric deltas table, row header

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Row header muted suffix reads `(value)` because no unit is known for the metric <br> *edge* | `METRIC_UNITS has no entry for the metric name, for example passPowerK or recoveredErrors` | `packages/comparison/src/compare.ts:152-169,186 rendered at comparisons.tsx:54` | **nothing here.** call compare() with a custom `metrics` list naming a metric absent from METRIC_UNITS |

## Metric deltas group

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The nine column table scrolls inside its own container while the page does not <br> *ordinary* | `always; the table is wider than the main column at every realistic width` | `apps/web/src/sections/comparisons.tsx:34 and apps/web/src/styles.css:241-245` | demo-populated |

## Comparison block, Acceptance criteria group

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Eyebrow count 0 and the note `This comparison did not evaluate acceptance criteria.` <br> *load bearing* | `comparison.acceptanceResults.length === 0; this is the only reachable state today because no shipped producer ever populates the array` | `apps/web/src/sections/comparisons.tsx:206-211, packages/comparison/src/compare.ts:254,334 and packages/usecases/src/compare.ts:143-154` | demo-populated, and every comparison any shipped command can produce |
| A list item reading `satisfied: <criterion>` with a muted detail paragraph under it <br> *load bearing* | `an acceptanceResults entry with satisfied === true` | `apps/web/src/sections/comparisons.tsx:212-224 and apps/web/src/ui/primitives.tsx:386-392` | **nothing here.** add an acceptanceResults entry to the comparison in a copy of demo-populated.json; no CLI path produces one |
| A list item reading `not satisfied: <criterion>` with a muted detail paragraph under it, carrying no severity marker and no hue <br> *load bearing* | `an acceptanceResults entry with satisfied === false` | `apps/web/src/sections/comparisons.tsx:215-219` | **nothing here.** add an acceptanceResults entry with satisfied false to a copy of demo-populated.json |
| Satisfied and unsatisfied criteria interleaved in source order, with nothing summarising whether the goal was met overall <br> *load bearing* | `acceptanceResults contains both values of `satisfied`; the list is not sorted, not counted by outcome, and the block draws no conclusion` | `apps/web/src/sections/comparisons.tsx:212-224` | **nothing here.** add two acceptanceResults entries with different `satisfied` values to a copy of demo-populated.json |

## Comparison block, Graph delta group

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Group present with the note `This comparison did not compare the graphs.` and no eyebrow count <br> *load bearing* | `comparison.graphDelta === undefined, which is every run against run comparison because a run side carries no scan` | `apps/web/src/sections/comparisons.tsx:99-106 and packages/comparison/src/compare.ts:290-293` | demo-populated |
| Four definition rows all reading `none`, and no rename or change list at all <br> *load bearing* | `graphDelta present with all six arrays empty, meaning the two scans have identical graphs` | `apps/web/src/sections/comparisons.tsx:107-125` | **nothing here.** `orchescope compare scan_a scan_a`, or compare two scans of an unchanged checkout |
| Every identifier named with no ceiling and no truncation, so one definition value can be thousands of ids wrapping down the page <br> *load bearing* | `any of the four arrays is large; this is the only list in the workspace with no naming ceiling, against 120 on the delta bar, 137 on the map and 25 in the findings` | `apps/web/src/sections/comparisons.tsx:120-123 and apps/web/src/styles.css:1158-1161` | **nothing here.** compare a scan of pydantic-ai (1953 components) against a scan of an empty checkout; every component lands in one comma list |
| No rename list is rendered at all, so a reader cannot tell renames were considered <br> *load bearing* | `graphDelta.renamedComponents.length === 0; the branch returns null rather than a note` | `apps/web/src/sections/comparisons.tsx:126-134` | **nothing here.** compare two scans of an unchanged checkout |
| An unlabelled mono list of `from → to` lines under the four definition rows <br> *load bearing* | `graphDelta.renamedComponents.length > 0; a component that moved file but kept kind and name is reported here instead of as a removal plus an addition` | `apps/web/src/sections/comparisons.tsx:126-134 and packages/graph/src/diff.ts:59-80` | **nothing here.** move a component to a new file between two scans, then compare them |
| No changed component list is rendered at all <br> *load bearing* | `graphDelta.changedComponents.length === 0` | `apps/web/src/sections/comparisons.tsx:135-152` | **nothing here.** compare two scans of an unchanged checkout |
| An unlabelled list of link buttons, each with a muted comma list of what changed <br> *load bearing* | `graphDelta.changedComponents.length > 0; the change phrases come from a fixed set of six wordings, up to six on one component` | `apps/web/src/sections/comparisons.tsx:135-152 and packages/graph/src/diff.ts:12-39` | **nothing here.** rename a component's display name or change its permissions between two scans, then compare them |

## Comparison block, Graph delta group, Components added row

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| `N: id, id, id` in mono <br> *load bearing* | `graphDelta.addedComponents.length > 0` | `apps/web/src/sections/comparisons.tsx:108,120-123` | **nothing here.** scan, add a component to apps/demo, scan again, compare the two scans |

## Comparison block, Graph delta group, Components removed row

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| `N: id, id, id` in mono, naming ids that no longer exist in the report's own graph <br> *load bearing* | `graphDelta.removedComponents.length > 0` | `apps/web/src/sections/comparisons.tsx:109,120-123 and packages/graph/src/diff.ts:103-106` | **nothing here.** scan, delete a component from apps/demo, scan again, compare the two scans |

## Comparison block, Graph delta group, Relations added row

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| `N: edge id, edge id` in mono <br> *load bearing* | `graphDelta.addedEdges.length > 0` | `apps/web/src/sections/comparisons.tsx:110,120-123 and packages/graph/src/diff.ts:109-111` | **nothing here.** add a call between two existing components between two scans, then compare them |

## Comparison block, Graph delta group, Relations removed row

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| `N: edge id, edge id` in mono <br> *load bearing* | `graphDelta.removedEdges.length > 0` | `apps/web/src/sections/comparisons.tsx:111,120-123 and packages/graph/src/diff.ts:112-114` | **nothing here.** remove a call between two scans, then compare them |

## Comparison block, Graph delta group, changed component line

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Change phrase reads `now exercised at runtime` or `no longer exercised at runtime` <br> *ordinary* | `the component's presence.runtime differs between the two scans; this is the one change phrase that carries evidence rather than declaration` | `packages/graph/src/diff.ts:28-32 rendered at comparisons.tsx:148` | **nothing here.** scan without runs, record a run touching a component, scan again, compare the two scans |

## System map, details panel, after clicking a changed component

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Refusal reading `That component is not in this report.` with the identifier below it <br> *edge* | `a changedComponents id that is not in bundle.graph; the delta is between two historical scans while the bundle carries the current one, and nothing checks before rendering the button` | `apps/web/src/sections/comparisons.tsx:139-147 leading to apps/web/src/ui/component-details.tsx:310-317` | **nothing here.** compare two older scans, then delete the named component before the audit that builds the report |

## Comparison block

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The finding delta group is omitted entirely, with no note and no trace that findings were not compared <br> *load bearing* | `comparison.findingDelta === undefined, which is every run against run comparison; note the asymmetry with the graph delta, which states its own absence` | `apps/web/src/sections/comparisons.tsx:230 and packages/comparison/src/compare.ts:295-296` | demo-populated |

## Comparison block, Finding delta group

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Three definition rows all reading `none` <br> *load bearing* | `findingDelta present with resolved, introduced and unchanged all empty, meaning neither scan produced any finding` | `apps/web/src/sections/comparisons.tsx:233-251` | **nothing here.** compare two scans of a checkout that produces no finding, such as the orchescope-discovery target |
| Comma lists of finding identifiers under Resolved, Introduced and Unchanged, in mono, with no counts and no links <br> *load bearing* | `any of the three arrays is non empty; unlike the graph delta rows these carry no `N:` prefix, and unlike the changed component list these are not clickable` | `apps/web/src/sections/comparisons.tsx:236-249` | **nothing here.** compare two scans where a finding was fixed between them |
| A finding counted as unchanged although its identifier differs, because matching is by ruleId <br> *edge* | `the same rule fires on both sides; `resolved` and `introduced` carry baseline and candidate ids respectively, so the same rule firing on a different component still reads as unchanged` | `packages/comparison/src/compare.ts:297-315 rendered at comparisons.tsx:233-251` | **nothing here.** compare two scans where one rule fires on a different component in each |

## Comparison block, Limitations group

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Eyebrow count 0 and the note `No limitation was recorded, which is itself worth checking: every comparison has at least the limits of its own sample.` <br> *load bearing* | `comparison.limitations.length === 0, which needs five or more runs on both sides, both graphs present, no costUsd delta and at least one determinate metric` | `apps/web/src/sections/comparisons.tsx:256-263 and packages/comparison/src/compare.ts:272-288` | **nothing here.** compare two git refs each with five or more recorded runs and a stored scan |
| A refusal panel titled `What this comparison does not establish` holding the list <br> *load bearing* | `comparison.limitations.length > 0; this is a refusal panel used inside a populated screen rather than as an empty state` | `apps/web/src/sections/comparisons.tsx:265-271` | demo-populated |
| `sample sizes are N baseline and M candidate run(s); differences from fewer than five runs per side are not reported as directional unless the spread is very small` <br> *load bearing* | `either side has fewer than five runs; the literal parenthetical plural and the five contradict the three quoted in the metric caveats` | `packages/comparison/src/compare.ts:273-277 rendered at comparisons.tsx:267-269` | demo-populated |
| `no graph delta was computed because one side has no scan` <br> *load bearing* | `either baselineGraph or candidateGraph is undefined; always co-occurs with graph-delta-absent, so the absence is stated twice on one screen` | `packages/comparison/src/compare.ts:283-285 rendered at comparisons.tsx:267-269` | demo-populated |
| `every metric was indeterminate, so this comparison supports no conclusion` <br> *load bearing* | `metricDeltas.every(d => d.direction === 'indeterminate'), which is vacuously true when there are no deltas at all, so this also appears on a scan against scan comparison that measured nothing` | `packages/comparison/src/compare.ts:286-288 rendered at comparisons.tsx:267-269` | **nothing here.** compare two single runs that differ only in duration; or compare scan against scan |
| `cost is derived from token counts and a configured price table, not measured` <br> *edge* | `a costUsd metric delta exists; costUsd is not in DEFAULT_COMPARED_METRICS and no shipped caller overrides the list, so this is unreachable today` | `packages/comparison/src/compare.ts:278-282 against 190-200` | **nothing here.** call compare() with a `metrics` list including costUsd; no CLI or MCP path passes one |
| All four limitation sentences at once <br> *edge* | `fewer than five runs per side, a costUsd delta, a missing graph and every metric indeterminate together; three at once is the realistic ceiling` | `packages/comparison/src/compare.ts:272-288` | **nothing here.** not producible through the CLI while costUsd stays out of the default metric list |

## Comparison block, closing note

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| `1 baseline runs against 1 candidate runs.` with no singular form and no basis chip on either number <br> *load bearing* | `always rendered, whatever the counts; it restates what both side sentences already said` | `apps/web/src/sections/comparisons.tsx:274-279` | demo-populated |
| `0 baseline runs against 0 candidate runs.` closing a comparison that measured nothing <br> *load bearing* | `both sides carry no runs, which is every scan against scan comparison` | `apps/web/src/sections/comparisons.tsx:274-279` | **nothing here.** `orchescope compare scan_a scan_b` |

## Comparisons, heading structure

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The empty screen carries an h3 reading `Comparisons`; the populated screen has no section heading and each block's h3 is a raw `cmp_` identifier <br> *load bearing* | `bundle.comparisons.length === 0 versus > 0; the block eyebrow is a paragraph, not a heading, so the populated screen's only headings are opaque identifiers` | `apps/web/src/sections/comparisons.tsx:164 against 183-184 and apps/web/src/ui/primitives.tsx:41-59` | flask reaches the empty shape, demo-populated the populated shape |

## Comparisons, whole screen, after using the finding card control

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The screen still refuses or shows the old list although a comparison was just created <br> *ordinary* | `the compare_runs action succeeded against the local server but the bundle in the page predates it; unlike the scenario rerun action, the success message does not say the report must be regenerated` | `apps/web/src/ui/finding-card.tsx:226-242 against apps/web/src/sections/comparisons.tsx:161` | **nothing here.** serve demo-populated with `audit --serve` and use `Compare with baseline` on a finding |

## What a designer needs to know beyond the list

CROSS-CUTTING THINGS A DESIGNER NEEDS TO KNOW, NOT SINGLE STATES.

1. One bundle of sixteen reaches this screen at all. `demo-populated` carries the only comparison in the corpus, and it is a run against run comparison: it exercises the metric table, the caveat and no-caveat cells, the unknown relative change, the goal attachment, the empty acceptance block, the limitations refusal and the sample note. Everything on the scan side of the schema (graph delta, finding delta, `no runs`, git clauses, insufficient evidence, the zero metric case) has never been rendered by anything. The whole scan-shaped half of this screen is undesigned and unlooked-at.

2. The screen is missing the ceiling rule the rest of the workspace holds itself to. `report-system.md` says the delta bar states its reading at 120 cells, the map at 137 names, the findings at 25 components: "state which reading you are giving". The graph delta names every added, removed and renamed identifier in one comma joined string with no ceiling and no count of what it left out, and the finding delta does the same without even a count prefix. A scan against scan comparison over `pydantic-ai` puts 1953 identifiers in one definition value. The comparison list itself is capped at twenty by the store and the screen never says so.

3. Two numbers contradict each other on the same page. The metric caveat column says "needs at least 3 samples per side" (compare.ts:117); the limitations panel says "differences from fewer than five runs per side are not reported as directional" (compare.ts:275). With four runs a side the table claims directions the panel says it does not report. Fixing the copy is a design decision about which floor is the real one.

4. Three blocks state their own absence and one does not. Metric deltas ("No metric was compared."), acceptance ("did not evaluate acceptance criteria"), graph delta ("did not compare the graphs") and limitations all speak when empty. The finding delta group vanishes without a word, and inside the graph delta both the rename list and the changed component list vanish without a word. That is three silences against five statements, in a screen whose stated rule is that an absence is said out loud.

5. Acceptance criteria are dead in every shipped path. `compare()` accepts `acceptanceResults` (compare.ts:254) and `compareUseCase` never passes it (usecases/src/compare.ts:143-154), so the array is always empty and the eyebrow count is always 0. The three item states in the list above are what the block would show, drawn from the schema at packages/schema/src/comparison.ts:123-132: each entry is a criterion string, a boolean, and a required detail sentence. There is no summary, no ordering by outcome, and no verdict drawn from them, which matters because this block is the only thing on the screen that could say whether the goal was met rather than whether the numbers moved.

6. Nothing on this screen is linked to anything. `goal OSC-GOAL-0001` is text, not a link, while the Goals screen lists `comparisonId` as text too (sections/goals.tsx:217-228), so the two halves of the improvement loop name each other and neither can be clicked. Finding delta identifiers are text although the Findings screen holds the findings. The section ignores route params entirely, so no comparison has an anchor and Goals could not link to one even if it wanted to. The only interactive element on the whole screen is the changed component button, and it can land on a map refusal.

7. Every comparison renders fully expanded, in store order, with no summary row, no collapse and no filter. Two comparisons means two nine column tables; twenty means twenty. Compare this with the Findings screen, which has filters, and with `DisclosureRow` in the primitive set, which exists for exactly this and is unused here.

8. Formatting: values go through `formatNumber`, not `formatMetricValue`, so a duration reads `200` beside a header saying `(ms)` rather than `200 ms`, and a success rate reads `1` beside `(fraction)` rather than `100%`. The `Eyebrow` count uses `String(count)` rather than `formatInteger`, so it is ungrouped, though at nine and four it never shows. A git commit is printed at full 40 characters inside a prose sentence, where the chrome's own `Stamp` slices it to seven (shell.tsx:190).

9. Robustness: the web loader validates only `graph` and `summary` and repairs missing arrays to empty (bundle.ts:58-147). Individual comparison fields are never checked, there is no error boundary anywhere in `apps/web`, and the section dereferences `metricDeltas.length`, `acceptanceResults.length`, `limitations.length` and `baseline.runIds.length` unguarded, so a comparison missing any of them takes the whole page down rather than the block. Separately, `comparisons` missing from the document is repaired to `[]`, and the screen then asserts "No comparison has been made", which is a statement the data does not support; the repaired banner above it is the only correction.

10. Nothing in `comparisons` passes through the redactor. `bundle.ts:163` spreads the array verbatim while other fields are redacted, so side labels, verdict reasons, limitations and component identifiers reach the page as recorded. They are text nodes, so this is a disclosure question rather than an injection one, but a side label carries a scenario name from the analysed repository.

