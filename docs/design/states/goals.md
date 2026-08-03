# Goals: every state

146 states across 24 blocks. 79 of them are reached by no report in `corpus/.cache/bundles`, so `pnpm states` will not show them to you and the fourth column says what would.

Source: `The Goals screen (apps/web/src/sections/goals.tsx, plus goal-finding.ts, prompt.ts, ui/evidence-list.tsx, ui/actions.tsx and the judgement produced upstream by packages/goals/src/validate-plan.ts)`.

## Thresholds

| Constant | Value | Where | What it switches | Why that number |
| --- | --- | --- | --- | --- |
| `No ceiling anywhere on the Goals screen` | none | `apps/web/src/sections/goals.tsx (whole file)` | Nothing. Every list on this screen renders in full: goals, criteria, commands, write paths, components, source locations, evidence records. It is the only major screen with no cell limit, no naming ceiling and no virtualisation, so it never has to say which reading it is giving. | Absent by omission. Compare delta-bar.ts CELL_LIMIT = 120, graph-canvas.tsx NAMEABLE_CEILING = 120 and window.ts virtualisation, all of which switch representation and say so. |
| `Evidence summary metric lines` | 8 | `packages/goals/src/create.ts:211 (finding.metrics.slice(0, 8))` | Below or at eight, every metric on the originating finding becomes a line in the evidence summary. Above it the ninth and later are dropped, and neither the goal document nor the screen says any were dropped. | Taste, undocumented. The corpus maximum is 3 metrics on an eligible finding, so it has never bound. |
| `MAX_SOURCE_LOCATIONS` | 10 | `packages/findings/src/engine.ts:57, applied at :141` | A goal's Source locations list can never exceed ten entries, because it copies the finding's, which is already capped. Each contributing component adds at most two (engine.ts:140). | Undocumented constant in the findings engine. Nine of the 34 eligible findings in the corpus sit exactly at it, so a reader is often looking at a truncated list with no statement that it is truncated. |
| `Validation scenario count` | 3 | `packages/usecases/src/goal.ts:37 (chosen.slice(0, 3))` | Sets the number of scenario_passes criteria, the number of scenario rerun commands, whether requiresExecution is yes or no, and whether live_execution appears in the approvals. At zero the goal is analysis only; at three it is the largest validation plan the tool produces. | Taste, undocumented. Scenarios are chosen by tag overlap and fall back to all scenarios when nothing matches (goal.ts:36), so the three may be unrelated to the finding. |
| `Baseline run count` | 3 | `packages/usecases/src/goal.ts:71 (runIds.slice(0, 3))` | How many opaque run identifiers appear in the Baseline runs row. Only the first is ever used, in the compare command (packages/goals/src/create.ts:157), so the other two are shown and never acted on. | Taste, undocumented. |
| `Default repetitions` | 3 | `packages/usecases/src/goal.ts:72` | The Repetitions row and the --repetitions argument inside every scenario rerun command. | Taste, undocumented. Overridable with orchescope goal create --repetitions. |
| `RELATIVE_IMPROVEMENT_BY_RULE thresholds` | 0.15 durationMs.p95, 0.20 inputTokens, 0.10 durationMs.p50 | `packages/goals/src/create.ts:39-45` | Whether the card carries an 'Expected improvement' paragraph at all, and whether a metric_improvement criterion exists. Only three of the repository's rules are in the table; every other rule produces a goal with no numeric target. | Taste, undocumented. The percentage is rendered twice from the same number, once as 'at least 15 percent' in the statement and once as '15.0% relative' in the check description. |
| `metric_not_worse tolerance` | 0 | `packages/goals/src/create.ts:101 and :106` | With tolerance zero, any candidate above the baseline is 'worse'. The satisfied expression at packages/goals/src/validate-plan.ts:102 is !(worse && better), which no tolerance can make false, so satisfaction is decided entirely by direction !== 'regressed' and an indeterminate direction yields satisfied true with decided false. | Stated intent is that success must not decline at all. The interaction with 'indeterminate' is not derived from anything and produces the contradiction in state criterion-undecided-yet-counted-satisfied. |
| `Goal identifier width` | 4 digits | `packages/schema/src/goal.ts:124 (^OSC-GOAL-\d{4}$)` | Caps a project at 9999 goals and fixes the width of the eyebrow at the top of every card. | Readable sequential identifier, per packages/persistence/src/repositories/goals.ts:8-10. |
| `Integer grouping` | 1000 | `apps/web/src/format.ts:GROUP_SIZE = 3, used at goals.tsx:166` | Repetitions of 999 render as '999'; 1000 renders as '1 000' with a space, not a comma. | Locale independence, so the same bundle reads the same on every machine. |

## Goals, whole screen

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Refusal panel that names the first eligible finding <br> *load bearing* | `bundle.goals.length === 0 && bundle.findings.some(f => f.goalReadiness.eligible)` | `apps/web/src/sections/goals.tsx:332-348` | anthropic-quickstarts, crewai, demonstration-system, langgraph, openai-agents-js, openai-agents-python, pydantic-ai, pydantic-ai-exercised, vercel-ai-chatbot, vercel-ai-chatbot-exercised |
| Refusal panel saying no finding is marked eligible yet <br> *load bearing* | `bundle.goals.length === 0 && bundle.findings.every(f => !f.goalReadiness.eligible)` | `apps/web/src/sections/goals.tsx:343-346` | axios, express, flask, langgraphjs, orchescope-discovery |
| Same 'none eligible' sentence when the report has no findings at all <br> *edge* | `bundle.goals.length === 0 && bundle.findings.length === 0` | `apps/web/src/sections/goals.tsx:333,344-345` | orchescope-discovery |
| Command block reads 'orchescope goal create <finding id>' rather than a real identifier <br> *ordinary* | `eligible === null, so goalCommand(null) substitutes the placeholder` | `apps/web/src/sections/goals.tsx:338 via apps/web/src/commands.ts:45-47` | axios, express, flask, langgraphjs, orchescope-discovery |
| Command block carries the real finding identifier <br> *ordinary* | `eligible !== null` | `apps/web/src/sections/goals.tsx:338` | anthropic-quickstarts, crewai, demonstration-system, langgraph, openai-agents-js, openai-agents-python, pydantic-ai, pydantic-ai-exercised, vercel-ai-chatbot, vercel-ai-chatbot-exercised |
| The empty screen carries a visible GOALS eyebrow; the populated screen carries none <br> *load bearing* | `bundle.goals.length === 0 renders Eyebrow level=3; the populated branch renders no screen level label at all` | `apps/web/src/sections/goals.tsx:336 versus 356-366` | flask (empty), demo-populated (populated) |
| A single goal card, no list affordance and no count anywhere on the screen <br> *ordinary* | `bundle.goals.length === 1` | `apps/web/src/sections/goals.tsx:358-365` | **nothing here.** Delete OSC-GOAL-0002 from demo-populated.goals and its entry from goalValidations. |
| Every goal rendered in full, stacked, ordered by identifier ascending, with no index, filter or sort <br> *load bearing* | `bundle.goals.length > 1` | `apps/web/src/sections/goals.tsx:358-365; order fixed by packages/persistence/src/repositories/goals.ts:53 'ORDER BY id'` | demo-populated |
| A long backlog of goals: no ceiling, no virtualisation, no summary of statuses <br> *edge* | `bundle.goals.length is large (say 40)` | `apps/web/src/sections/goals.tsx:358-365` | **nothing here.** Duplicate demo-populated's OSC-GOAL-0001 forty times with fresh OSC-GOAL-NNNN identifiers. |
| One card's scope disclosure is open because the route names that goal <br> *load bearing* | `route.params['goal'] === goal.id` | `apps/web/src/sections/goals.tsx:330,361,232` | demo-populated |
| Route names a goal the bundle does not carry: nothing is highlighted and nothing says why <br> *edge* | `route.params['goal'] is set and no goal has that id` | `apps/web/src/sections/goals.tsx:330,361` | **nothing here.** Open demo-populated at the hash for goals with goal=OSC-GOAL-0099. |
| Refusal insists no goal has been created, immediately after the reader created one from a finding <br> *edge* | `bundle.goals.length === 0 and the reader followed the 'Open OSC-GOAL-NNNN in the goals section' link produced by the create_goal action` | `apps/web/src/sections/goals.tsx:337 versus apps/web/src/ui/finding-card.tsx:201` | **nothing here.** Serve any corpus bundle with create_goal available, press Create goal on an eligible finding, then follow its link. |

