# Scenarios: every state

72 states across 13 blocks. 41 of them are reached by no report in `corpus/.cache/bundles`, so `pnpm states` will not show them to you and the fourth column says what would.

Source: `Scenarios screen (apps/web/src/sections/scenarios.tsx, apps/web/src/ui/evaluators.tsx)`.

## Thresholds

| Constant | Value | Where | What it switches | Why that number |
| --- | --- | --- | --- | --- |
| `audit run limit` | 10 by default, settable with `orchescope audit --runs N` | `packages/usecases/src/audit.ts:344, apps/cli/src/commands/audit.ts:203` | Below it every stored run of a scenario becomes a run card. At or above it only the newest N runs across the whole project reach the bundle, and trace runs consume the same budget, so a scenario whose runs are older than the newest ten shows the 'never been run in this report' refusal instead of its runs. The Scenarios screen never states this number and never says a list was cut. | Taste, undocumented. The code reads `request.runLimit ?? 10` with no comment giving a reason. |
| `MAX_DETAIL` | 1000 | `packages/scenarios/src/evaluate.ts:30` | An evaluator detail longer than 1000 characters is cut to 997 and suffixed with an ellipsis. Below it the sentence is whole. The workspace applies no further limit and renders whatever it is given. | Taste, undocumented. |
| `MAX_FAILURE_REASON` | 1000 | `packages/scenarios/src/repetition.ts:35` | The same cut applied to the three expect_* expectation details, which are the results that appear on the run card and in no definition row. | Taste, undocumented. It equals MAX_DETAIL by coincidence rather than by reference. |
| `EvaluatorResult.detail maxLength` | 2000 | `packages/schema/src/evaluator.ts:99` | The outer ceiling on what one evaluator row can carry. Twice the engine's own limit, so an imported bundle can present a detail this build's engine would never emit. | Taste, undocumented schema bound. |
| `Scenario.description maxLength` | 2000 | `packages/schema/src/scenario.ts:116` | The ceiling on the lede paragraph under the scenario name. Nothing clamps, truncates or discloses it in the workspace, so the whole 2000 characters render at 12.5px. The longest real description is 343. | Taste, undocumented schema bound. |
| `Scenario.id pattern length` | 2 to 64 lowercase characters, ^[a-z0-9][a-z0-9-]{1,63}$ | `packages/schema/src/scenario.ts:114` | Bounds the mono Identifier row and the id interpolated into `orchescope test --scenario <id>` in the refusal panel. Because the pattern excludes every character quoteArg escapes, the printed command is never quoted, while the placeholder form '<scenario id>' always is. | Stated as a pattern with no derivation given. |
| `GROUP_SIZE` | 3 | `apps/web/src/format.ts:6` | Digit grouping with a plain space. On this screen it applies to the Repetitions row alone. Seed uses String(), every budget value uses String(), and both eyebrow counts use String(count), so four numbers on one card are formatted three different ways. | Taste, undocumented. The usual thousands grouping. |
| `.verdict min-width` | 7ch | `apps/web/src/styles.css:1526` | Holds the three verdict words, 6 to 7 characters, in a fixed column so the mono kind beside them aligns down the list. It is the only alignment rule in the evaluator group; the detail column is free flowing. | Sized to the longest of the three hardcoded words, per the comment above it at styles.css:1518. |
| `Eyebrow count presence` | rendered whenever count !== undefined, including 0 | `apps/web/src/ui/primitives.tsx:38, called at apps/web/src/sections/scenarios.tsx:105` | 'Runs of this scenario' prints a literal 0 when the scenario has never been run, directly above a refusal panel saying the same thing in a sentence. Below the same heading with a count above zero, the run cards follow instead. | No derivation. It contradicts the rule stated at ui/shell.tsx:118, where a nav count of zero is omitted because the section refuses in a sentence that says considerably more; that call site applies `count > 0 ? count : undefined` and this one passes the raw length. |

## Scenarios, whole screen

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| No scenario and no run at all: the whole screen is one refusal panel <br> *load bearing* | `bundle.scenarios.length === 0 && bundle.scenarioRuns.length === 0` | `apps/web/src/sections/scenarios.tsx:130` | orchescope-discovery, flask, express, axios, vercel-ai-chatbot, vercel-ai-chatbot-exercised, anthropic-quickstarts, langgraphjs, openai-agents-js, langgraph, crewai, openai-agents-python, pydantic-ai, pydantic-ai-exercised |
| The same refusal, but the field was unreadable rather than empty <br> *edge* | `the bundle JSON was missing `scenarios` or `scenarioRuns`, so validateBundle defaulted them to [] and pushed the key into `repaired`` | `apps/web/src/bundle.ts:137 then apps/web/src/sections/scenarios.tsx:130` | **nothing here.** Delete the `scenarios` and `scenarioRuns` keys from corpus/.cache/bundles/demo-populated.json |
| One block per defined scenario, and no section heading anywhere <br> *load bearing* | `bundle.scenarios.length > 0` | `apps/web/src/sections/scenarios.tsx:154` | demonstration-system, demo-populated |
| Exactly one scenario defined, so no separator rule is drawn <br> *ordinary* | `bundle.scenarios.length === 1` | `apps/web/src/sections/scenarios.tsx:154` | **nothing here.** Keep one entry in `scenarios` in corpus/.cache/bundles/demonstration-system.json and drop the other two |
| Many scenarios: one unbroken scroll with no index or filter <br> *edge* | `bundle.scenarios.length is large, say 30 or more` | `apps/web/src/sections/scenarios.tsx:154` | **nothing here.** Duplicate the three entries in `scenarios` in corpus/.cache/bundles/demonstration-system.json with distinct ids until there are 30 |
| Runs exist and no scenario does, so the orphan block is the entire page <br> *edge* | `scenarios.length === 0 && scenarioRuns.length > 0` | `apps/web/src/sections/scenarios.tsx:130, :154, :157` | **nothing here.** In corpus/.cache/bundles/demo-populated.json set `scenarios` to [] |

