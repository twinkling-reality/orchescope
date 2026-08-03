# Resilience: every state

78 states across 25 blocks. 39 of them are reached by no report in `corpus/.cache/bundles`, so `pnpm states` will not show them to you and the fourth column says what would.

Source: `Resilience screen (apps/web/src/sections/resilience.tsx and apps/web/src/ui/evaluators.tsx)`.

## Thresholds

| Constant | Value | Where | What it switches | Why that number |
| --- | --- | --- | --- | --- |
| `chaosReports empty` | 0 | `apps/web/src/sections/resilience.tsx:184` | At zero the whole screen is one refusal panel carrying an h3 Resilience eyebrow and a command. Above zero the eyebrow disappears entirely and the screen is a bare list of run blocks with no screen level heading, count or lede. | The workspace rule that every screen has an empty state naming the command that would fill it. Documented in docs/design/report-system.md. |
| `outcomes empty` | 0 | `apps/web/src/sections/resilience.tsx:159` | At zero the outcome list is replaced by a refusal panel saying the run injected nothing. Above zero, one full group per outcome and no panel. | Stated in the file header: a chaos suite that quietly skipped its plan and reported success is worse than no suite. |
| `notApplied empty` | 0 | `apps/web/src/sections/resilience.tsx:105` | At zero, the sentence 'Every requested fault was applied.' Above zero, a three column table. The eyebrow's count chip renders 0 either way. | Same header rule: the not applied set is kept visible so the suite cannot appear more thorough than it was. |
| `unsafeEffects trigger` | duplicateSideEffects > 0 \|\| prohibitedSideEffects > 0 | `apps/web/src/sections/resilience.tsx:67` | Adds a refusal panel below the definition list naming both counts and defining the two words. One count may still be zero inside the panel. | Taste, undocumented in the file. The CLI uses a different and stricter rule for the same idea, marking an outcome as a warning only on duplicateSideEffects > 0 (run-commands.ts:298), so the two surfaces disagree about what counts as unsafe. |
| `evaluator results empty` | 0 | `apps/web/src/ui/evaluators.tsx:31` | At zero, a single note passed in by the caller: 'No evaluator ran for this outcome, so nothing decided whether it passed.' Above zero, an Evaluators h4 with a count chip and one li per result. | Stated in the file header: an evaluator that did not run has not agreed with anything. |
| `skipped precedence` | result.skipped === true | `apps/web/src/ui/evaluators.tsx:16-17` | Overrides result.passed entirely, so the verdict word becomes 'skipped' and the third column becomes skipReason instead of detail. | Stated in the file header. Three words rather than three colours, because skipped is neither good nor bad. |
| `formatDuration unit breaks` | 1 ms, 1000 ms, 60000 ms | `apps/web/src/format.ts:69,72,75` | Recovery time renders as three decimals of a millisecond, one decimal of a millisecond, two decimals of a second, or minutes and one decimal of a second. Only the second of the four is reached today. | Taste, undocumented. Note formatNumber's integer short circuit means the one decimal branch usually prints no decimal at all. |
| `formatNumber integer short circuit` | Number.isInteger(value) | `apps/web/src/format.ts:39` | An integer ratio prints with no decimals and a fractional one with two, so '1 times the baseline retries' and '0.50 times the baseline retries' sit in the same column at different lengths. formatFixed exists precisely to avoid this and is not used here. | Documented at format.ts:52: a count has no scaling to state, so it stays integral. Applied to a ratio, which does have scaling to state. |
| `digit grouping` | 3 | `apps/web/src/format.ts:6` | Counts and ratios at or above one thousand gain a thin space, so loopIterations can read '1 234'. | Locale independent grouping, so the same bundle reads the same on every machine. Stated at the top of format.ts. |
| `Eyebrow count chip presence` | props.count !== undefined | `apps/web/src/ui/primitives.tsx:38` | Renders the chip whenever the prop is passed, including at zero. The chrome applies the opposite rule at ui/shell.tsx:118, omitting a count of zero, so 'Faults requested and not applied 0' is the one place in the workspace where a zero count chip appears. | The chrome's rule is documented: a navigation of zeros reads as chrome. The primitive itself has no rule and the section passes the count unconditionally. |
| `verdict column reserve` | 7ch | `apps/web/src/styles.css:1526` | Reserves the width of the longest of the three words, 'skipped', so a list of only passed and failed rows still carries a gap sized for a word it does not contain. | Taste, undocumented. It is what keeps the three verdicts in one column. |
| `outcome, evaluator and report list ceilings` | none | `apps/web/src/sections/resilience.tsx:167,204; apps/web/src/ui/evaluators.tsx:40` | Nothing. Every other screen in this workspace states a ceiling and says which reading it is giving above it: the delta bar at CELL_LIMIT 120, the map canvas at NAMEABLE_CEILING 120, the findings at 25 components. Resilience renders every outcome, every evaluator and every chaos report at full detail with no cap, no collapse and no statement of scale. | Not derived, because it does not exist. Scenario.faults has no maxItems, the store returns up to 50 chaos reports, and EvaluatorResult arrays are unbounded, so all three lists are unbounded by construction. |