## Chrome

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Goals carries a count beside its name <br> *ordinary* | `bundle.goals.length > 0` | `apps/web/src/ui/shell.tsx:130,144` | demo-populated |
| Goals carries no count, because zero is omitted <br> *ordinary* | `bundle.goals.length === 0` | `apps/web/src/ui/shell.tsx:130,133` | every fixture except demo-populated |

## Goal card, meta line

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Status word 'Ready' <br> *load bearing* | `goal.status === 'ready' (what createGoal writes)` | `apps/web/src/sections/goals.tsx:83 via packages/goals/src/create.ts:277` | demo-populated (OSC-GOAL-0002) |
| Status word 'In progress' <br> *load bearing* | `goal.status === 'in_progress', written when goal validate ran and not every criterion was satisfied` | `apps/web/src/sections/goals.tsx:83 via packages/usecases/src/goal.ts:180` | demo-populated (OSC-GOAL-0001) |
| Status word 'Validated', the only status that asserts the change worked <br> *load bearing* | `goal.status === 'validated', written when validation.validated is true` | `apps/web/src/sections/goals.tsx:83 via packages/usecases/src/goal.ts:180` | **nothing here.** Set demo-populated's OSC-GOAL-0001.status to 'validated' and set every outcome in its goalValidations entry to satisfied:true, validated:true. |
| Status word 'Draft', which validation deliberately preserves <br> *edge* | `goal.status === 'draft'` | `apps/web/src/sections/goals.tsx:83; preserved at packages/usecases/src/goal.ts:180` | **nothing here.** Set demo-populated's OSC-GOAL-0002.status to 'draft'. No code path in the repository writes it. |
| Status word 'Rejected' <br> *edge* | `goal.status === 'rejected'` | `apps/web/src/sections/goals.tsx:83; value from packages/schema/src/goal.ts:26` | **nothing here.** Set demo-populated's OSC-GOAL-0002.status to 'rejected'. Nothing in the repository ever writes this value, so the card gives no reason and offers no way to reopen it. |
| Status word 'Abandoned' <br> *edge* | `goal.status === 'abandoned'` | `apps/web/src/sections/goals.tsx:83; value from packages/schema/src/goal.ts:27` | **nothing here.** Set demo-populated's OSC-GOAL-0002.status to 'abandoned'. Nothing in the repository ever writes this value. |
| Risk reads 'risk low', 'risk medium' or 'risk high', lowercase and unhumanised beside the capitalised status <br> *ordinary* | `goal.risk in {low, medium, high}; createGoal maps a recommendation risk of 'unknown' to 'medium'` | `apps/web/src/sections/goals.tsx:84; packages/goals/src/create.ts:286-289` | demo-populated (medium on both goals) |
| created and updated render as 'YYYY-MM-DD HH:MM:SS UTC' <br> *ordinary* | `the timestamp matches the exact millisecond ISO pattern` | `apps/web/src/sections/goals.tsx:85-86 via apps/web/src/format.ts:formatTimestamp` | demo-populated |
| created and updated render as the raw ISO string when it does not match the expected pattern <br> *edge* | `!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(goal.createdAt)` | `apps/web/src/format.ts:formatTimestamp fallback, used at goals.tsx:85-86` | **nothing here.** Set demo-populated's OSC-GOAL-0001.createdAt to '2026-07-27T18:51:57Z' (no milliseconds). |
| created and updated are identical, so the meta line repeats the same timestamp twice <br> *ordinary* | `goal.createdAt === goal.updatedAt, true for every goal until goal validate runs` | `apps/web/src/sections/goals.tsx:85-86` | demo-populated (OSC-GOAL-0002) |

## Goal card, under the problem statement

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A link button reading 'From finding OSC-XXX-NNNN' <br> *load bearing* | `findingForGoal(goal, bundle.findings) !== null` | `apps/web/src/sections/goals.tsx:94-106` | demo-populated |
| The linked identifier differs from the one the goal stores, and from the one every export prints <br> *load bearing* | `goal.metadata.ruleId resolves to a finding whose id !== goal.findingId` | `apps/web/src/goal-finding.ts:31-37; the export prints goal.findingId at apps/web/src/prompt.ts:104` | demo-populated (goal stores OSC-REL-0003, the link reads OSC-REL-0005, the copied prompt says 'Derived from finding OSC-REL-0003') |
| Link resolved by the stored finding identifier because the goal carries no rule identifier <br> *edge* | `typeof goal.metadata['ruleId'] !== 'string' \|\| it is empty` | `apps/web/src/goal-finding.ts:27-30` | **nothing here.** Delete metadata.ruleId from demo-populated's OSC-GOAL-0002. The stored id OSC-REL-0003 then resolves to the model timeout finding, which is a different problem entirely. |
| Link points at the first finding of the rule when no group of components matches, so it may name a different firing of the same rule <br> *edge* | `byRule.length > 0 && no finding has the same component set as goal.affectedComponents` | `apps/web/src/goal-finding.ts:34-36` | **nothing here.** Add a component id to demo-populated's OSC-GOAL-0001.affectedComponents. |
| Note replacing the link: the finding is not in this report, which is what a resolved finding looks like <br> *load bearing* | `findingForGoal(...) === null, i.e. no finding in the bundle carries goal.metadata.ruleId` | `apps/web/src/sections/goals.tsx:89-93` | **nothing here.** Delete OSC-REL-0005 from demo-populated.findings. This is the state the whole loop exists to produce and no fixture shows it. |