## Scenarios, trailing block

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A trailing block: runs whose scenario is not in this bundle <br> *ordinary* | `scenarioRuns.some(run => !scenarios.some(s => s.id === run.scenarioId))` | `apps/web/src/sections/scenarios.tsx:157` | **nothing here.** In corpus/.cache/bundles/demo-populated.json change one scenarioRuns entry's `scenarioId` to a value no scenario has |
| Exactly one orphan run, under a heading that stays plural <br> *edge* | `orphanRuns.length === 1` | `apps/web/src/sections/scenarios.tsx:159` | **nothing here.** In corpus/.cache/bundles/demo-populated.json keep one scenarioRuns entry and point it at an unknown scenarioId |

## Scenario card, header

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A lede paragraph under the scenario name <br> *load bearing* | `scenario.description !== undefined` | `apps/web/src/sections/scenarios.tsx:102` | demonstration-system, demo-populated |
| No lede: the definition list butts straight against the name <br> *ordinary* | `scenario.description === undefined` | `apps/web/src/sections/scenarios.tsx:102` | **nothing here.** Delete `description` from one scenario in corpus/.cache/bundles/demonstration-system.json |
| A description at its 2000 character ceiling, unclamped <br> *edge* | `scenario.description.length approaches the schema maximum of 2000` | `packages/schema/src/scenario.ts:116 rendered at apps/web/src/sections/scenarios.tsx:102` | **nothing here.** Pad one `description` in corpus/.cache/bundles/demonstration-system.json to 2000 characters |

## Scenario card, definition list

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The ten rows that are always present <br> *load bearing* | `always, scenarioRows returns at least ten entries` | `apps/web/src/sections/scenarios.tsx:41` | demonstration-system, demo-populated |
| An eleventh row, Tags, comma joined in prose type <br> *ordinary* | `scenario.tags.length > 0` | `apps/web/src/sections/scenarios.tsx:62` | demonstration-system, demo-populated |
| The Tags row removed entirely, the only row that is dropped <br> *ordinary* | `scenario.tags.length === 0` | `apps/web/src/sections/scenarios.tsx:62` | **nothing here.** Set `tags` to [] on one scenario in corpus/.cache/bundles/demonstration-system.json |
| Seed reads 'not fixed' <br> *ordinary* | `scenario.seed === undefined` | `apps/web/src/sections/scenarios.tsx:50` | **nothing here.** Delete `seed` from one scenario in corpus/.cache/bundles/demonstration-system.json |
| Seed printed with String(), so a large seed loses digit grouping <br> *ordinary* | `scenario.seed !== undefined` | `apps/web/src/sections/scenarios.tsx:50` | demonstration-system, demo-populated |
| Repetitions reads the spelled word 'one' <br> *ordinary* | `scenario.repetitions === undefined` | `apps/web/src/sections/scenarios.tsx:48` | **nothing here.** Delete `repetitions` from one scenario in corpus/.cache/bundles/demonstration-system.json |
| Repetitions reads the numeral '1' <br> *ordinary* | `scenario.repetitions === 1` | `apps/web/src/sections/scenarios.tsx:48` | demonstration-system, demo-populated |
| Repetitions grouped by formatInteger, for instance '1 000' <br> *edge* | `scenario.repetitions >= 1000` | `apps/web/src/sections/scenarios.tsx:48, apps/web/src/format.ts:26` | **nothing here.** Set `repetitions` to 1000 on support-desk in corpus/.cache/bundles/demonstration-system.json |
| Permissions reads 'none', and the row switches out of mono <br> *ordinary* | `scenario.requiredPermissions.length === 0` | `apps/web/src/sections/scenarios.tsx:56` | **nothing here.** Set `requiredPermissions` to [] on one scenario in corpus/.cache/bundles/demonstration-system.json |
| Permissions listed in mono, comma joined <br> *load bearing* | `scenario.requiredPermissions.length > 0` | `apps/web/src/sections/scenarios.tsx:56` | demonstration-system, demo-populated |
| Declared faults reads 'none' <br> *ordinary* | `scenario.faults.length === 0` | `apps/web/src/sections/scenarios.tsx:34` | demonstration-system, demo-populated |
| Exactly one declared fault: 'Tool timeout into issue_refund' <br> *ordinary* | `scenario.faults.length === 1` | `apps/web/src/sections/scenarios.tsx:37` | demonstration-system, demo-populated |
| Eight declared faults on one semicolon joined 260 character line <br> *load bearing* | `scenario.faults.length is large` | `apps/web/src/sections/scenarios.tsx:37` | demonstration-system, demo-populated |
| Budgets reads 'none set' <br> *ordinary* | `every value in scenario.budgets is undefined` | `apps/web/src/sections/scenarios.tsx:30` | **nothing here.** Set `budgets` to {} on one scenario in corpus/.cache/bundles/demonstration-system.json |
| Budgets as camelCase keys with raw unformatted numbers <br> *load bearing* | `at least one scenario.budgets value is defined` | `apps/web/src/sections/scenarios.tsx:27` | demonstration-system, demo-populated |
| Budget order comes from JSON key order, not from the schema <br> *edge* | `Object.entries(scenario.budgets) iteration order` | `apps/web/src/sections/scenarios.tsx:27` | demonstration-system, demo-populated |
| Evaluators reads an argued sentence instead of a list <br> *load bearing* | `scenario.evaluators.length === 0` | `apps/web/src/sections/scenarios.tsx:20` | **nothing here.** Set `evaluators` to [] on one scenario in corpus/.cache/bundles/demonstration-system.json |
| Declared evaluator kinds joined, with duplicates repeated verbatim <br> *load bearing* | `scenario.evaluators.length > 0` | `apps/web/src/sections/scenarios.tsx:23` | demonstration-system, demo-populated |
| Result source, one of three humanised literals <br> *ordinary* | `scenario.target.resultSource is result_file, root_span or exit_code` | `apps/web/src/sections/scenarios.tsx:44` | demonstration-system, demo-populated reach result_file only |
| Timeout crossing formatDuration's bands, up to '5 min 0.0 s' <br> *ordinary* | `scenario.target.timeoutMs below 1000, below 60000, or at and above 60000` | `apps/web/src/sections/scenarios.tsx:45, apps/web/src/format.ts:66` | demonstration-system, demo-populated reach the seconds band only, 30.00 s |
| A command whose argv element has to be single quoted <br> *ordinary* | `an element of scenario.target.command fails /^[A-Za-z0-9_@%+=:,./-]+$/` | `apps/web/src/sections/scenarios.tsx:43, apps/web/src/format.ts:179` | **nothing here.** Add an argv element containing a space, such as 'where is my order', to `target.command` in corpus/.cache/bundles/demonstration-system.json |
| A withheld value: 'node [redacted:environment:37]' <br> *edge* | `the redactor replaced a string anywhere in the scenario, producing '[redacted:<label>:<length>]'` | `packages/report/src/bundle.ts:184 then apps/web/src/sections/scenarios.tsx:43` | **nothing here.** Replace an argv element in corpus/.cache/bundles/demonstration-system.json with '[redacted:environment:37]' |