## Resilience, whole screen

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| No fault injection has been run <br> *load bearing* | `bundle.chaosReports.length === 0` | `apps/web/src/sections/resilience.tsx:184` | orchescope-discovery, flask, express, axios, demonstration-system, vercel-ai-chatbot, vercel-ai-chatbot-exercised, anthropic-quickstarts, langgraphjs, openai-agents-js, langgraph, crewai, openai-agents-python, pydantic-ai, pydantic-ai-exercised |
| Exactly one chaos run, and no screen level heading at all <br> *load bearing* | `bundle.chaosReports.length === 1. The populated branch is a bare fragment: there is no 'Resilience' eyebrow, no count and no lede, only the run's own block.` | `apps/web/src/sections/resilience.tsx:202-208` | demo-populated |
| Several chaos runs stacked with nothing separating or ordering them <br> *load bearing* | `bundle.chaosReports.length > 1. Audit keeps the newest report per (scenarioId, environment) pair from the 50 most recent, so the store's started_at DESC order reaches the page, but the page never says the order or how many there are.` | `apps/web/src/sections/resilience.tsx:204; packages/usecases/src/audit.ts:67; packages/persistence/src/repositories/experiments.ts:63` | **nothing here.** In apps/demo run orchescope chaos --scenario support-desk-faults then orchescope chaos --scenario support-desk-duplicate, then audit. Two reports. |
| Up to fifty chaos runs on one screen <br> *edge* | `bundle.chaosReports.length is large. There is no ceiling, no index and no collapse anywhere on this screen.` | `apps/web/src/sections/resilience.tsx:204` | **nothing here.** Add scenarios with distinct ids each declaring faults and run chaos on each; every distinct (scenario, environment) pair adds a full block. |

## Resilience, refusal command block

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Command names the bundle's first scenario <br> *load bearing* | `chaosReports.length === 0 && bundle.scenarios.length > 0; prints orchescope chaos --scenario <scenarios[0].id>` | `apps/web/src/sections/resilience.tsx:182,191; apps/web/src/commands.ts:35` | demonstration-system |
| Command carries a quoted placeholder <br> *load bearing* | `chaosReports.length === 0 && bundle.scenarios.length === 0; quoteArg quotes '<scenario id>' because of the angle brackets and space` | `apps/web/src/commands.ts:35; apps/web/src/format.ts:178` | orchescope-discovery, flask, express, axios, vercel-ai-chatbot, vercel-ai-chatbot-exercised, anthropic-quickstarts, langgraphjs, openai-agents-js, langgraph, crewai, openai-agents-python, pydantic-ai, pydantic-ai-exercised |
| The printed command names a faultless scenario and the CLI refuses it <br> *load bearing* | `chaosReports.length === 0 && bundle.scenarios[0].faults.length === 0. The section takes scenarios[0] blindly; the demo's scenarios[0] is support-desk with faults: []. run-commands.ts exits with a user error, 'scenario support-desk declares no faults'.` | `apps/web/src/sections/resilience.tsx:182; apps/cli/src/commands/run-commands.ts:335` | demonstration-system |
| The printed command names a scenario that does declare faults <br> *ordinary* | `chaosReports.length === 0 && bundle.scenarios[0].faults.length > 0` | `apps/web/src/sections/resilience.tsx:182` | **nothing here.** Delete or rename apps/demo/scenarios/support-desk.yaml so support-desk-duplicate or support-desk-faults sorts first, re-audit, and re-export demonstration-system. |

## Resilience plus the shell banner

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| chaosReports absent from the document, repaired to empty <br> *edge* | `the key chaosReports is not an array in the loaded JSON, so bundle.ts fills [] and pushes 'chaosReports' onto repaired` | `apps/web/src/bundle.ts:30,137` | **nothing here.** Delete the chaosReports key from a standalone export's embedded JSON and reopen it. Renders the shell's 'This report was missing part of itself' note above the no-chaos-run refusal. |

## Chaos run definition list, Environment row

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Environment reads 'deterministic and offline' <br> *load bearing* | `report.environment === 'local_deterministic'` | `apps/web/src/sections/resilience.tsx:153` | demo-populated |
| Environment reads the long variance sentence <br> *load bearing* | `report.environment !== 'local_deterministic'. declared_test and live are two schema values that render one identical sentence; the reader cannot tell which it was from this row.` | `apps/web/src/sections/resilience.tsx:152-156; packages/schema/src/chaos.ts:84` | **nothing here.** Add 'declared_test' to policy.allowedChaosEnvironments in apps/demo/manifest.yaml, then orchescope chaos --scenario support-desk-faults --environment declared_test. |