## Goal card, after the finding link

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A note reading 'Expected improvement: <metric> improves by at least N percent with task success unchanged' <br> *load bearing* | `goal.expectedImprovement !== undefined, set only for the three rules in RELATIVE_IMPROVEMENT_BY_RULE` | `apps/web/src/sections/goals.tsx:108-110; packages/goals/src/create.ts:292-296` | **nothing here.** Create a goal from demo-populated's OSC-PERF-0001 (independent-calls-run-sequentially), which is one of the three rules that carry a relative threshold. |
| No expected improvement paragraph at all, for every goal cut from any other rule <br> *load bearing* | `goal.expectedImprovement === undefined` | `apps/web/src/sections/goals.tsx:108` | demo-populated (both goals) |

## Goal card, Evidence summary

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| 'No evidence summary was recorded.' <br> *edge* | `goal.evidenceSummary.length === 0` | `apps/web/src/sections/goals.tsx:116-117` | **nothing here.** Empty demo-populated's OSC-GOAL-0002.evidenceSummary. createGoal always writes at least a fallback line, so only a hand written or imported goal reaches it. |
| Lines copied from the finding's metrics: 'name <value> <unit> over N samples' <br> *load bearing* | `the originating finding carried metrics; up to eight are copied` | `packages/goals/src/create.ts:211-217, rendered at goals.tsx:120-126` | **nothing here.** Create a goal from pydantic-ai's OSC-REL-0001, which carries two metrics. demo-populated's goals were cut from a finding with none. |
| 'over 1 sample' rather than 'samples' <br> *edge* | `metric.sampleSize === 1` | `packages/goals/src/create.ts:214` | **nothing here.** Set a metric's sampleSize to 1 on the finding before creating the goal. |
| One line per evidence kind and class: '<kind> evidence N records' <br> *load bearing* | `the goal's evidence records resolved when the goal was created; grouped by kind AND class` | `packages/goals/src/create.ts:218-235, rendered at goals.tsx:120-126` | demo-populated (config_entry evidence, derived evidence) |
| '1 record' rather than '1 records' <br> *ordinary* | `group.count === 1` | `packages/goals/src/create.ts:191` | demo-populated (OSC-GOAL-0002) |
| '1 record(s)' from a goal written by an earlier build, sitting beside a goal that says '1 record' <br> *ordinary* | `the stored goal document predates the current plural helper; the value string is frozen at creation and never recomputed` | `apps/web/src/sections/goals.tsx:123 (the value is rendered verbatim)` | demo-populated (OSC-GOAL-0001 reads '1 record(s)', OSC-GOAL-0002 reads '1 record') |
| A single line 'evidence N records referenced by the finding' when nothing else could be summarised <br> *edge* | `the finding had no metrics and none of its evidence records resolved at creation time` | `packages/goals/src/create.ts:236-242` | **nothing here.** Create a goal from a finding whose evidence identifiers are not in the store, for example by clearing the evidence table before goal create. |
| Basis chip reads 'Observed' <br> *load bearing* | `entry.basis === 'observed'` | `apps/web/src/sections/goals.tsx:124 via apps/web/src/basis.ts DESCRIPTORS` | demo-populated (OSC-GOAL-0001, on a config_entry line, which is the misreport packages/goals/src/create.ts:193-205 exists to prevent) |
| Basis chip reads 'Discovered' <br> *load bearing* | `entry.basis === 'discovered'` | `apps/web/src/basis.ts DESCRIPTORS, used at goals.tsx:124` | demo-populated (OSC-GOAL-0002) |
| Basis chip reads 'Inferred' <br> *load bearing* | `entry.basis === 'inferred'` | `apps/web/src/basis.ts DESCRIPTORS, used at goals.tsx:124` | demo-populated (OSC-GOAL-0002) |
| Basis chip reads 'Estimated' <br> *edge* | `entry.basis === 'estimated'` | `apps/web/src/basis.ts DESCRIPTORS, used at goals.tsx:124` | **nothing here.** Set a basis on an evidenceSummary entry of demo-populated's OSC-GOAL-0002 to 'estimated'. |
| Basis chip reads 'Simulated', meaning the number came from a run with faults injected <br> *ordinary* | `entry.basis === 'simulated'` | `apps/web/src/basis.ts DESCRIPTORS, used at goals.tsx:124` | **nothing here.** Create a goal from demo-populated's OSC-RES-0003 (resilience-under-injected-fault), whose evidence is fault_injection. |
| Basis chip reads 'Model interpreted', the longest of the six labels <br> *edge* | `entry.basis === 'model_interpreted'` | `apps/web/src/basis.ts DESCRIPTORS, used at goals.tsx:124` | **nothing here.** Set a basis on an evidenceSummary entry to 'model_interpreted'. No corpus bundle carries this class anywhere. |
| Basis chip reads 'Unknown basis' for a class this build does not recognise <br> *edge* | `describeBasis(entry.basis) falls through to UNKNOWN_BASIS` | `apps/web/src/basis.ts describeBasis, used at goals.tsx:124` | **nothing here.** Set an evidenceSummary entry's basis to 'measured'. |