## Scenario card, definition list against run card

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| 'nothing decides whether a run passed' contradicted by the run card below <br> *edge* | `scenario.evaluators.length === 0 && scenario.expect !== undefined` | `apps/web/src/sections/scenarios.tsx:20 against packages/scenarios/src/repetition.ts:255` | **nothing here.** Set `evaluators` to [] on support-desk in corpus/.cache/bundles/demo-populated.json and leave its scenarioRuns[].evaluators intact |
| The row counts eight evaluators and the run card lists twelve <br> *load bearing* | `scenario.expect is set, so run.evaluators is the declared results plus the expectation results` | `apps/web/src/sections/scenarios.tsx:51 against apps/web/src/ui/evaluators.tsx:36` | demo-populated |

## Scenario card, runs group

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Defined and never run: a count of 0 above a refusal panel <br> *load bearing* | `bundle.scenarioRuns.filter(r => r.scenarioId === scenario.id).length === 0` | `apps/web/src/sections/scenarios.tsx:105, :108` | demonstration-system |
| 'never been run' shown for a scenario that has been run twenty one times <br> *load bearing* | `the scenario's runs exist in the store but fell outside the audit run limit, so none reach bundle.scenarioRuns` | `packages/usecases/src/audit.ts:344 and :267 then apps/web/src/sections/scenarios.tsx:108` | **nothing here.** Regenerate the apps/demo report from the current apps/demo/.orchescope state, where the ten newest runs are nine support-desk-faults runs plus one trace, so support-desk and support-desk-duplicate render this refusal despite holding 21 and 3 stored runs |
| Exactly one run, under a heading that stays plural <br> *ordinary* | `runs.length === 1` | `apps/web/src/sections/scenarios.tsx:105, :119` | demo-populated, support-desk-faults |
| Several run cards, newest first, each repeating the full evaluator list <br> *load bearing* | `runs.length > 1` | `apps/web/src/sections/scenarios.tsx:119` | demo-populated, support-desk with 5 and support-desk-duplicate with 3 |
| The run list silently truncated by the audit run limit <br> *load bearing* | `stored runs for the scenario exceed the audit run limit, default 10` | `packages/usecases/src/audit.ts:344 then apps/web/src/sections/scenarios.tsx:105` | **nothing here.** Set `repetitions` to 100 on support-desk in corpus/.cache/bundles/demo-populated.json and leave its five runs, which is the shape the truncation produces |
| Two hundred run cards under one heading, unpaginated <br> *edge* | `runs.length is very large, reachable with `orchescope audit --runs 500`` | `apps/web/src/sections/scenarios.tsx:119` | **nothing here.** Duplicate the scenarioRuns entries for support-desk in corpus/.cache/bundles/demo-populated.json with distinct runIds until there are 200 |