## Chaos run lede

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The environment token is humanised mid sentence <br> *ordinary* | `always. humanise('local_deterministic') gives 'Local deterministic', so the lede reads 'in the Local deterministic environment' with a capital inside the sentence. 'Declared test' and 'Live' do the same.` | `apps/web/src/sections/resilience.tsx:138; apps/web/src/format.ts:146` | demo-populated |

## Chaos run block

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The run identifier is the h3 and 'Chaos run' is only a paragraph <br> *load bearing* | `always. Eyebrow with no level prop renders a <p>, so the heading outline is h2 Resilience then h3 chaos_e2edf70a3a2cbc45. A reader navigating by heading gets a hash, never the word 'Chaos run'.` | `apps/web/src/sections/resilience.tsx:135-137; apps/web/src/ui/primitives.tsx:55` | demo-populated |
| No fault was applied in this run <br> *load bearing* | `report.outcomes.length === 0` | `apps/web/src/sections/resilience.tsx:159-165` | **nothing here.** Write a scenario whose only fault has a kind the demonstration target does not implement, for instance kind: auth_expired (SUPPORTED_KINDS in apps/demo/src/faults.ts holds 11 of the schema's 18), run chaos on it, and audit. |
| Zero outcomes, and the not applied table below actually lists them <br> *load bearing* | `report.outcomes.length === 0 && report.notApplied.length > 0. This is the state the refusal panel's copy assumes, since it says the intended faults are listed below.` | `apps/web/src/sections/resilience.tsx:160-165 with :108` | **nothing here.** Same as run-with-zero-outcomes: every declared fault goes unapplied. |
| Two panels that contradict each other <br> *edge* | `report.outcomes.length === 0 && report.notApplied.length === 0. The refusal says the intended faults are listed below with the reason each was not applied, and the block immediately below says 'Every requested fault was applied.'` | `apps/web/src/sections/resilience.tsx:160-165 and :105-106` | **nothing here.** Not producible by the CLI: chaosCommand exits early when scenario.faults is empty, and runChaosSuite pushes a notApplied entry for every fault that yields no outcome. Reachable only by hand editing outcomes and notApplied to [] in an embedded bundle. |
| Exactly one fault outcome <br> *load bearing* | `report.outcomes.length === 1` | `apps/web/src/sections/resilience.tsx:167` | **nothing here.** Run chaos on apps/demo/scenarios/support-desk-duplicate.yaml, which declares a single tool_timeout fault. |
| Eight fault outcome blocks in a row <br> *load bearing* | `report.outcomes.length === 8; eight groups, each with a 4 line header, an 8 row definition list and an evaluator list` | `apps/web/src/sections/resilience.tsx:167` | demo-populated |
| A very large number of outcomes, with no ceiling <br> *edge* | `report.outcomes.length is large. Scenario.faults has no maxItems and this screen has no CELL_LIMIT, no NAMEABLE_CEILING and no 25 component cut. Fifty faults renders fifty blocks and four hundred definition rows.` | `apps/web/src/sections/resilience.tsx:167; packages/schema/src/scenario.ts:141` | **nothing here.** Declare 40 faults across the 11 kinds the demo target supports, on several targets, and run chaos. |

## Chaos run definition list, Started and Finished

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A timestamp that does not match the pattern renders raw <br> *edge* | `formatTimestamp regex misses, e.g. a timestamp with no milliseconds. bundle.ts validates identity, graph and summary only, never the chaos reports, so an embedded bundle can carry one.` | `apps/web/src/format.ts:158; apps/web/src/sections/resilience.tsx:142-143` | **nothing here.** Hand edit startedAt in a standalone export's embedded JSON to 2026-07-27T18:51:41Z and reopen. |

## Chaos run definition list

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Started and Finished, never a duration <br> *ordinary* | `always. Both timestamps are printed; the suite's elapsed time is never computed, so a reader subtracts by hand.` | `apps/web/src/sections/resilience.tsx:141-143` | demo-populated |
| The seed and the repetitions per fault are in the bundle and never on the page <br> *load bearing* | `always. report.metadata holds {seed, repetitionsPerFault} and no row reads it, so 'Applied 2 times' has no denominator and the run's reproducibility is unstated.` | `apps/web/src/sections/resilience.tsx:140-158; packages/chaos/src/run.ts:86` | demo-populated |

## Chaos run definition list, Faults applied

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| 'Faults applied' is the number of outcomes, not the number of injections <br> *load bearing* | `always. The row shows report.outcomes.length while each outcome's own note says 'Applied N times', so demo-populated reads 'Faults applied 8' against 16 actual applications.` | `apps/web/src/sections/resilience.tsx:145 against :72` | demo-populated |

## Chaos run definition list, Baseline run

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The baseline run id is mono, unlinked, and is in no other part of the bundle <br> *load bearing* | `always in practice. bundle.runs.some(r => r.id === report.baselineRunId) is false for demo-populated, and false for every outcome runId too, so none of the nine identifiers on this screen can be looked up on Performance.` | `apps/web/src/sections/resilience.tsx:144` | demo-populated |

## Fault outcome headers

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Two outcomes whose eyebrows differ only in the target <br> *load bearing* | `two entries of report.outcomes share faultKind. demo-populated has tool_timeout into issue_refund and tool_timeout into check_inventory, which behave oppositely (one recovers with duplicates, one never completes).` | `apps/web/src/sections/resilience.tsx:70` | demo-populated |

## Fault outcome header

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A name from the analysed repository set in the all caps eyebrow <br> *load bearing* | `always. The h4 is `${humanise(faultKind)} into ${target}` and .eyebrow is text-transform: uppercase, so issue_refund reaches the page as ISSUE_REFUND. report-system.md states a name that came out of the analysed repository is never set in an eyebrow.` | `apps/web/src/sections/resilience.tsx:70; apps/web/src/styles.css:293-300` | demo-populated |
| The target is the wildcard, so the heading reads 'into *' <br> *ordinary* | `outcome.target === '*'. chaosOutcome copies fault.target verbatim, and FaultSpec documents '*' as targeting every match.` | `apps/web/src/sections/resilience.tsx:70; packages/chaos/src/outcome.ts:91; packages/schema/src/chaos.ts:57` | **nothing here.** Change one fault in support-desk-faults.yaml to target: '*' and rerun chaos. |
| The longest fault kind wrapping in 10px letterspaced caps <br> *load bearing* | `faultKind is one of the long ones. MODEL MALFORMED STRUCTURED OUTPUT INTO DEMO-SMALL and PROMPT INJECTION IN CONTENT INTO POLICY-STORE both reach the page today; SIDE EFFECT PARTIAL SUCCESS INTO <target> is the longest the schema allows. Target has no maxLength.` | `apps/web/src/sections/resilience.tsx:70; packages/schema/src/chaos.ts:57` | demo-populated |

## Fault outcome note

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| 'Applied 1 times' when the fault landed once <br> *load bearing* | `outcome.appliedCount === 1. The sentence is a template with a hard coded 'times'; format.ts has a pluralise helper and this line does not use it.` | `apps/web/src/sections/resilience.tsx:71-73; apps/web/src/format.ts:173` | **nothing here.** Run orchescope chaos --scenario support-desk-faults with the scenario's own repetitions: 1 (do not pass --repetitions 2). Every outcome then carries appliedCount 1. Verified live. |
| 'Applied N times' with N above one <br> *load bearing* | `outcome.appliedCount > 1. demo-populated was run at two repetitions per fault, so every outcome reads 'Applied 2 times'.` | `apps/web/src/sections/resilience.tsx:72` | demo-populated |
| 'Applied 0 times' on an outcome that exists <br> *edge* | `outcome.appliedCount === 0. NonNegativeInt permits it, but chaosOutcome returns undefined at zero so the pipeline sends it to notApplied instead.` | `apps/web/src/sections/resilience.tsx:72; packages/chaos/src/outcome.ts:70` | **nothing here.** Hand edit appliedCount to 0 on an outcome in an embedded bundle. |
| The outcome's run id sits in prose, not in mono <br> *ordinary* | `always. 'in run run_03b30e3dd85894a3' is inside a class=note paragraph, while the report's baseline run id one block above is a definition row with code: true.` | `apps/web/src/sections/resilience.tsx:72 against :144` | demo-populated |

## Fault outcome meta line

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| task completed, recovered, degraded gracefully <br> *load bearing* | `taskCompleted && recovered && degradedGracefully` | `apps/web/src/sections/resilience.tsx:74-80` | demo-populated |
| task completed, recovered, did not degrade gracefully <br> *load bearing* | `taskCompleted && recovered && !degradedGracefully. degradedGracefully is the stricter predicate: the task completed but at least one scenario assertion about the failure path did not hold.` | `apps/web/src/sections/resilience.tsx:74-80; packages/chaos/src/outcome.ts:106` | demo-populated |
| task did not complete, did not recover, did not degrade gracefully <br> *load bearing* | `!taskCompleted && !recovered && !degradedGracefully. The worst case, and the only one where the three words are all negative and the line is at its longest.` | `apps/web/src/sections/resilience.tsx:74-80` | demo-populated |
| task completed, did not recover, degraded gracefully <br> *ordinary* | `taskCompleted && !recovered && degradedGracefully. Needs more than one repetition: a repetition that succeeded without the fault landing on it, plus another that carried the fault and failed.` | `apps/web/src/sections/resilience.tsx:74-80; packages/chaos/src/outcome.ts:74-76` | **nothing here.** Run chaos with --repetitions 3 and a fault at probability 0.4 so some repetitions get it and some do not. |
| task completed, did not recover, did not degrade gracefully <br> *ordinary* | `taskCompleted && !recovered && !degradedGracefully` | `apps/web/src/sections/resilience.tsx:74-80` | **nothing here.** As above, with an evaluator that fails on the repetition that carried the fault. |
| did not complete, yet recovered <br> *edge* | `!taskCompleted && recovered. Schema legal, since both are independent booleans, and impossible from the pipeline because recovered requires a repetition that succeeded, which forces taskCompleted true.` | `apps/web/src/sections/resilience.tsx:75-76; packages/chaos/src/outcome.ts:94-96` | **nothing here.** Only a hand written or third party bundle. Worth a design decision: the screen would print a self contradicting meta line without comment. |
| did not complete, yet degraded gracefully <br> *edge* | `!taskCompleted && degradedGracefully. Same shape: degradedGracefully is computed as taskCompleted && appliedCount > 0 && some repetition satisfied everything, so the pipeline cannot emit it.` | `apps/web/src/sections/resilience.tsx:75,78; packages/chaos/src/outcome.ts:106` | **nothing here.** Only a hand written bundle. |

## Fault outcome definition list, Recovery time

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A recovery time in milliseconds <br> *load bearing* | `outcome.recoveryTimeMs !== undefined && < 1000. formatDuration takes the sub second branch, and formatNumber leaves a whole number whole, so it reads '189 ms' and never '189.0 ms'.` | `apps/web/src/sections/resilience.tsx:31; apps/web/src/format.ts:72` | demo-populated |
| Recovery time reads 'not measured' <br> *load bearing* | `outcome.recoveryTimeMs === undefined. Emitted whenever nothing recovered, and also when a repetition recovered with zero retries, so 'recovered' and a recovery time are not the same question.` | `apps/web/src/ui/primitives.tsx:375; packages/chaos/src/outcome.ts:77-80` | demo-populated |
| A recovery time in seconds <br> *ordinary* | `outcome.recoveryTimeMs >= 1000 && < 60000, so it reads '2.30 s' with two forced decimals` | `apps/web/src/format.ts:75` | **nothing here.** Raise the fault's delayMs in support-desk-faults.yaml to about 1200 so the repetition's durationMs crosses a second. |
| A recovery time in minutes and seconds <br> *edge* | `outcome.recoveryTimeMs >= 60000, so it reads '1 min 5.0 s'` | `apps/web/src/format.ts:79-81` | **nothing here.** Needs budgets.maxDurationMs above 60000 in the scenario and a fault slow enough to reach it. |
| A recovery time of zero, which is a measurement and not an absence <br> *edge* | `outcome.recoveryTimeMs === 0, which is below 1 so it takes the three decimal branch and formatNumber shortens it to '0 ms'. It must not look like the 'not measured' word beside it.` | `apps/web/src/format.ts:69` | **nothing here.** Hand edit recoveryTimeMs to 0 in an embedded bundle. |

## Fault outcome definition list, Cost amplification

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A cost ratio above one <br> *load bearing* | `outcome.costAmplification !== undefined && not an integer, so formatNumber gives two decimals: '3.55 times the baseline token spend'` | `apps/web/src/sections/resilience.tsx:36-40` | demo-populated |
| A fault that made the system cheaper <br> *load bearing* | `outcome.costAmplification < 1, reading '0.53 times the baseline token spend'. demo-populated's tool_timeout into check_inventory spends half the baseline because the task died early. The wording never signals that this is a bad sign rather than a saving.` | `apps/web/src/sections/resilience.tsx:38` | demo-populated |
| A whole number ratio with no decimals <br> *ordinary* | `Number.isInteger(outcome.costAmplification), because formatNumber short circuits integers, so '4 times' sits in the same column as '3.55 times'` | `apps/web/src/format.ts:39` | **nothing here.** Hand edit costAmplification to 4 in an embedded bundle, or contrive a run whose token means divide exactly. |
| Cost amplification reads 'not measured' <br> *ordinary* | `outcome.costAmplification === undefined, emitted when the baseline's mean of inputTokens + outputTokens is zero, because a ratio over nothing measured is not a measurement` | `packages/chaos/src/outcome.ts:57; apps/web/src/ui/primitives.tsx:375` | **nothing here.** Run chaos against a target that makes no model calls, so the baseline run records zero tokens. |
| A four figure ratio grouped by thin space <br> *edge* | `outcome.costAmplification >= 1000, so groupDigits gives '1 234.50 times the baseline token spend'` | `apps/web/src/format.ts:6,46` | **nothing here.** A baseline that spent a handful of tokens and a fault run that loops. Hand editable. |

## Fault outcome definition list, Retry amplification

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| '0 times the baseline retries' <br> *load bearing* | `outcome.retryAmplification === 0, meaning the fault run retried nothing while the baseline did. Sits one row below a 'not measured' word, and the design rule is that these two must not be confusable.` | `apps/web/src/sections/resilience.tsx:44-47` | demo-populated |
| '1 times the baseline retries' <br> *load bearing* | `outcome.retryAmplification === 1. Integer, so no decimals, and the hard coded 'times' makes it read wrong.` | `apps/web/src/sections/resilience.tsx:46` | demo-populated |
| A fractional retry ratio <br> *load bearing* | `!Number.isInteger(outcome.retryAmplification), giving '0.50 times' and '1.50 times' in the same column as '0 times' and '1 times'` | `apps/web/src/format.ts:39` | demo-populated |
| Retry amplification reads 'not measured' <br> *load bearing* | `outcome.retryAmplification === undefined, emitted whenever the baseline run retried nothing at all, which is the normal case for a healthy system` | `packages/chaos/src/outcome.ts:57,86; apps/web/src/ui/primitives.tsx:375` | **nothing here.** Run chaos against a scenario whose baseline completes with zero retries. Very likely in the wild and reached by no fixture, so it has never been looked at. |

## Fault outcome definition list, the five counters

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Five counter rows reading zero <br> *load bearing* | `duplicateSideEffects, prohibitedSideEffects, userInterventions, loopIterations and policyViolations are all rendered as Data with no nil styling, so a genuine zero looks identical to a measured value. userInterventions and policyViolations are zero on every demo-populated outcome.` | `apps/web/src/sections/resilience.tsx:51-61` | demo-populated |
| A four figure counter grouped by thin space <br> *edge* | `any counter >= 1000, so formatInteger gives '1 234'. loopIterations is the one that realistically grows, since it is summed across repetitions.` | `apps/web/src/format.ts:6,32` | **nothing here.** Run chaos at a high --repetitions against a scenario with a looping agent. |

## Fault outcome

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| No side effects panel at all <br> *load bearing* | `outcome.duplicateSideEffects === 0 && outcome.prohibitedSideEffects === 0` | `apps/web/src/sections/resilience.tsx:67,82` | demo-populated |

## Fault outcome refusal panel

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| '0 duplicate and 1 prohibited' <br> *load bearing* | `duplicateSideEffects === 0 && prohibitedSideEffects > 0. The panel's own sentence opens with a zero, and the title still says the system produced side effects it should not have, so the leading zero has to not read as a contradiction. Six of demo-populated's eight outcomes are this.` | `apps/web/src/sections/resilience.tsx:83-87` | demo-populated |
| Both counts above zero <br> *load bearing* | `duplicateSideEffects > 0 && prohibitedSideEffects > 0, reading '2 duplicate and 2 prohibited'. demo-populated's tool_timeout into issue_refund, which is the case the whole demonstration exists to show.` | `apps/web/src/sections/resilience.tsx:85` | demo-populated |
| 'N duplicate and 0 prohibited' <br> *ordinary* | `duplicateSideEffects > 0 && prohibitedSideEffects === 0. The mirror of the common case, with the zero at the end instead of the start.` | `apps/web/src/sections/resilience.tsx:85` | **nothing here.** Run chaos on apps/demo/scenarios/support-desk-duplicate.yaml, which declares no prohibitedEffects expectation and one tool_timeout that duplicates a refund. |
| A count of one in a sentence written for plurals <br> *ordinary* | `either count === 1. The sentence is '1 duplicate and 1 prohibited' followed by 'A duplicate is ... a prohibited one is ...', so the mixed number and singular has to hold.` | `apps/web/src/sections/resilience.tsx:85` | demo-populated |

## Fault outcome evaluator block

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| No evaluator ran for this outcome <br> *load bearing* | `outcome.evaluators.length === 0; a plain note replaces the whole block, with no eyebrow and no count` | `apps/web/src/ui/evaluators.tsx:31; apps/web/src/sections/resilience.tsx:89-92` | **nothing here.** Write a scenario with faults and an empty evaluators list, then run chaos on it. |
| An Evaluators heading with its count and one row per result <br> *load bearing* | `outcome.evaluators.length > 0. Three per outcome in demo-populated. The h4 is a sibling of the outcome's own h4, so the heading outline alternates fault, Evaluators, fault, Evaluators with no nesting.` | `apps/web/src/ui/evaluators.tsx:34-44` | demo-populated |
| A long evaluator list under every outcome <br> *edge* | `outcome.evaluators.length is large, with no ceiling. Multiplied by the outcome count: 40 faults and 10 evaluators is 400 rows on one screen.` | `apps/web/src/ui/evaluators.tsx:40` | **nothing here.** Declare ten evaluators in support-desk-faults.yaml and rerun chaos. |

## Evaluator row

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| verdict reads 'passed', with the detail beside it <br> *load bearing* | `result.skipped !== true && result.passed === true` | `apps/web/src/ui/evaluators.tsx:17` | demo-populated |
| verdict reads 'failed', with the detail beside it <br> *load bearing* | `result.skipped !== true && result.passed === false` | `apps/web/src/ui/evaluators.tsx:17` | demo-populated |
| verdict reads 'skipped', with the skip reason in place of the detail <br> *load bearing* | `result.skipped === true && result.skipReason !== undefined. The detail is dropped entirely and never shown.` | `apps/web/src/ui/evaluators.tsx:16,22` | **nothing here.** Add a model_judge evaluator to support-desk-faults.yaml; it carries requiresModelAccess: true and is skipped without a credential. |
| verdict reads 'skipped' with the words 'no reason recorded' <br> *edge* | `result.skipped === true && result.skipReason === undefined; skipReason is optional in the schema so this is legal` | `apps/web/src/ui/evaluators.tsx:12,22` | **nothing here.** Hand edit an evaluator result in an embedded bundle to {skipped: true} with no skipReason. |
| skipped true with passed true, and skipped wins <br> *edge* | `result.skipped === true && result.passed === true. The comment on the file is explicit that an evaluator that did not run has not agreed with anything, so the row must never read 'passed' here.` | `apps/web/src/ui/evaluators.tsx:17` | **nothing here.** Hand edit an evaluator result to carry both flags. |
| A kind that is not one of the nine declared evaluators <br> *load bearing* | `EvaluatorResult.kind is NonEmptyString, not the Evaluator union, so synthesised kinds reach the page. demo-populated carries expect_prohibited_effect on every outcome, which no scenario declares.` | `packages/schema/src/evaluator.ts:97; apps/web/src/ui/evaluators.tsx:21` | demo-populated |
| An evaluator row with a blank third column <br> *edge* | `result.detail === '' and not skipped. detail is Type.String with a maxLength and no minLength, so the row renders a verdict, a kind and a single space.` | `packages/schema/src/evaluator.ts:99; apps/web/src/ui/evaluators.tsx:22` | **nothing here.** Hand edit detail to an empty string in an embedded bundle. |
| A two thousand character detail wrapping in a flex row <br> *ordinary* | `result.detail.length approaches 2000. The row is a flex line with wrap, so a long detail reflows under the verdict and the mono kind.` | `packages/schema/src/evaluator.ts:99; apps/web/src/styles.css:1519` | **nothing here.** An output_contains_all evaluator over many long values produces a long detail naturally. |

## Faults requested and not applied

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Every requested fault was applied <br> *load bearing* | `report.notApplied.length === 0. The eyebrow still carries a count chip reading 0, because count is passed unconditionally and Eyebrow only omits it when it is undefined. The chrome's own rule, stated in shell.tsx, is that a zero count is omitted.` | `apps/web/src/sections/resilience.tsx:101,105-106; apps/web/src/ui/primitives.tsx:38; apps/web/src/ui/shell.tsx:113-118` | demo-populated |
| A three column table with exactly one row <br> *load bearing* | `report.notApplied.length === 1` | `apps/web/src/sections/resilience.tsx:108-125` | **nothing here.** Add one fault of a kind the demo target does not implement, for example kind: context_corruption, to support-desk-faults.yaml and rerun chaos. |
| A table with many rows and no ceiling <br> *load bearing* | `report.notApplied.length > 1` | `apps/web/src/sections/resilience.tsx:117` | **nothing here.** Add the seven schema fault kinds the demonstration target does not implement (model_stream_interrupted, tool_stale_result, retrieval_slow, auth_expired, side_effect_partial_success, duplicate_response, context_corruption) and rerun chaos. |
| Two rows with the same fault kind and target <br> *edge* | `two entries of report.notApplied share faultKind and target, which the row key `${faultKind}:${target}` cannot distinguish. Legal, since a scenario may declare the same kind on the same target twice with different attempts, probability or delayMs.` | `apps/web/src/sections/resilience.tsx:118; packages/chaos/src/plan.ts:58` | **nothing here.** Declare tool_timeout on issue_refund twice, with attempts [1] and attempts [2], both of a kind or target that will not apply. |
| An unbounded target or reason widening the table <br> *edge* | `entry.target or entry.reason is long. Both are NonEmptyString with no maxLength, and the table has no truncation. The workspace holds that no section scrolls sideways at 390px.` | `apps/web/src/sections/resilience.tsx:120-121; packages/schema/src/chaos.ts:125` | **nothing here.** Hand edit a reason to a long paragraph in an embedded bundle. |

## Faults requested and not applied, Reason column

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Every reason is the same sentence <br> *load bearing* | `always, from the CLI. runChaosSuite writes the single constant NOT_APPLIED_REASON, 'the target reported no application of this fault', for every entry, so the column is a repeated string that carries no information per row.` | `packages/chaos/src/outcome.ts:23; packages/chaos/src/run.ts:66-70` | **nothing here.** Reached by any run with a not applied fault. The column varies only in a hand written or third party bundle, where reason is an unbounded NonEmptyString. |

## Fault outcome, whole block

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The fault's delivery, probability, attempts, delay, payload and application cap are never rendered <br> *load bearing* | `always. ChaosOutcome carries only faultKind and target, and the screen never joins back to bundle.scenarios[].faults, which does hold every one of those fields. Nothing on the page distinguishes a cooperative fault from a proxy one.` | `apps/web/src/sections/resilience.tsx:27-63; packages/schema/src/chaos.ts:54-70` | demo-populated |

## What a designer needs to know beyond the list

FAULT KINDS. The schema declares 18 (packages/schema/src/chaos.ts:26): model_timeout, model_rate_limited, model_server_error, model_malformed_structured_output, model_stream_interrupted, tool_timeout, tool_exception, tool_malformed_result, tool_stale_result, retrieval_empty, retrieval_slow, worker_unavailable, queue_delay, auth_expired, side_effect_partial_success, duplicate_response, context_corruption, prompt_injection_in_content. The demonstration target implements 11 of them (SUPPORTED_KINDS, apps/demo/src/faults.ts:30): the four model_* except model_stream_interrupted, the three tool_* except tool_stale_result, retrieval_empty, worker_unavailable, queue_delay, prompt_injection_in_content. The demonstration's chaos scenario declares only 7 distinct kinds in 8 specs (support-desk-faults.yaml): tool_exception, tool_timeout twice on different targets, model_rate_limited, model_malformed_structured_output, retrieval_empty, worker_unavailable, prompt_injection_in_content. So 7 of 18 kinds ever reach the page as an outcome eyebrow, and the four longest headings in the set (side_effect_partial_success, model_malformed_structured_output, prompt_injection_in_content, model_stream_interrupted) include two that have never been seen. Declaring any of the other 11 kinds is also the cheapest way to reach every notApplied state, because the target silently ignores a kind it does not implement and the suite records it as not applied.

VERIFIED AGAINST REAL DATA. I ran orchescope chaos --scenario support-desk-faults against apps/demo and read corpus/.cache/bundles/demo-populated.json (both paths are gitignored; no tracked file was changed). demo-populated's single report holds 8 outcomes, 0 notApplied, environment local_deterministic, seed 7, 2 repetitions per fault. Of the three boolean words: 5 outcomes are completed/recovered/degraded, 2 are completed/recovered/not degraded, 1 is none of the three. My own run at 1 repetition produced degradedGracefully false on all 8, which means the demonstration's own headline resilience state flips with a flag the page never shows.

WHAT THE FIXTURES CANNOT REACH. Only demo-populated carries a chaos run at all, so every state below the run header exists in exactly one bundle. Nothing anywhere reaches: a not applied table of any size, a run with zero outcomes, a skipped evaluator, an outcome with no evaluators, an absent cost or retry amplification, a non local_deterministic environment, more than one chaos report, or a recovery time above a second. The absent retry amplification is the one that matters most, because it fires whenever the baseline run retried nothing, which is the normal case for a healthy system, and it has never been looked at.

NO CONTROLS. The Resilience screen has no button, no filter, no select and no capability gated action anywhere. It is the only screen in the workspace with no interactive element in its populated state; the only affordance is the copyable command in the empty state. There is nothing to disable with a reason and nothing to hide, so the present/disabled/absent axis does not apply here.

NO WITHHOLDING. Absence on this screen is always the word 'not measured' from OptionalNumber, never the word 'withheld'. Withholding is a Performance concept, tied to a sample size threshold on a quantile. The three optional fields here (recoveryTimeMs, costAmplification, retryAmplification) are absent because the arithmetic had no denominator, not because a value was suppressed.

IDENTIFIERS THAT GO NOWHERE. The chaos report id, the baseline run id and each outcome's run id are printed as plain identifiers and none of them resolves. I checked demo-populated: bundle.runs contains neither the baseline run id nor any of the eight outcome run ids. Nine mono hashes on the screen, none of which can be looked up anywhere else in the document.

HEADING OUTLINE. Populated, the outline is h2 Resilience (visually hidden, from app.tsx) then per report h3 chaos_<hash>, then alternating h4 '<kind> into <target>' and h4 Evaluators, then h4 'Faults requested and not applied'. The Evaluators heading is a sibling of the outcome heading rather than nested under it, so a screen reader walking headings gets fault, Evaluators, fault, Evaluators with no indication of which evaluators belong to which fault. Empty, the outline is h2 Resilience then h3 Resilience, the same word twice.

TWO GRAMMAR DEFECTS AND ONE STYLE VIOLATION, all data driven. 'Applied 1 times in run X' at appliedCount 1 (format.ts exports a pluralise helper that this line does not use). '1 times the baseline retries' at retryAmplification 1. And the outcome eyebrow sets a name that came out of the analysed repository in the only all caps type in the system, which docs/design/report-system.md explicitly forbids: ISSUE_REFUND, DEMO-SMALL, POLICY-STORE, INVENTORY-WORKER all reach the page that way today.

TEST COVERAGE. There is no unit test over resilience.tsx or evaluators.tsx anywhere in apps/web/test. tests/ui/workspace.spec.ts only asserts the section is reachable by name. tests/e2e/report-commands.test.ts checks that chaosCommand('support-desk') starts with the binary name and names a real verb, which is why the refusal panel printing a command the CLI rejects is not caught.