## Goal card, Acceptance criteria

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| No summary sentence above the criteria, because this report judged nothing <br> *load bearing* | `judgement === null` | `apps/web/src/sections/goals.tsx:135` | **nothing here.** Delete the goalValidations array from demo-populated. Every corpus bundle without goals already lacks the field. |
| 'all N acceptance criteria are satisfied.' <br> *load bearing* | `judgement.validated === true` | `apps/web/src/sections/goals.tsx:135; wording at packages/goals/src/validate-plan.ts:213` | **nothing here.** Set every outcome in demo-populated's OSC-GOAL-0001 entry to satisfied:true and validated:true. |
| 'X of N criteria satisfied, Y undecided.' <br> *load bearing* | `judgement.validated === false` | `apps/web/src/sections/goals.tsx:135; wording at packages/goals/src/validate-plan.ts:214` | demo-populated ('3 of 5 criteria satisfied, 0 undecided' and '0 of 5 criteria satisfied, 4 undecided') |
| '0 of N criteria satisfied, 0 undecided.' - everything was decided and everything failed <br> *edge* | `judgement.satisfiedCount === 0 && judgement.undecidedCount === 0` | `apps/web/src/sections/goals.tsx:135` | **nothing here.** Set every outcome in demo-populated's OSC-GOAL-0001 entry to decided:true, satisfied:false and rewrite summary and counts to match. |
| 'all 1 acceptance criteria are satisfied.' - the summary has no singular form <br> *edge* | `judgement.validated && goal.acceptanceCriteria.length === 1` | `packages/goals/src/validate-plan.ts:212-214` | **nothing here.** Reduce demo-populated's OSC-GOAL-0001 to a single satisfied criterion. createGoal never produces fewer than three, so this needs a hand written goal. |
| A criterion row with no outcome: identifier, statement, and a muted 'Checked by: <check>' <br> *load bearing* | `outcomes.get(criterion.id) === null, which is every row when judgement is null` | `apps/web/src/sections/goals.tsx:143-144` | **nothing here.** Delete goalValidations from demo-populated. |
| A criterion row with a meta line (outcome word, then the check) and a muted detail sentence below <br> *load bearing* | `an outcome exists for this criterion id` | `apps/web/src/sections/goals.tsx:145-153` | demo-populated (all ten rows) |
| A judged goal where one criterion silently falls back to the unjudged row, indistinguishable from an unjudged report <br> *edge* | `judgement !== null && no outcome carries this criterion.id` | `apps/web/src/sections/goals.tsx:138,143` | **nothing here.** Remove the AC-03 outcome from demo-populated's OSC-GOAL-0001 entry, leaving the criterion in the goal. |
| Outcome word 'satisfied' <br> *load bearing* | `outcome.decided && outcome.satisfied` | `apps/web/src/sections/goals.tsx:64-65,148` | demo-populated (OSC-GOAL-0001 AC-01, AC-02, AC-03) |
| Outcome word 'not satisfied' <br> *load bearing* | `outcome.decided && !outcome.satisfied` | `apps/web/src/sections/goals.tsx:64-65,148` | demo-populated (OSC-GOAL-0001 AC-04, AC-05) |
| Outcome word 'undecided', which is not a failure <br> *load bearing* | `!outcome.decided` | `apps/web/src/sections/goals.tsx:64-65,148` | demo-populated (OSC-GOAL-0002 AC-01 to AC-04) |
| Every row reads 'undecided' while the sentence above says all criteria are satisfied and the status word says Validated <br> *load bearing* | `a metric_not_worse check whose comparison delta direction is 'indeterminate': decided is false but satisfied is true, so satisfiedCount and validated both count it` | `packages/goals/src/validate-plan.ts:100-105,204-215; rendered at goals.tsx:135,148` | **nothing here.** In demo-populated, set the successRate and duplicateSideEffects deltas of cmp_ddec21a255ade380 to direction 'indeterminate' and re-run the audit, or hand edit the OSC-GOAL-0001 entry to decided:false, satisfied:true with validated:true. Verified by running validateGoal directly. |
| Check reads 'metric durationMs.p95 lt 15.0% relative' <br> *load bearing* | `check.kind === 'metric_improvement' && relativeThreshold !== undefined && absoluteThreshold === undefined` | `apps/web/src/prompt.ts:17-25` | **nothing here.** Create a goal from demo-populated's OSC-PERF-0001. This is the only metric_improvement form createGoal can produce. |
| Check reads 'metric X lt 250 absolute' <br> *edge* | `check.kind === 'metric_improvement' && absoluteThreshold !== undefined && relativeThreshold === undefined` | `apps/web/src/prompt.ts:22-25` | **nothing here.** Hand write a criterion with absoluteThreshold only. Nothing in the repository produces it. |
| Check reads 'metric X gte 20.0% relative or 100 absolute' <br> *edge* | `both thresholds are set` | `apps/web/src/prompt.ts:24-25` | **nothing here.** Hand write a criterion carrying both thresholds. |
| Check reads 'metric X lte' with no threshold at all, so the row states a comparator and nothing to compare against <br> *edge* | `neither threshold is set; bound is the empty string` | `apps/web/src/prompt.ts:25` | **nothing here.** Delete relativeThreshold from a metric_improvement criterion. |
| The comparator prints as the raw token lt, lte, gt or gte inside an otherwise plain English line <br> *ordinary* | `check.kind === 'metric_improvement'` | `apps/web/src/prompt.ts:25` | **nothing here.** Same as check-metric-improvement-relative. |
| Check reads 'metric successRate no worse than baseline within 0' <br> *load bearing* | `check.kind === 'metric_not_worse'` | `apps/web/src/prompt.ts:27-28` | demo-populated (AC-01 and AC-02 on both goals) |
| Check reads 'scenario support-desk passes' <br> *load bearing* | `check.kind === 'scenario_passes'` | `apps/web/src/prompt.ts:29-30` | demo-populated (AC-03 and AC-04 on both goals) |
| Check reads 'the finding this goal was created from is no longer reported', a full assertive sentence where the other kinds give a formula <br> *load bearing* | `check.kind === 'finding_resolved'` | `apps/web/src/prompt.ts:34-35` | demo-populated (AC-05 on both goals) |
| The meta line reads 'not satisfied' then 'the finding ... is no longer reported', and the detail directly under it says the finding still fires <br> *load bearing* | `check.kind === 'finding_resolved' && outcome.decided && !outcome.satisfied` | `apps/web/src/prompt.ts:34-35 beside packages/goals/src/validate-plan.ts:161-164, laid out at goals.tsx:146-152` | demo-populated (AC-05 on both goals) |
| Check reads 'command succeeds: <argv>' with shell quoting applied to any argument that needs it <br> *ordinary* | `check.kind === 'command_succeeds'` | `apps/web/src/prompt.ts:36-37` | **nothing here.** Hand write the criterion. createGoal never produces this kind, and it is always undecided when it exists. |
| Check reads 'manual review: <a full instruction sentence ending in a full stop>' inside a middle dot separated meta line <br> *load bearing* | `check.kind === 'manual_review', produced when the finding sets goalReadiness.requiresHumanReview` | `apps/web/src/prompt.ts:38-39; packages/goals/src/create.ts:120-130` | **nothing here.** Create a goal from pydantic-ai's OSC-SEC-0001 (prompt-injection-boundary), which requires human review. |
| Check reads 'unrecognised check' while the detail beside it reads 'unknown criterion kind': two different words for the same fact on one row <br> *edge* | `check.kind matches none of the six` | `apps/web/src/prompt.ts:40-41 beside packages/goals/src/validate-plan.ts:195-196` | **nothing here.** Set a criterion's check.kind to 'coverage_holds' in demo-populated. |
| Detail 'no comparison was recorded' <br> *load bearing* | `a metric check with comparison === undefined` | `packages/goals/src/validate-plan.ts:58,93` | demo-populated (OSC-GOAL-0002 AC-01, AC-02) |
| Detail 'the comparison carries no values for <metric>' or 'no relative change for <metric>' <br> *ordinary* | `a comparison exists but has no delta for that metric` | `packages/goals/src/validate-plan.ts:60-62,95-97` | **nothing here.** Remove the successRate delta from cmp_ddec21a255ade380 in demo-populated and re-judge. |
| Detail '<metric> moved from A to B and was judged <direction>', with an optional caveat in brackets <br> *load bearing* | `a decided metric_not_worse check; the bracketed clause appears only when delta.caveat is set` | `packages/goals/src/validate-plan.ts:104` | demo-populated (AC-01 and AC-02 on OSC-GOAL-0001, without a caveat) |
| Detail 'scenario <id> was not run' <br> *load bearing* | `no stored result for that scenario` | `packages/goals/src/validate-plan.ts:124-126` | **nothing here.** Create a goal in demonstration-system, which defines three scenarios and has never run one. |
| Detail 'scenario <id> has only been run before this goal was created, so its result describes the code the goal is about to change' - the longest sentence on the screen at roughly 130 characters <br> *load bearing* | `every stored result for the scenario has startedAt < goal.createdAt` | `packages/goals/src/validate-plan.ts:127-133` | demo-populated (OSC-GOAL-0002 AC-03, AC-04) |
| Detail 'scenario <id> passed over 5 repetition(s)' - the literal '(s)' is in the stored sentence <br> *load bearing* | `a scenario result newer than the goal exists` | `packages/goals/src/validate-plan.ts:138` | demo-populated (OSC-GOAL-0001 AC-03 passed, AC-04 failed) |
| Detail 'no rescan was performed' on the finding_resolved criterion <br> *edge* | `input.rescanned === false` | `packages/goals/src/validate-plan.ts:155` | **nothing here.** Not reachable through a report: packages/usecases/src/audit.ts:221 hardcodes rescanned true. Only orchescope goal validate on a workspace with no scan reaches it. |
| Detail 'running <argv> is the implementer's step and its result is not recorded here' <br> *ordinary* | `check.kind === 'command_succeeds'; always undecided` | `packages/goals/src/validate-plan.ts:188-192` | **nothing here.** Hand write a command_succeeds criterion into demo-populated's OSC-GOAL-0001 and add a matching undecided outcome. |
| Detail 'a human has to record this review'; there is no control anywhere on the screen that would record it <br> *load bearing* | `check.kind === 'manual_review'; always undecided` | `packages/goals/src/validate-plan.ts:193-194` | **nothing here.** Create a goal from pydantic-ai's OSC-SEC-0001. |