## Scenario card, definition list against runs group

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| More run cards than the scenario declares repetitions <br> *load bearing* | `runs.length !== scenario.repetitions` | `apps/web/src/sections/scenarios.tsx:48 against :105` | demo-populated, Repetitions 3 with 5 cards and Repetitions 1 with 3 cards |

## Run card, meta line

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Status 'Completed' <br> *load bearing* | `run.status === 'completed'` | `apps/web/src/sections/scenarios.tsx:73` | demo-populated, all nine runs |
| Status 'Failed', at the same weight as 'Completed' <br> *load bearing* | `run.status === 'failed'` | `apps/web/src/sections/scenarios.tsx:73` | **nothing here.** Set `status` to 'failed' on one scenarioRuns entry in corpus/.cache/bundles/demo-populated.json |
| Status 'Timeout' <br> *ordinary* | `run.status === 'timeout'` | `apps/web/src/sections/scenarios.tsx:73` | **nothing here.** Set `status` to 'timeout' on one scenarioRuns entry in corpus/.cache/bundles/demo-populated.json |
| Status 'Cancelled' <br> *ordinary* | `run.status === 'cancelled'` | `apps/web/src/sections/scenarios.tsx:73` | **nothing here.** Set `status` to 'cancelled' on one scenarioRuns entry in corpus/.cache/bundles/demo-populated.json |
| Status 'Budget exceeded', the only two word status <br> *ordinary* | `run.status === 'budget_exceeded'` | `apps/web/src/sections/scenarios.tsx:73` | **nothing here.** Set `status` to 'budget_exceeded' on one scenarioRuns entry in corpus/.cache/bundles/demo-populated.json |
| Status 'Running' in a static report, so the run never resolved <br> *edge* | `run.status === 'running'` | `apps/web/src/sections/scenarios.tsx:73` | **nothing here.** Set `status` to 'running' on one scenarioRuns entry in corpus/.cache/bundles/demo-populated.json |
| A status word the build does not know, humanised and shown anyway <br> *edge* | `run.status is any other non-empty string; the bundle types it as NonEmptyString, not as the RunStatus union` | `packages/schema/src/report.ts:35 then apps/web/src/sections/scenarios.tsx:73` | **nothing here.** Set `status` to 'partially_completed' on one scenarioRuns entry in corpus/.cache/bundles/demo-populated.json |
| 'task succeeded' <br> *load bearing* | `run.taskSuccess === true` | `apps/web/src/sections/scenarios.tsx:74` | demo-populated, all nine runs |
| 'task failed', normally paired with 'Completed' on the same line <br> *load bearing* | `run.taskSuccess === false` | `apps/web/src/sections/scenarios.tsx:74` | **nothing here.** Set `taskSuccess` to false on one scenarioRuns entry in corpus/.cache/bundles/demo-populated.json; six of the 47 runs in apps/demo/.orchescope/state carry it, so regenerating that report also reaches it |
| 'task outcome not reported', the longest of the three phrases <br> *load bearing* | `run.taskSuccess === undefined` | `apps/web/src/sections/scenarios.tsx:75` | **nothing here.** Delete `taskSuccess` from one scenarioRuns entry in corpus/.cache/bundles/demo-populated.json |
| No variant: four items on the meta line <br> *load bearing* | `run.variantId === undefined` | `apps/web/src/sections/scenarios.tsx:81` | demo-populated, all nine runs |
| A fifth meta item reading 'variant agent_count=2' <br> *load bearing* | `run.variantId !== undefined` | `apps/web/src/sections/scenarios.tsx:81` | **nothing here.** Set `variantId` to 'agent_count=2' on one scenarioRuns entry in corpus/.cache/bundles/demo-populated.json; the apps/demo store already holds nine such runs from `orchescope benchmark` |
| Duration in the millisecond band, '174.0 ms' <br> *load bearing* | `1 <= run.durationMs < 1000` | `apps/web/src/sections/scenarios.tsx:80, apps/web/src/format.ts:74` | demo-populated, 174 to 279 ms |
| Duration of exactly zero, rendered '0 ms' and not '0.000 ms' <br> *edge* | `run.durationMs === 0` | `apps/web/src/format.ts:69` | **nothing here.** Set `durationMs` to 0 on one scenarioRuns entry in corpus/.cache/bundles/demo-populated.json |
| Duration over a minute, '2 min 5.4 s', the only two unit value <br> *ordinary* | `run.durationMs >= 60000` | `apps/web/src/format.ts:79` | **nothing here.** Set `durationMs` to 125400 on one scenarioRuns entry in corpus/.cache/bundles/demo-populated.json |

## Run card

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| No faults applied, so no note paragraph <br> *ordinary* | `run.faultsApplied.length === 0` | `apps/web/src/sections/scenarios.tsx:83` | demo-populated, the five support-desk runs |
| 'Faults applied: fp_543e36f62ddab59f', an opaque plan digest <br> *load bearing* | `run.faultsApplied.length === 1` | `apps/web/src/sections/scenarios.tsx:84` | demo-populated, the support-desk-duplicate and support-desk-faults runs |
| Several fault plan digests comma joined on one line <br> *edge* | `run.faultsApplied.length > 1` | `apps/web/src/sections/scenarios.tsx:84` | **nothing here.** Add a second id to `faultsApplied` on a support-desk-faults run in corpus/.cache/bundles/demo-populated.json |

## Run card, evaluator group

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| No evaluator result: a note, and no Evaluators heading at all <br> *load bearing* | `run.evaluators.length === 0` | `apps/web/src/ui/evaluators.tsx:31` | **nothing here.** Set `evaluators` to [] on one scenarioRuns entry in corpus/.cache/bundles/demo-populated.json |
| Exactly one evaluator result, under a plural heading <br> *ordinary* | `run.evaluators.length === 1` | `apps/web/src/ui/evaluators.tsx:36` | **nothing here.** Keep one entry in `evaluators` on a support-desk-faults run in corpus/.cache/bundles/demo-populated.json |
| A list of evaluator results in a fixed declared then expected order <br> *load bearing* | `run.evaluators.length > 0` | `apps/web/src/ui/evaluators.tsx:34, order set at packages/scenarios/src/repetition.ts:328` | demo-populated, 3 and 12 per run |

## Evaluator row

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Verdict 'passed', with result.detail beside it <br> *load bearing* | `result.skipped !== true && result.passed` | `apps/web/src/ui/evaluators.tsx:17` | demo-populated, 63 of 72 rows |
| Verdict 'failed', identical in weight and colour to 'passed' <br> *load bearing* | `result.skipped !== true && !result.passed` | `apps/web/src/ui/evaluators.tsx:17` | demo-populated, 9 of 72 rows |
| Verdict 'skipped', where the detail is replaced by the skip reason <br> *load bearing* | `result.skipped === true` | `apps/web/src/ui/evaluators.tsx:16, :22` | **nothing here.** Set `skipped` to true and add a `skipReason` on one evaluator in corpus/.cache/bundles/demo-populated.json |
| 'skipped' with the fallback text 'no reason recorded' <br> *edge* | `result.skipped === true && result.skipReason === undefined` | `apps/web/src/ui/evaluators.tsx:12, :22` | **nothing here.** Set `skipped` to true without a `skipReason` on one evaluator in corpus/.cache/bundles/demo-populated.json |
| skipped present and false, rendering exactly as skipped absent <br> *edge* | `result.skipped === false` | `apps/web/src/ui/evaluators.tsx:16` | **nothing here.** Add "skipped": false to one evaluator in corpus/.cache/bundles/demo-populated.json |
| A detail long enough to become a paragraph inside a list item <br> *ordinary* | `result.detail approaches 1000 characters, the engine ceiling, or 2000, the schema ceiling` | `packages/scenarios/src/evaluate.ts:30, packages/schema/src/evaluator.ts:99, rendered at apps/web/src/ui/evaluators.tsx:22` | **nothing here.** Pad one evaluator `detail` in corpus/.cache/bundles/demo-populated.json to 1000 characters |
| An empty detail, leaving a verdict and a kind with nothing after them <br> *edge* | `result.detail === '' && result.skipped !== true` | `apps/web/src/ui/evaluators.tsx:22` | **nothing here.** Set one evaluator `detail` to '' in corpus/.cache/bundles/demo-populated.json |

## Evaluator group

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The same kind twice in one list, nothing numbering them <br> *load bearing* | `run.evaluators contains two results with the same kind` | `apps/web/src/ui/evaluators.tsx:41` | demo-populated, span_observed twice and expect_required_effect twice in every support-desk run |

## Two run cards of one scenario

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| An evaluator that ran in some repetitions and not others <br> *load bearing* | `the same kind is skipped in one run.evaluators and decided in another, for instance metric_threshold when the metric was measured in one repetition and not the next` | `packages/scenarios/src/evaluate.ts:237 then apps/web/src/ui/evaluators.tsx:17` | **nothing here.** In corpus/.cache/bundles/demo-populated.json set skipped true with a reason on the metric_threshold result of one of the five support-desk runs and leave the other four passing |

## What a designer needs to know beyond the list

FIXTURE REALITY. No bundle checked into corpus/.cache/bundles carries a scenario run except demo-populated.json, which is a regenerated apps/demo report rather than a corpus entry. Every state below the definition list (every run card, every meta value, every evaluator row) is reachable from that one file and nothing else. demonstration-system.json is the only fixture with scenarios defined and never run. Fourteen of sixteen fixtures show the whole screen refusal and nothing else, so a designer working from the corpus will see one screen fourteen times and the real screen twice.

WHAT IS NEVER RENDERED. Ten scenario fields reach the browser in the bundle and appear nowhere in apps/web: variant (agents, workers, concurrency, topology, model, promptVersion, toolConfig, env), input.prompt, input.data, initialState, expect (taskSuccess, requiredEffects, prohibitedEffects), target.cwd, target.env, target.stopSignal, cleanup, and metadata. The brief asks for a variant definition row; there is none. Variant reaches this screen only as run.variantId on the run card, so a reader can see a run tagged 'variant agent_count=2' with no declared variant anywhere to compare it against, and several variants of one scenario interleave in one undifferentiated run list. The expect omission is the most consequential: it is what produces the expect_task_success and expect_* effect rows that appear in every run's evaluator list and in no definition row.