## Goal card, Validation plan

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Repetitions row carrying a mono integer <br> *ordinary* | `always present; goal.validation.repetitions, default 3` | `apps/web/src/sections/goals.tsx:164-167; default at packages/usecases/src/goal.ts:72` | demo-populated (3) |
| Repetitions reads 0 while Executes the system reads yes <br> *edge* | `goal.validation.repetitions === 0 (NonNegativeInt permits it) && requiresExecution` | `apps/web/src/sections/goals.tsx:166; schema packages/schema/src/goal.ts:98` | **nothing here.** Run orchescope goal create with --repetitions 0, or set the field to 0 in demo-populated. |
| A four figure repetition count renders with a space group, as '1 000' <br> *edge* | `repetitions > 999` | `apps/web/src/format.ts:formatInteger, used at goals.tsx:166` | **nothing here.** Set repetitions to 1000 in demo-populated. |
| Executes the system: 'yes' <br> *load bearing* | `goal.validation.requiresExecution === true, set when at least one validation scenario was chosen` | `apps/web/src/sections/goals.tsx:170; packages/goals/src/create.ts:168` | demo-populated |
| Executes the system: 'no, analysis only' <br> *load bearing* | `goal.validation.requiresExecution === false` | `apps/web/src/sections/goals.tsx:170` | **nothing here.** Create a goal in any corpus repository, all of which have zero scenarios (pydantic-ai, crewai, langgraph). |
| Scenarios to rerun: the word 'none', in prose rather than mono <br> *load bearing* | `goal.validation.scenarioIds.length === 0` | `apps/web/src/sections/goals.tsx:172-176` | **nothing here.** Create a goal in pydantic-ai (zero scenarios). |
| Scenarios to rerun: one to three identifiers joined by commas, in mono <br> *load bearing* | `goal.validation.scenarioIds.length > 0 (at most three)` | `apps/web/src/sections/goals.tsx:173-175; cap at packages/usecases/src/goal.ts:37` | demo-populated (two) |
| Baseline runs: 'none' <br> *load bearing* | `goal.validation.baselineRunIds.length === 0` | `apps/web/src/sections/goals.tsx:177-181` | **nothing here.** Create a goal in any corpus repository with no completed runs (pydantic-ai, crewai). Note createGoal refuses outright when the finding sets requiresRuntimeEvidence. |
| Baseline runs: one to three opaque run identifiers, comma joined, in mono, wrapping on a narrow column <br> *load bearing* | `goal.validation.baselineRunIds.length > 0 (at most three)` | `apps/web/src/sections/goals.tsx:178-180; cap at packages/usecases/src/goal.ts:71` | demo-populated (three per goal) |
| The definition list has four rows because no baseline benchmark was recorded <br> *load bearing* | `goal.validation.baselineBenchmarkId === undefined` | `apps/web/src/sections/goals.tsx:182-183` | demo-populated |
| A fifth row, 'Baseline benchmark', in mono <br> *edge* | `goal.validation.baselineBenchmarkId !== undefined` | `apps/web/src/sections/goals.tsx:184-190` | **nothing here.** Add baselineBenchmarkId to demo-populated's OSC-GOAL-0001.validation. No code path sets it: createGoalFromFinding never passes baselineBenchmarkId to createGoal, so this row is dead in every report the CLI writes. |
| One purpose sentence and one command block, with no eyebrow naming the list <br> *load bearing* | `goal.validation.commands.length === 1 (schema minItems 1)` | `apps/web/src/sections/goals.tsx:193-202` | **nothing here.** Create a goal in pydantic-ai: no scenarios and no runs leaves only the rescan command. |
| Two or three consecutive entries carrying the identical purpose sentence above different commands <br> *load bearing* | `two or more validation scenarios, each producing 'rerun the scenario that produced the evidence for <ruleId>'` | `packages/goals/src/create.ts:141-153; rendered at goals.tsx:194-201` | demo-populated (two identical purpose sentences) |
| Five command blocks: rescan, three scenario reruns, one compare <br> *ordinary* | `three validation scenarios and at least one baseline run` | `packages/goals/src/create.ts:135-159` | **nothing here.** Create a goal in demo-populated from a finding whose tags match all three scenarios. |
| A command line long enough to need horizontal handling inside pre.command <br> *ordinary* | `the argv, quoted, exceeds the column width` | `apps/web/src/sections/goals.tsx:199` | demo-populated ('orchescope test --scenario support-desk-duplicate --repetitions 3') |

## Goal card, after the validation plan

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Refusal panel 'This report did not judge this goal.' <br> *load bearing* | `judgement === null, i.e. bundle.goalValidations is absent or carries no entry for this goal` | `apps/web/src/sections/goals.tsx:205-212` | **nothing here.** Delete the goalValidations field from demo-populated. The field is optional in the schema and is not one of the arrays apps/web/src/bundle.ts repairs, so any bundle from a build that did not judge goals lands here; all fifteen corpus bundles already omit it. |

## Goal card, Comparisons that judged this goal

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The whole block is absent, with no sentence saying so <br> *load bearing* | `goal.validationResults.length === 0` | `apps/web/src/sections/goals.tsx:214` | demo-populated (OSC-GOAL-0002) |
| One row: mono comparison id, verdict word, muted timestamp <br> *load bearing* | `goal.validationResults.length === 1` | `apps/web/src/sections/goals.tsx:214-229` | demo-populated (OSC-GOAL-0001, verdict 'unchanged') |
| Several rows, newest last, one per distinct comparison the goal was validated against <br> *ordinary* | `goal.validationResults.length > 1` | `apps/web/src/sections/goals.tsx:219-227; append rule at packages/usecases/src/goal.ts:175-188` | **nothing here.** Append a second entry with a different comparisonId to demo-populated's OSC-GOAL-0001.validationResults. |
| Verdict reads 'insufficient_evidence' with the underscore intact, unlike the status word beside it which is humanised <br> *ordinary* | `comparison.verdict === 'insufficient_evidence' (one of improved, regressed, mixed, unchanged, insufficient_evidence)` | `apps/web/src/sections/goals.tsx:223; the value is not passed through humanise` | **nothing here.** Change the verdict on demo-populated's OSC-GOAL-0001.validationResults entry to 'insufficient_evidence'. |
| Criteria were decided by a comparison the block never names, because the block reads the goal document and the judgement's own comparisonId is never rendered <br> *load bearing* | `judgement.comparisonId !== undefined && goal.validationResults.length === 0` | `apps/web/src/sections/goals.tsx:214 (nothing reads judgement.comparisonId, which exists at packages/schema/src/report.ts:121)` | **nothing here.** Clear demo-populated's OSC-GOAL-0001.validationResults while leaving its goalValidations entry, which carries comparisonId cmp_ddec21a255ade380. Reached in practice by anyone who runs compare --goal and then audit without running goal validate. |

## Goal card, scope disclosure

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| One closed row reading 'Scope, evidence records and rollback' <br> *load bearing* | `props.highlighted === false` | `apps/web/src/sections/goals.tsx:232` | demo-populated |
| The row is open on load because the route names this goal <br> *load bearing* | `route.params['goal'] === goal.id` | `apps/web/src/sections/goals.tsx:232,330` | demo-populated |

## Scope, Allowed write paths

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A mono list of repository relative paths <br> *load bearing* | `goal.scope.allowedWritePaths.length > 0` | `apps/web/src/sections/goals.tsx:234-240,47` | demo-populated (three each) |
| 'No write path is allowed, which makes this goal unimplementable as written.' <br> *load bearing* | `goal.scope.allowedWritePaths.length === 0` | `apps/web/src/sections/goals.tsx:237` | **nothing here.** Create a goal from vercel-ai-chatbot-exercised's OSC-ARCH-0001 or OSC-ARCH-0002 (exercised-not-declared) or pydantic-ai-exercised's OSC-OBS-0001. All three are eligible, all three name a runtime only component with no source locations, so writePathsFor returns an empty set even though the schema declares minItems 1 and nothing validates the goal before it is saved. |
| A write scope of twenty or more files, which is a scope a reader cannot hold in their head <br> *ordinary* | `allowedWritePaths is large; the corpus maximum for an eligible finding is 22` | `packages/goals/src/create.ts:54-62` | **nothing here.** Create a goal from pydantic-ai's OSC-REL-0001, which names 25 components and yields 22 paths. |

## Scope, Prohibited changes

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The same four sentences on every goal this build creates <br> *load bearing* | `goal.scope.prohibitedChanges.length > 0` | `packages/goals/src/create.ts:47-52; rendered at goals.tsx:241-243` | demo-populated |
| 'No prohibition was recorded.' <br> *edge* | `goal.scope.prohibitedChanges.length === 0` | `apps/web/src/sections/goals.tsx:242` | **nothing here.** Empty the array on demo-populated's OSC-GOAL-0002. createGoal always writes four, so only an imported or hand written goal reaches it. |

## Scope, Invariants

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Two invariants, the default pair <br> *load bearing* | `the finding's category is neither performance nor cost` | `packages/goals/src/create.ts:173-179` | demo-populated |
| A third invariant about the answer staying correct <br> *ordinary* | `finding.category === 'performance' \|\| finding.category === 'cost'` | `packages/goals/src/create.ts:177-179` | **nothing here.** Create a goal from demo-populated's OSC-PERF-0001. |
| 'No invariant was recorded.' <br> *edge* | `goal.scope.invariants.length === 0` | `apps/web/src/sections/goals.tsx:248` | **nothing here.** Empty the array on demo-populated's OSC-GOAL-0002. |

## Scope, Approvals required

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| 'No approval is required before this change may be merged.' <br> *load bearing* | `goal.scope.requiredApprovals.length === 0` | `apps/web/src/sections/goals.tsx:252` | **nothing here.** Create a goal in pydantic-ai from OSC-REL-0001: no scenarios means no live_execution and no human review means no human_review. |
| One item, 'Live execution' <br> *load bearing* | `validationScenarioIds.length > 0 && !requiresHumanReview` | `packages/goals/src/create.ts:184-187; humanised at goals.tsx:251` | demo-populated (both goals) |
| One item, 'Human review' <br> *load bearing* | `finding.goalReadiness.requiresHumanReview && no validation scenarios` | `packages/goals/src/create.ts:185` | **nothing here.** Create a goal from pydantic-ai's OSC-SEC-0001 (prompt-injection-boundary, requiresHumanReview true, zero scenarios). |
| Two items, 'Human review' and 'Live execution', in that order <br> *ordinary* | `requiresHumanReview && validationScenarioIds.length > 0` | `packages/goals/src/create.ts:184-187` | **nothing here.** Create a goal from a demo-populated finding whose goalReadiness.requiresHumanReview is true; demo-populated has scenarios, so both apply. |
| 'Cost budget' as a required approval <br> *edge* | `goal.scope.requiredApprovals includes 'cost_budget'` | `packages/schema/src/goal.ts:112-114; humanised at goals.tsx:251` | **nothing here.** Add 'cost_budget' to demo-populated's OSC-GOAL-0002.scope.requiredApprovals. The schema allows it and createGoal never emits it. |

## Scope, Affected components

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| An inline list of buttons, each jumping to the map with that component selected <br> *load bearing* | `goal.affectedComponents.length > 0 (schema minItems 1)` | `apps/web/src/sections/goals.tsx:254-273` | demo-populated (two each) |
| A button labelled with the raw component identifier because the component is no longer in the graph, and pressing it selects nothing on the map <br> *load bearing* | `index.componentsById.has(componentId) === false` | `apps/web/src/graph-index.ts:277-282, used at goals.tsx:268` | **nothing here.** Rename tool:issue_refund in demo-populated's graph while leaving the goal untouched. This is the ordinary outcome of a goal outliving a refactor. |
| An eyebrow with the count 0 above an empty list, with no sentence: the only list in the goal card with no empty state <br> *edge* | `goal.affectedComponents.length === 0` | `apps/web/src/sections/goals.tsx:254-273 (compare apps/web/src/ui/finding-card.tsx:92, which returns null instead)` | **nothing here.** Empty the array on demo-populated's OSC-GOAL-0002. |
| Twenty five component buttons wrapping over several lines, with no ceiling and no statement of one <br> *ordinary* | `goal.affectedComponents.length is large; the corpus maximum for an eligible finding is 25` | `apps/web/src/sections/goals.tsx:258-272` | **nothing here.** Create a goal from pydantic-ai's OSC-REL-0001, which names 25 components. |