NO CONTROLS AT ALL. Not one button, link, filter, sort, disclosure or input. There is no capability gate to be present, disabled with a reason, or absent, because there is no action to gate; the rerun action lives on the finding card (apps/web/src/ui/finding-card.tsx:209) and its own success message tells the reader to regenerate the report to see the result. There is no route parameter for a scenario (apps/web/src/routes.ts has none), no id on any section element and no anchor, so no scenario and no run is linkable. Nothing cross links to Performance, Resilience or Comparisons although the same runIds appear there.

THREE WORDS ARE THE WHOLE VOCABULARY. passed, failed, skipped, in identical faint mono at 9.5px, no hue, no mark, no ordering, no tally. A run with one failure out of twelve and a run with three failures out of three present at the same visual weight. Each run card repeats the full list independently, so support-desk prints the same twelve kinds five times, and there is no per-kind column across runs, no failure count per run and no aggregate. packages/scenarios/src/aggregate.ts already computes reliability, successRate and pass^k over exactly this data and none of it reaches this screen.

TWO SENTENCES THAT CAN BE FALSE. 'It is defined and nothing has executed it' is printed whenever the scenario's runs fell outside the audit's ten run window, which is true of two of the three scenarios in the apps/demo store as it stands today. 'none declared, so nothing decides whether a run of it passed' is printed whenever evaluators is empty, including when an expect block is deciding the run. Both are assertions about the world made from an absence in the bundle.

PER STATE DETAIL, keyed by state id.
section-nothing-defined: the only place on this screen with an h3 eyebrow reading 'Scenarios'. RefusalPanel title, one paragraph, and the command `orchescope test --scenario '<scenario id>'`, single quoted by quoteArg because of the angle brackets and space.
section-nothing-defined-because-repaired: the shell prints 'This report was missing part of itself' above (ui/shell.tsx:252) while the screen asserts 'No scenario is defined'. Nothing reconciles the two.
section-cards: the populated screen has no 'Scenarios' heading of any kind. The h3 is the scenario name; the eyebrow above it is a plain <p> reading 'Scenario'. The heading hierarchy therefore differs between the empty and populated states.
section-exactly-one-scenario: no .block + .block rule is drawn, so the page has no horizontal separator anywhere. Nothing counts scenarios, so there is no singular form to select.
section-many-scenarios: every scenario renders its full definition list and every run card unconditionally. Card order is ORDER BY id from the store (packages/persistence/src/repositories/scenarios.ts:42), so alphabetical by identifier and not by name.
section-orphan-block-present: an h3 eyebrow with a count, the lede 'Kept rather than dropped, so a run is never silently lost', and a plain list showing only `runId scenarioId` in mono plus `scenarioName, Status` muted. Duration, task outcome, variant, faults applied and every evaluator result are dropped, so an orphan run is a strictly poorer rendering of the same shape the run card renders in full.
section-orphans-only: the early return needs both arrays empty, so this falls through and the orphan block is the whole page. No sentence says no scenario is defined and no orchescope command appears anywhere. The nav count also vanishes, because ui/shell.tsx:128 counts bundle.scenarios.length.
section-orphans-exactly-one: heading stays plural with the count 1 beside it; the lede still says 'a run is never silently lost'.
card-description-present: .lede at 12.5px muted. The three real descriptions are 318, 326 and 343 characters and carry authored newlines that collapse to spaces.
card-description-absent: no placeholder and no absence word; the only difference is vertical rhythm.
card-description-at-ceiling: no clamp, no disclosure, no measure specific to .lede, so 2000 characters run ahead of the definition list.
rows-baseline-ten: Identifier, Command, Result source, Timeout, Repetitions, Seed, Evaluators, Declared faults, Permissions it requires, Budgets. Each says a word when its value is absent; Tags is the single exception.
rows-tags-present: comma joined, not mono, no per tag chip. Real values 'support, refund, baseline'.
rows-tags-absent: two cards side by side then have different row counts and the labels below Budgets no longer align between them. Inconsistent with Declared faults, Permissions and Budgets, which all say 'none' or 'none set' in place.
rows-seed-absent: a word rather than a dash. The one place a reader learns a run is not reproducible.
rows-seed-present-ungrouped: String(scenario.seed) bypasses formatInteger, so 1234567 reads '1234567' where Repetitions of the same value reads '1 234 567'. Real seeds are 1, 7 and 11, so the divergence is invisible in every fixture.
rows-repetitions-absent-word: this is the singular selector in the list. Unset is the spelled word 'one'; an explicit 1 is the numeral. The same fact reaches the page two ways.
rows-repetitions-exactly-one: support-desk-duplicate and support-desk-faults both set 1 explicitly.
rows-repetitions-large: formatInteger uses a plain space as the group separator. Pairs badly with the runs group below, which shows at most as many cards as the audit run limit allowed.
rows-permissions-none: the code flag is requiredPermissions.length > 0, so the row switches typeface with the count. Typeface is carrying presence of data, a second signal that has to stay in step with the word.
rows-permissions-present: five possible literals, process:spawn, network:loopback, network:outbound, model:paid, filesystem:write. Only the first two occur in any fixture. Comma joined into one mono string with no separation between grant and resource.
rows-faults-none: support-desk declares none.
rows-faults-one: humanise on the kind, raw target after the word 'into'. Everything else on FaultSpec (probability, attempts, maxApplications, delayMs, delivery, payload) is discarded.
rows-faults-many: support-desk-faults declares 8, producing 'Tool exception into issue_refund; Tool timeout into issue_refund; Tool timeout into check_inventory; Model rate limited into demo-small; Model malformed structured output into demo-small; Retrieval empty into policy-store; Worker unavailable into inventory-worker; Prompt injection in content into policy-store' in one 12.5px dd. Two of the eight target the same component and the string gives a reader no way to see that. The densest cell on the screen.
rows-budgets-none: 'none set' rather than the 'none' used two rows above. Three absence words on one list: none, none set, not fixed.
rows-budgets-present: humanise only uppercases the first letter and expands underscores, and the keys are camelCase, so a reader gets 'MaxDurationMs 30000, MaxModelCalls 200, MaxRetries 20, MaxTokens 200000'. Values go through String(), not formatDuration, formatUsd or formatInteger, so 'MaxDurationMs 30000' sits two rows under 'Timeout 30.00 s' expressing the same 30 seconds differently, and maxCostUsd would render as a bare number with no currency.
rows-budgets-order: the bundle is written canonically, so keys arrive alphabetically and the row reads MaxDurationMs, MaxModelCalls, MaxRetries, MaxTokens rather than the schema order. The order is a property of the serialiser, not a decision.
rows-evaluators-none-declared: 'none declared, so nothing decides whether a run of it passed'. The only definition value on the screen that is an argued sentence rather than a value, so it wraps to two or three lines where every neighbour is one.
rows-evaluators-none-declared-but-expect-set: scenario.expect is checked as evaluators by the runner, so a scenario with no declared evaluators and an expect block still produces expect_* verdicts. The row asserts nothing decided the run while the list below shows the things that did.
rows-evaluators-listed: kind only, never the argument, so 'exit_code' does not say 0 and 'metric_threshold' does not say which metric. support-desk declares span_observed twice and the row reads '... span_observed, span_observed ...'. Nine kinds exist; model_judge occurs in no fixture.
rows-declared-vs-run-evaluator-mismatch: support-desk declares 8 and each of its run cards carries 12, the extra four being expect_task_success and three expect_* effect checks that appear in no definition row. A reader comparing the two finds four kinds they were never told about.
rows-result-source: renders 'Result file', 'Root span', 'Exit code'. Only the first has ever been seen. The row does not say what the choice implies, and it is the row that decides whether taskSuccess on the run card can ever be anything but 'not reported'.
rows-timeout-bands: timeoutMs is a PositiveInt, so the sub millisecond band is unreachable and the floor is '1.0 ms'. A five minute timeout reads '5 min 0.0 s', the only two unit value the definition list can produce.
rows-command-quoting: every fixture's command is `node src/main.ts`, which needs no quoting, so the quoted form has never been seen here. minItems 1, no maximum; the row is mono with overflow-wrap: anywhere.
rows-command-redacted: the whole bundle passes through redactDeep, so any scenario string can arrive as '[redacted:label:length]', including the description, a fault target, a tag or an evaluator detail. quoteArg then wraps it in single quotes because of the brackets. There is no styling that marks a withheld value as withheld on this screen; it reads as data.
runs-zero: the h4 prints the numeral 0, then a RefusalPanel: 'This scenario has never been run in this report.' with 'It is defined and nothing has executed it, so its evaluators have decided nothing about this system.' and `orchescope test --scenario support-desk`. All three demonstration-system scenarios are in this state, so the report stacks three near identical refusals.
runs-zero-because-outside-run-window: the panel's sentence is false. The screen has no concept of a run window and never says how many runs the report considered. The most misleading state here, and reachable from the repository as it stands.
runs-exactly-one: the count reads '1' and the heading stays plural. The single card still carries its dashed top border, so it reads as a continuation of the definition list rather than as a standalone.
runs-several: order is bundle order, which is ORDER BY started_at DESC, rowid DESC from the store, so newest first. Nothing on a card says when a run happened, so the ordering is implied and not visible.
runs-exceed-repetitions: runs accumulate across invocations of test, benchmark and chaos, and nothing groups a card by invocation. The Repetitions row and the runs count sit ten rows apart and disagree in two of the three real scenarios, with no sentence acknowledging it.
runs-truncated-by-limit: the count beside 'Runs of this scenario' is the number of runs that survived into the bundle, never the number that happened. There is no 'showing 10 of 100' sentence, which is exactly the disclosure the delta bar and the map both make when they change what they are showing.
runs-very-many: no ceiling, no pagination, no virtualisation, no rollup. 200 runs of support-desk means 2400 evaluator rows under one h4 with no way to jump to the failures, and the count is String(count) so it reads '200' where every other number is grouped.
run-status-completed: the only status any fixture or any run in the demonstration store has carried. 47 of 47 stored scenario runs are completed.
run-status-failed: a plain humanised word in the faint mono meta line with a middle dot either side, identical in weight to 'Completed'. Nothing about a failed run is emphasised, sorted forward or coloured, by design.
run-status-timeout: produced when the run exceeds target.timeoutMs, which is the Timeout row above. The card does not link the two.
run-status-cancelled: the only status where the duration and the evaluator list describe a run that was stopped rather than one that finished, and nothing on the card says so.
run-status-budget-exceeded: its cause is stated elsewhere on the same card, in the Budgets row, but it does not say which budget was breached.
run-status-running: a report is a static snapshot, so a run recorded as running was never resolved; its duration and evaluator list are then meaningless and the card presents them as final.
run-status-unknown-token: humanise passes it through with the first letter uppercased and underscores expanded. No fallback word, and no way to tell a known status from an unknown one, which is the opposite of how basis.ts and describeSeverity treat an unrecognised token elsewhere in the workspace.
run-task-success-false: normally paired with status Completed, because the process exited cleanly and the task did not succeed. 'Completed / task failed' on one line reads as a contradiction unless a reader already knows the two words describe different things, the process and the work.
run-task-success-absent: three states in one meta slot and the absent one is the longest string of the three, so the middle dot separators shift. Reachable in reality whenever target.resultSource is exit_code, or the target never wrote its result file. It also implies a skipped expect_task_success in the list below, so the two should be designed as a pair.
run-variant-present: real values are agent_count=1, agent_count=2, agent_count=4, produced by the benchmark command. This is the only place the word variant appears on the screen.
run-faults-one-opaque-id: audit.ts:279 puts the fault PLAN id here, not fault kinds, so the reader gets a 16 hex digit digest. The Declared faults row on the same card names eight faults in words and nothing maps the digest to any of them; two runs of support-desk-faults with different plans look identical apart from the digest. The largest gap on the screen between what the data means and what the sentence says.
run-faults-several: unreachable from the pipeline, which emits `run.faultPlanId === undefined ? [] : [run.faultPlanId]`, so exactly zero or one. The schema permits an unbounded array, so an imported bundle reaches it.
run-duration-zero: falls into the sub millisecond branch where formatNumber sees an integer and skips the decimals. A zero duration is a measurement here, not an absence, and the card gives no way to tell it from a run that was never timed.
run-duration-long: materially wider than the 174.0 ms every fixture shows. The other bands, '0.123 ms' below 1ms and '1.50 s' between 1s and 60s, are each a distinct width in the same slot.
evaluators-empty: a single .note paragraph, 'No evaluator result was recorded for this run, so nothing judged it.' The Evaluators h4 and its count are not rendered at all, so the card loses a heading level and the note sits directly under the meta line. Reachable when the run has no stored scenario result (audit.ts:279 falls back to []), for instance a run whose result artifact was pruned, or a scenario with neither evaluators nor an expect block.
evaluators-one: the h4 reads 'Evaluators' with a count of 1; there is no singular form.
evaluators-several: h4 with String(count) beside it, then a plain list. Order is fixed: declared evaluators in declaration order, then expect_task_success, then each requiredEffect, then each prohibitedEffect. This h4 is a sibling of the 'Runs of this scenario' h4 rather than a level below it, so heading navigation flattens the run boundary.
evaluator-passed: real details are short. 'the target exited with code 0, expected 0', 'operation chat was observed 3 times'. The longest detail in any fixture is 78 characters.
evaluator-failed: in demo-populated, support-desk-duplicate's three runs are 3 failures out of 3 rows while support-desk's third run is 1 failure out of 12, and the two cards look the same at a glance.
evaluator-skipped: the third word the screen is built around and no fixture reaches it. result.detail is discarded and result.skipReason is shown instead, so the two row shapes carry different sentences. Three producers exist: a metric_threshold whose metric was not measured in that run ('metric duplicateSideEffects was not measured'); model_judge, which is always and permanently skipped in this build ('analysis in this build is deterministic, so a judged question is recorded and never answered'); and expect_task_success when the target reported no task outcome ('the target reported no task outcome'). A skipped result always also carries passed:false, so anything reading passed alone would score it a failure.
evaluator-skipped-no-reason: unreachable from this build's pipeline, since all three skip producers set a reason. The schema makes skipReason optional, so an imported or hand written bundle reaches it, and the row then says a thing did not run and cannot say why.
evaluator-skipped-false-explicit: the check is a strict === true, so an explicit false renders exactly as an absent field. Three data shapes collapse to two renderings.
evaluator-duplicate-kinds: two rows with identical mono kind and different details, and the React key is `kind:offset` precisely because the kind is not unique. The detail is the only place the argument (operation, effect, target) ever appears, so a reader must read it to know which declaration each row answers.
evaluator-varies-across-runs: the screen has no cross run view, so the only way to see an inconsistent evaluator is to read five cards and diff them by eye. Twelve evaluators over five runs is 60 rows with no per kind column, no per kind tally and no 'skipped in 2 of 5' sentence.
evaluator-long-detail: the row is a wrapping flex with a 7ch verdict column and no truncation, no title attribute and no disclosure, so a 1000 character detail becomes a paragraph inside a list item and pushes verdict and kind onto a line of their own. Reachable in reality: output_contains_all lists every missing value and effect descriptions carry targets.
evaluator-empty-detail: the schema is Type.String({maxLength: 2000}) with no minLength, so the empty string validates. The muted span then renders a single space, which is the empty cell indistinguishable from a rendering fault that the workspace refuses everywhere else.