## Scope, Source locations

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A list of 'file:line' in mono, each with an open action beside it <br> *load bearing* | `goal.sourceLocations.length > 0 (at most ten)` | `apps/web/src/sections/goals.tsx:281-288` | demo-populated (two each) |
| 'No source location was recorded.' <br> *load bearing* | `goal.sourceLocations.length === 0` | `apps/web/src/sections/goals.tsx:278-279` | **nothing here.** Create a goal from vercel-ai-chatbot-exercised's OSC-ARCH-0001, a runtime only component with no source locations. It co-occurs with the empty write scope. |
| A span of lines renders as a single start line here, while the Markdown export of the same goal renders 'file:12-40' <br> *ordinary* | `location.endLine !== undefined && location.endLine !== location.startLine` | `apps/web/src/sections/goals.tsx:284 versus apps/web/src/prompt.ts:56-64` | **nothing here.** Add an endLine to a source location in demo-populated's OSC-GOAL-0001. |

## Scope, Evidence records

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| One block per record: a meta line (kind, basis chip, id, producer), a headline, a definition list of fields <br> *load bearing* | `goal.evidence.length > 0 and every id resolves` | `apps/web/src/ui/evidence-list.tsx:51-83,109-114` | demo-populated (a Derived record and a Config entry record on each goal) |
| Ten distinct record layouts: source span, config entry, dependency, span, metric, scenario outcome, fault injection, model interpretation, derived, absence <br> *load bearing* | `evidence.kind switches the headline and the field set` | `apps/web/src/evidence-text.ts:205-230` | demo-populated reaches derived and config_entry only |
| 'Unrecognised evidence kind' as the headline with no fields at all under it <br> *edge* | `evidence.kind matches none of the ten` | `apps/web/src/evidence-text.ts:228-229` | **nothing here.** Change an evidence record's kind in demo-populated. |
| A refusal panel counting the referenced records that are absent, above the list <br> *load bearing* | `some evidence id is not in index.evidenceById` | `apps/web/src/ui/evidence-list.tsx:102-108` | **nothing here.** Change one evidence id in demo-populated's OSC-GOAL-0001.evidence to ev_deadbeefdeadbeef. |
| '1 evidence records are referenced and absent from this bundle.' - no singular form <br> *edge* | `exactly one referenced record is missing` | `apps/web/src/ui/evidence-list.tsx:104` | **nothing here.** Break exactly one evidence id in demo-populated. |
| A list item reading 'Evidence <id> is referenced but is not included in this report bundle.' <br> *ordinary* | `that particular id does not resolve` | `apps/web/src/ui/evidence-list.tsx:53-60` | **nothing here.** Same edit as evidence-records-missing-panel; both appear together. |
| Refusal panel 'This claim carries no evidence references.', whose body talks about a finding rather than a goal <br> *edge* | `goal.evidence.length === 0` | `apps/web/src/ui/evidence-list.tsx:89-97` | **nothing here.** Empty demo-populated's OSC-GOAL-0002.evidence. The schema declares minItems 1, so only an imported or hand written goal reaches it, and the copy is written for the findings screen. |
| A record with no open action at all, because its kind carries no file <br> *load bearing* | `evidenceLocation(record) === null, true for span, metric, scenario_outcome, fault_injection, model_interpretation, derived and absence` | `apps/web/src/evidence-text.ts:246-259; branch at evidence-list.tsx:80` | demo-populated (the derived record has none, the config_entry record has one) |

## Scope, Source locations and Evidence records

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| No open action at all, because the report does not declare open_source_location <br> *ordinary* | `capabilityState(...).declared === false` | `apps/web/src/ui/evidence-list.tsx:24-26` | **nothing here.** Delete the open_source_location capability from demo-populated.capabilities. |
| A disabled button with the server's reason beside it: 'a standalone export cannot open a local editor' <br> *load bearing* | `declared && !available` | `apps/web/src/ui/actions.tsx:56-69` | every corpus bundle except demo-populated (but only demo-populated has goals, so no fixture shows it on this screen) |
| An enabled 'Open source location' button, repeated once per source location and once per locatable evidence record <br> *load bearing* | `declared && available` | `apps/web/src/ui/actions.tsx:53-73; used at goals.tsx:285 and evidence-list.tsx:80` | demo-populated served (its reason reads 'the served report can ask the local process to open an editor') |
| The button label gains an ellipsis and disables while the request is in flight <br> *ordinary* | `busy === true` | `apps/web/src/ui/actions.tsx:57,61` | demo-populated served |
| A result line 'Asked the editor to open <file>:<line>.' <br> *ordinary* | `the post succeeded and opened === true` | `apps/web/src/ui/evidence-list.tsx:43-44; rendered at actions.tsx:70` | demo-populated served |
| A result line 'The server did not open <file>:<line>.' or the transport error message <br> *ordinary* | `the post failed or opened === false` | `apps/web/src/ui/evidence-list.tsx:39-45` | **nothing here.** Press the control with no editor configured on the serving process. |

## Scope, Rollback

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A single small paragraph naming the rule identifier and pointing at the baseline runs <br> *ordinary* | `always present; NonEmptyString in the schema` | `apps/web/src/sections/goals.tsx:297-300; text at packages/goals/src/create.ts:246-247` | demo-populated |

## Goal card, actions

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Three buttons: Copy agent prompt, Export goal as JSON, Export as Markdown, none of them gated by any capability <br> *load bearing* | `always` | `apps/web/src/sections/goals.tsx:304-322` | demo-populated |
| A result line reading 'Copied.' under the copy button <br> *ordinary* | `copyText resolved true` | `apps/web/src/ui/actions.tsx:104-111` | demo-populated served |
| 'The clipboard is not available here. Select the text and copy it manually.' with no text to select anywhere on the page <br> *load bearing* | `both the clipboard write and the selection fallback failed` | `apps/web/src/ui/actions.tsx:109-110; apps/web/src/client.tsx:151-156` | **nothing here.** Open a standalone export from a file URL in a browser that denies clipboard access. |
| Downloaded files are named for the goal, OSC-GOAL-0001.json and OSC-GOAL-0001.md, with no project or report identifier in them <br> *edge* | `always` | `apps/web/src/sections/goals.tsx:312,318` | demo-populated |

## Copied agent prompt

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A section heading followed by '(none recorded)' rather than being omitted <br> *load bearing* | `any of EVIDENCE, SOURCE LOCATIONS, YOU MAY ONLY WRITE TO, YOU MUST NOT or BEHAVIOUR THAT MUST NOT CHANGE is empty` | `apps/web/src/prompt.ts:49-54` | **nothing here.** Copy the prompt for a goal created from vercel-ai-chatbot-exercised's OSC-ARCH-0001: the write scope and the source locations are both empty, so the agent is handed a task with no boundary and the words '(none recorded)' where the boundary should be. |
| An APPROVALS REQUIRED BEFORE MERGING section, present only when approvals exist, and carrying raw tokens like 'live_execution' where the screen shows 'Live execution' <br> *ordinary* | `goal.scope.requiredApprovals.length > 0` | `apps/web/src/prompt.ts:117-121` | demo-populated |
| An EXPECTED IMPROVEMENT section <br> *ordinary* | `goal.expectedImprovement !== undefined` | `apps/web/src/prompt.ts:122-124` | **nothing here.** Create a goal from demo-populated's OSC-PERF-0001. |

## Downloaded Markdown

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| '_None recorded._' in place of a list <br> *ordinary* | `any of the six listed sections is empty` | `apps/web/src/prompt.ts:132-134` | **nothing here.** Download the Markdown for a goal with no source locations. |
| A trailing '## Validation results' section, present only when the goal has been validated at least once <br> *ordinary* | `goal.validationResults.length > 0` | `apps/web/src/prompt.ts:181-191` | demo-populated (OSC-GOAL-0001 has it, OSC-GOAL-0002 does not) |

## Anywhere on the goal card

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A '[redacted:<label>:<length>]' token embedded mid sentence in the problem statement, a write path, a command, an evidence value or the rollback <br> *load bearing* | `the redactor matched a secret pattern anywhere in the bundle; redaction is applied deeply to the whole bundle including every goal` | `packages/report/src/bundle.ts:184 via packages/redaction/src/redact.ts:158-169` | **nothing here.** Put a string matching one of the twelve default rules (an OpenAI key, a bearer token, URL credentials) into a component's config location in apps/demo and re-run the audit. This is the third value state after present and absent: withheld. |

## What a designer needs to know beyond the list

ORDER AND ORIENTATION. Goals render in identifier order ascending (packages/persistence/src/repositories/goals.ts:53, ORDER BY id), which is creation order. There is no sort, no filter, no status grouping and no index. A validated goal from months ago sits above the one created five minutes ago, and with ten goals the reader has no way to find the one that is still open. This is the only screen of the eight with a repeated full-height card and no way to narrow it: Findings has filters (apps/web/src/filters.ts), the map has a table, Goals has nothing.

HEADING STRUCTURE VARIES WITH THE DATA. The empty screen renders a visible h3 GOALS eyebrow (goals.tsx:336). The populated screen renders no screen level label at all: the first thing on the page is a goal identifier in an eyebrow that is a plain paragraph, and the goal title is an h3. The only constant is the visually hidden h2 in app.tsx:287. A reader navigating by headings gets a different outline depending on whether any goal exists.

TWO CONTRADICTIONS ARE VISIBLE TODAY, BOTH IN DEMO-POPULATED.
1. AC-05 on both goals reads 'not satisfied' next to the check description 'the finding this goal was created from is no longer reported', with the detail underneath saying it still fires. The check description (apps/web/src/prompt.ts:34-35) is phrased as the satisfied outcome rather than as the condition being checked, which is fine on an unjudged row and wrong on every judged one. A designer needs either a conditional phrasing or a layout that never puts the check beside the outcome word.
2. The summary sentence and the outcome words can disagree in the other direction: a metric_not_worse criterion whose comparison direction is 'indeterminate' comes back satisfied:true, decided:false (packages/goals/src/validate-plan.ts:100-105). It renders 'undecided' but counts in satisfiedCount and in validated, so the screen can say 'all 1 acceptance criteria are satisfied.' with the status word 'Validated' above a single row reading 'undecided'. I verified this by calling validateGoal directly. That is the exact claim the module's own header comment says it exists to prevent, and it is a data state a designer will otherwise never see.

THE FINDING IDENTIFIER DISAGREES WITH ITSELF ACROSS THE CARD. demo-populated's goals store findingId OSC-REL-0003; goal-finding.ts correctly resolves the rule to OSC-REL-0005 and the link reads 'From finding OSC-REL-0005'; the copied agent prompt says 'Derived from finding OSC-REL-0003' (prompt.ts:104) and the Markdown says '- Finding: OSC-REL-0003' (prompt.ts:140). Three surfaces on one card, two identifiers. The screen resolved the problem the exports still have.

WHAT THE CARD DOES NOT SHOW. goal.metadata carries the originating finding's category, severity and basis, and none of the three reaches the page. A goal cut from a critical finding is visually identical to one cut from an info finding. The judgement's comparisonId (packages/schema/src/report.ts:121) is also never rendered, so a criterion can be decided by a comparison the card never names, which is the ordinary state after compare --goal followed by audit with no goal validate. There is also no control anywhere to record the manual_review a criterion asks for, and no control to change a status.

THE EMPTY STATE NAMES A FINDING AND DOES NOT LINK TO IT. goals.tsx:333 picks the first eligible finding, which because findings arrive severity-sorted is the most severe eligible one, but the sentence gives only the identifier: no title, no severity, no eligibility reason, and no navigation to it. The reader has to copy the identifier into the command by hand. The same sentence covers two different situations, a report with findings none of which are eligible (axios, langgraphjs) and a report with no findings at all (orchescope-discovery).

UNREACHABLE-BY-SCHEMA EMPTY STATES THAT ARE REACHABLE IN PRACTICE. GoalScope.allowedWritePaths declares minItems 1, evidence declares minItems 1, affectedComponents declares minItems 1 and acceptanceCriteria declares minItems 1, but nothing validates a goal document before packages/persistence/src/repositories/goals.ts:26 writes it and apps/web/src/bundle.ts only checks the bundle shallowly. Three eligible findings in the corpus (vercel-ai-chatbot-exercised OSC-ARCH-0001 and OSC-ARCH-0002, pydantic-ai-exercised OSC-OBS-0001) name only runtime-discovered components with no source locations, so createGoal produces a goal with zero write paths and zero source locations. The screen already has the right sentence for it ('which makes this goal unimplementable as written'), and it is worth designing for rather than treating as impossible.

DUPLICATE KEY RISKS. The evidence summary is keyed on label plus value (goals.tsx:121), and evidenceSummaryFor groups by kind and class while labelling only by kind, so two classes of the same kind with the same count produce two identical keys. Source locations are keyed on file plus startLine (goals.tsx:283), so two spans starting on the same line collide. Neither is a crash, but both make list reconciliation unreliable.

SMALL INCONSISTENCIES A DESIGN PASS SHOULD SETTLE. Status is humanised ('In progress') and risk is not ('risk medium') in the same meta line. The comparison verdict prints raw ('insufficient_evidence') while the goal status beside it is humanised. Approvals are humanised on screen and raw in the exported prompt. The affected-component buttons here carry no title attribute where the identical buttons on the findings card do (apps/web/src/ui/finding-card.tsx:104). 'Scenarios to rerun: none' renders in prose while the same row renders in mono when populated, so the row changes typeface with the data. The validation commands list has no eyebrow naming it, unlike every other group in the card. And several stored sentences carry a frozen plural: '1 record(s)' on demo-populated's older goal, 'over 5 repetition(s)' in every scenario detail, 'all 1 acceptance criteria are satisfied' and '1 evidence records are referenced'.

TESTING GAP WORTH KNOWING. apps/web/src/goal-finding.ts has no test file, and there is no browser test covering the Goals screen in tests/ui/workspace.spec.ts. Everything above was read from the source and, where it mattered, executed: describeAcceptanceCheck was run over all ten check shapes and validateGoal was run over the indeterminate case."

