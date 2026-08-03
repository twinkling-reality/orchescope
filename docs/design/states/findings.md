# Findings: every state

114 states across 40 blocks. 35 of them are reached by no report in `corpus/.cache/bundles`, so `pnpm states` will not show them to you and the fourth column says what would.

Source: `Findings screen (apps/web/src/sections/findings.tsx and everything it reaches: ui/finding-card.tsx, ui/filters.tsx, ui/evidence-list.tsx, filters.ts, finding-text.ts, evidence-text.ts, basis.ts, ui/primitives.tsx, ui/actions.tsx)`.

## Thresholds

| Constant | Value | Where | What it switches | Why that number |
| --- | --- | --- | --- | --- |
| `MAX_COMPONENTS` | 25 | `packages/findings/src/grouping.ts:16` | At or below it a grouped finding lists every affected component as a button. Above it the list stops at 25, the explanation gains the clause 'X of the Y affected components are not listed here', and a componentsWithheld measurement row appears in the table. The browser applies no ceiling of its own: apps/web/src/ui/finding-card.tsx:101 renders whatever the array holds. | Taste, argued in the file comment: a list that stops without saying so reads as a complete list, so nothing is dropped silently. No arithmetic is given, unlike the map's 120. |
| `MAX_EDGES` | 25 | `packages/findings/src/grouping.ts:17` | Nothing on this screen. finding.edges is carried in every bundle and no part of the Findings screen reads it. | Symmetry with MAX_COMPONENTS, undocumented. |
| `MAX_EVIDENCE` | 10 | `packages/findings/src/grouping.ts:18` | A grouped finding's evidence list is truncated to ten records, which is why grouped findings show '10 evidence' while ungrouped ones reach 20. Unlike components, this truncation is never stated on the page. | Taste, undocumented. Worth noting the asymmetry: withheld components are announced, withheld evidence is not. |
| `MAX_SOURCE_LOCATIONS` | 10 | `packages/findings/src/engine.ts:57` | The Source locations block, and with it the number of repeated open controls, never exceeds ten rows. A second cap of 2 locations per component applies first (engine.ts:140). | Stated in the comment: a grouped finding names many components and a location list has to stay something a person can read. |
| `MIN_CONFIDENCE_BY_SEVERITY` | critical 0.9, high 0.75, medium 0.6, low 0.4, info 0 | `packages/domain/src/severity.ts:42` | Which severity marks can exist at all. A rule's proposed severity is stepped down until the confidence supports it, so with only four confidence bands in use (0.60, 0.75, 0.85, 0.98) the reachable set is high, medium, low and info. | Policy: a claim may not be presented more strongly than its evidence allows. |
| `MAX_SEVERITY_BY_BASIS` | observed and discovered critical, simulated and inferred high, estimated and model_interpreted medium | `packages/domain/src/severity.ts:33` | Caps the severity mark a given evidence class can draw. It is why every simulated chaos finding in demo-populated tops out at high, and why a model interpreted finding could never draw the doubled critical mark. | Policy, stated in the file comment: a finding built only on inference cannot be critical. |
| `SEVERITY rank` | critical 5, high 4, medium 3, low 2, info 1, anything else 0 | `apps/web/src/basis.ts:119 and :135` | Sort order within each list (severity, then confidence, then id) and the mark shape. Rank 0 both sorts an unrecognised severity last and gives it the hollow circle that belongs to no rank. | The mark shapes are derived in the file comment: five forms distinct in greyscale, more ink means worse. The ranks themselves are the schema's own order. |
| `BASIS_ORDER` | observed, discovered, inferred, estimated, simulated, model_interpreted | `apps/web/src/basis.ts:27` | The order of the Evidence class filter chips, which is fixed rather than by count, so Observed leads even when one finding carries it and forty carry Discovered. | Strength of evidence, strongest first, though it does not match packages/domain BASIS_STRENGTH, which ranks simulated above inferred. |

## Findings, whole section

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The whole screen is one refusal panel with the audit command <br> *load bearing* | `bundle.findings.length === 0` | `apps/web/src/sections/findings.tsx:119` | orchescope-discovery |

## Findings / Filters block

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Search field followed by up to four token groups and a match sentence <br> *load bearing* | `bundle.findings.length > 0` | `apps/web/src/sections/findings.tsx:136` | every fixture except orchescope-discovery |

## Findings / Filters / Severity

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Severity group with a single checkbox, so the control cannot narrow anything <br> *load bearing* | `SEVERITY_ORDER.filter(s => findings.some(f => f.severity === s)).length === 1` | `apps/web/src/sections/findings.tsx:90` | flask, express, axios |
| Severity group with two checkboxes <br> *ordinary* | `presentSeverities.length === 2` | `apps/web/src/sections/findings.tsx:90` | langgraph, langgraphjs, anthropic-quickstarts, openai-agents-js, openai-agents-python, pydantic-ai, pydantic-ai-exercised, crewai, vercel-ai-chatbot |
| Severity group with four checkboxes, the widest any report reaches <br> *load bearing* | `presentSeverities.length === 4 (high, medium, low, info)` | `apps/web/src/sections/findings.tsx:90` | demonstration-system, demo-populated, vercel-ai-chatbot-exercised |
| Severity group carrying Critical, and a card drawing the doubled mark <br> *load bearing* | `findings.some(f => f.severity === 'critical')` | `apps/web/src/basis.ts:120` | **nothing here.** No rule ever proposes critical, and capSeverity would only allow it with basis observed or discovered and confidence >= 0.9 (packages/domain/src/severity.ts:33,42). Set findings[0].severity to 'critical' in a copy of demo-populated.json. |

## Findings / Filters / Severity and every card row

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A severity this build does not rank: hollow circle mark, the raw word as its label, no filter checkbox for it, and it sorts last <br> *edge* | `finding.severity is not one of critical, high, medium, low, info` | `apps/web/src/basis.ts:131 (describeSeverity), apps/web/src/sections/findings.tsx:92 (option omitted), apps/web/src/filters.ts:75 (rank 0)` | **nothing here.** Set findings[0].severity to 'blocker' in a copy of flask.json. Note the finding is still counted in the match sentence but can never be selected by any severity chip. |

## Findings / Filters / Category

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Category group with a single checkbox <br> *load bearing* | `distinctValues(findings, f => f.category).length === 1` | `apps/web/src/sections/findings.tsx:86` | flask, express, axios |
| Category group with seven checkboxes, alphabetical by machine value, wrapping to a second row <br> *load bearing* | `distinctValues(findings, f => f.category).length === 7` | `apps/web/src/sections/findings.tsx:86` | pydantic-ai-exercised |
| An underscored category becomes a sentence: agent_complexity reads Agent complexity, scenario_coverage reads Scenario coverage <br> *ordinary* | `finding.category contains an underscore` | `apps/web/src/sections/findings.tsx:170, apps/web/src/format.ts:146` | pydantic-ai, pydantic-ai-exercised, demo-populated, demonstration-system, crewai |

## Findings / Filters / Polarity

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Polarity group always draws both options, so a report with no strengths still shows a Strength checkbox counting 0 <br> *load bearing* | `findings.every(f => f.polarity === 'risk'); the options array is a literal, not derived from the data` | `apps/web/src/sections/findings.tsx:180` | flask, express, axios, langgraph, langgraphjs, anthropic-quickstarts, openai-agents-js, openai-agents-python, pydantic-ai, pydantic-ai-exercised |
| Polarity group with both counts non zero <br> *ordinary* | `findings.some(polarity==='risk') && findings.some(polarity==='strength')` | `apps/web/src/sections/findings.tsx:180` | crewai, demonstration-system, demo-populated, vercel-ai-chatbot, vercel-ai-chatbot-exercised |

## Findings / Filters / Polarity and Risks list

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A report of strengths only: Risk checkbox counts 0 and the Risks list refuses while the Strengths list fills <br> *edge* | `findings.length > 0 && findings.every(f => f.polarity === 'strength')` | `apps/web/src/sections/findings.tsx:184, :214` | **nothing here.** Delete every risk finding from a copy of crewai.json, leaving OSC-... the single strength. |

## Findings / Filters / Evidence class

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Evidence class group with a single checkbox, always Discovered <br> *load bearing* | `BASIS_ORDER.filter(b => findings.some(f => f.basis === b)).length === 1` | `apps/web/src/sections/findings.tsx:97` | flask, express, axios, crewai, langgraphjs, demonstration-system |
| Evidence class group with four checkboxes ordered Observed, Discovered, Inferred, Simulated, not by count <br> *load bearing* | `presentBases.length === 4` | `apps/web/src/sections/findings.tsx:97, apps/web/src/basis.ts:27` | demo-populated |
| Evidence class group carrying Estimated and Model interpreted as well <br> *edge* | `findings.some(f => f.basis === 'estimated' \|\| f.basis === 'model_interpreted')` | `apps/web/src/sections/findings.tsx:97` | **nothing here.** No rule emits either basis on a finding (one metric inside a finding does, see measurement-basis-estimated). Set findings[0].basis to 'estimated' in a copy of demo-populated.json; capSeverity would also drop it to medium. |

## Findings / Filters / Evidence class and every card row

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A basis this build does not know: the chip reads Unknown basis with an explanatory title, and no checkbox exists for it <br> *edge* | `finding.basis is outside BASIS_ORDER` | `apps/web/src/basis.ts:75 and :83; option omitted at apps/web/src/sections/findings.tsx:98` | **nothing here.** Set findings[0].basis to 'vibes' in a copy of flask.json. |

## Findings / Filters

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A token group renders nothing at all when it has no options <br> *edge* | `options.length === 0` | `apps/web/src/ui/filters.tsx:22` | **nothing here.** Unreachable on this screen by construction: severity, category and evidence class all have at least one option whenever findings exist, and polarity is a literal pair. The only no-filters state is section-refuses-no-findings, where the whole Filters block including the search field is absent. |

## Findings / Filters, all groups

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Chip counts are computed over the whole bundle, so they never move as filters narrow and can read a non zero count beside an empty result <br> *load bearing* | `any two filters selected whose intersection is empty, e.g. Severity High with Category cost` | `apps/web/src/sections/findings.tsx:159, :171, :184, :202` | demo-populated, demonstration-system, pydantic-ai-exercised |

## Findings / Filters / Search findings

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Empty search box with the placeholder 'title, explanation, component, tag' and a status line reading the full count <br> *load bearing* | `filter.query.length === 0` | `apps/web/src/sections/findings.tsx:139, apps/web/src/ui/filters.tsx:93` | every fixture with findings |
| Status line singularises at one: '1 finding shown' <br> *ordinary* | `matched.length === 1` | `apps/web/src/ui/filters.tsx:96, apps/web/src/format.ts:173` | flask, express, axios (unfiltered); any fixture with a narrow query |
| Status line reads '0 findings shown' while both lists below refuse <br> *load bearing* | `matched.length === 0` | `apps/web/src/ui/filters.tsx:96` | any fixture, type a word no finding contains |

## Findings / Filters and both lists

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A query of only spaces excludes nothing, yet the screen believes it is filtered: both empty messages switch to the filtered wording and Clear every filter appears <br> *edge* | `filter.query.length > 0 && filter.query.trim().length === 0` | `apps/web/src/filters.ts:11 (trim to empty matches all) against apps/web/src/sections/findings.tsx:109 (length only)` | any fixture, type a single space |

## Findings / risk and strength lists

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A row survives a query that matches text the reader cannot see: the finding id, the rule id, a taxonomy code or a raw component id <br> *ordinary* | `query matches findingHaystack but not the title, explanation or impact on screen` | `apps/web/src/filters.ts:45` | pydantic-ai (search 'owasp-asi'), any fixture (search a ruleId such as 'topology-shape') |
| Searching the component name the card actually shows finds nothing, because the haystack holds component ids and the card renders display names <br> *load bearing* | `query is a component displayName that differs from its id` | `apps/web/src/filters.ts:52 against apps/web/src/ui/finding-card.tsx:111` | demo-populated, demonstration-system |

## Findings / Filters / match count line

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The generated sentence never singularises: a one finding report reads '1 of 1 findings match: 1 risks and 0 strengths.' <br> *load bearing* | `matched.length === 1 \|\| risks.length === 1 \|\| strengths.length === 1` | `apps/web/src/sections/findings.tsx:207` | flask, express, axios, crewai, vercel-ai-chatbot |
| '0 of N findings match: 0 risks and 0 strengths.' announced through a polite live region <br> *load bearing* | `matched.length === 0 && bundle.findings.length > 0` | `apps/web/src/sections/findings.tsx:206` | any fixture with an impossible filter combination |

## Findings, on arrival

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Arriving from the overview severity legend, one severity chip is already checked and both lists are already narrowed <br> *load bearing* | `route.params['severity'] is set at mount` | `apps/web/src/sections/findings.tsx:77 and :80, entered from apps/web/src/sections/overview.tsx:694` | any fixture with findings, via the overview legend |
| A severity in the link that no finding carries: everything is filtered away with no checked chip anywhere to explain why, only the Clear every filter button <br> *load bearing* | `route.params['severity'] set to a value not in presentSeverities` | `apps/web/src/sections/findings.tsx:83 (filter applied) against :156 (options only from present severities)` | **nothing here.** Open any fixture at #/findings?severity=critical. |

## Findings / one card

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| One card arrives already expanded because the link named it <br> *load bearing* | `route.params['finding'] equals a rendered finding id` | `apps/web/src/sections/findings.tsx:78 and :66` | any fixture, via the overview top risks or a component details panel |
| A named finding that the current filter excludes, or that is not in the bundle, opens nothing and says nothing <br> *edge* | `openId !== null && matched.every(f => f.id !== openId)` | `apps/web/src/sections/findings.tsx:66` | **nothing here.** Open any fixture at #/findings?severity=info&finding=<the id of a medium risk>, or at #/findings?finding=OSC-XXX-9999. |

## Findings, already open

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A second severity link while the screen is already mounted changes the URL and nothing else, because the filter is seeded once <br> *edge* | `route.params['severity'] changes while the Findings section stays mounted` | `apps/web/src/sections/findings.tsx:80 (useState initialiser)` | **nothing here.** Open #/findings?severity=high then edit the hash to severity=low without leaving the section. |

## Findings / Risks

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Risks heading with the count 1 above a single row <br> *load bearing* | `risks.length === 1` | `apps/web/src/sections/findings.tsx:57` | flask, express, axios |
| The longest risk list any report produces, nineteen rows rendered whole rather than windowed <br> *load bearing* | `risks.length === 19` | `apps/web/src/sections/findings.tsx:60` | demo-populated |
| A list long enough for the unwindowed decision to hurt <br> *edge* | `risks.length > 50` | `apps/web/src/sections/findings.tsx:60` | **nothing here.** Unreachable from the pipeline: grouping collapses repeats, so the largest fixture (openai-agents-python, 1390 components) yields six findings. Concatenate the findings arrays of several bundles into one to see it. |
| 'No risk was reported' with the sentence about the rules rather than the system, and no clear control <br> *load bearing* | `risks.length === 0 && !filtered` | `apps/web/src/sections/findings.tsx:216` | **nothing here.** Delete every risk from a copy of crewai.json, keeping its one strength. |
| 'No risk matches the current filters.' with a Clear every filter button <br> *load bearing* | `risks.length === 0 && filtered` | `apps/web/src/sections/findings.tsx:215 and :44` | crewai, demonstration-system, demo-populated (tick Polarity Strength) |

## Findings / Strengths

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| 'No strength was reported. A strength needs the same evidence a risk does' under a Strengths heading counting 0 <br> *load bearing* | `strengths.length === 0 && !filtered` | `apps/web/src/sections/findings.tsx:228 and :40` | flask, express, axios, langgraph, langgraphjs, anthropic-quickstarts, openai-agents-js, openai-agents-python, pydantic-ai, pydantic-ai-exercised |
| A short strengths list below the risks <br> *load bearing* | `strengths.length >= 1` | `apps/web/src/sections/findings.tsx:223` | crewai (1), vercel-ai-chatbot (1), vercel-ai-chatbot-exercised (1), demonstration-system (2), demo-populated (2) |

## Findings / Risks and Strengths together

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Two refusal panels stacked, each with its own Clear every filter button, below a match line reading 0 <br> *load bearing* | `matched.length === 0 && filtered` | `apps/web/src/sections/findings.tsx:211 and :223` | any fixture, search for a word no finding contains |

## Findings / collapsed row

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| High: one filled square in the alert hue <br> *load bearing* | `finding.severity === 'high'` | `apps/web/src/basis.ts:121, apps/web/src/ui/primitives.tsx:141` | demo-populated, demonstration-system, vercel-ai-chatbot-exercised |
| Medium: a filled half height bar in the second hue <br> *load bearing* | `finding.severity === 'medium'` | `apps/web/src/basis.ts:122, apps/web/src/styles.css:425` | every fixture with findings |
| Low: a hollow square in the faint neutral <br> *load bearing* | `finding.severity === 'low'` | `apps/web/src/basis.ts:123, apps/web/src/styles.css:429` | anthropic-quickstarts, langgraph, langgraphjs, openai-agents-js, openai-agents-python, pydantic-ai, pydantic-ai-exercised, demonstration-system, demo-populated, vercel-ai-chatbot-exercised |

## Findings / Strengths, collapsed row

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Info: a hollow half height bar, in practice only ever seen on a strength <br> *load bearing* | `finding.severity === 'info'` | `apps/web/src/basis.ts:124, apps/web/src/styles.css:436` | crewai, demonstration-system, demo-populated, vercel-ai-chatbot, vercel-ai-chatbot-exercised |

## Findings / Risks, collapsed row

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| An info severity row inside the Risks list, where the faintest mark carries a problem <br> *edge* | `finding.polarity === 'risk' && finding.severity === 'info'` | `apps/web/src/sections/findings.tsx:106` | **nothing here.** Every info finding in every fixture is a strength (the engine forces strengths to info at packages/findings/src/engine.ts:126). Set an info finding's polarity to 'risk' in a copy of demonstration-system.json. |

## Findings / collapsed row, right hand column

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The meta column reads '1 evidence' with no singular form <br> *load bearing* | `finding.evidence.length === 1` | `apps/web/src/ui/finding-card.tsx:268` | demo-populated (seven chaos findings), demonstration-system, vercel-ai-chatbot-exercised |
| '20 evidence', the largest count any report reaches <br> *ordinary* | `finding.evidence.length === 20` | `apps/web/src/ui/finding-card.tsx:268` | pydantic-ai, pydantic-ai-exercised, vercel-ai-chatbot-exercised |
| A confidence of exactly 1 renders as '1', not '1.00', beside neighbours reading '0.98' <br> *edge* | `Number.isInteger(finding.confidence)` | `apps/web/src/format.ts:39 via :100` | **nothing here.** Only four confidences exist in the corpus (0.60, 0.75, 0.85, 0.98). Set findings[0].confidence to 1 in a copy of flask.json. |

## Findings / collapsed row, title

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A grouped title leads with the occurrence count substituted into it: '261 components cannot be reached from any declared entry point' <br> *load bearing* | `the draft carried an occurrence key and more than one instance merged` | `packages/findings/src/grouping.ts:76` | openai-agents-python, openai-agents-js, pydantic-ai, pydantic-ai-exercised, langgraph, crewai, anthropic-quickstarts, demo-populated |
| A single instance title with no leading count <br> *ordinary* | `the finding carries no occurrences metric` | `packages/findings/src/grouping.ts:68` | flask, express, axios, demo-populated, vercel-ai-chatbot |

## Findings / expanded card, first paragraph

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The explanation gains a generated sentence: 'N occurrences of this pattern were found in this repository, and this description is written from the first of them.' <br> *load bearing* | `grouped && components.length <= 25` | `packages/findings/src/grouping.ts:59` | anthropic-quickstarts, langgraph, langgraphjs, demonstration-system, demo-populated |
| A second generated clause states the omission: '236 of the 261 affected components are not listed here.' <br> *load bearing* | `grouped && components.length > 25` | `packages/findings/src/grouping.ts:63` | openai-agents-python, openai-agents-js, pydantic-ai, pydantic-ai-exercised, crewai |

## Findings / expanded card

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| No Measurements block at all <br> *load bearing* | `finding.metrics.length === 0` | `apps/web/src/ui/finding-card.tsx:50` | flask, express, axios, demo-populated (OSC-REL-0003, OSC-MAINT-0001, OSC-CPLX-0001) |
| No Affected components block <br> *edge* | `finding.components.length === 0` | `apps/web/src/ui/finding-card.tsx:92` | **nothing here.** Every rule names at least one component (packages/schema/src/finding.ts:17 states a finding that cannot name components is rejected). Empty the components array of findings[0] in a copy of flask.json. |
| No Source locations block, and no Open source location control in the actions row either <br> *load bearing* | `finding.sourceLocations.length === 0` | `apps/web/src/ui/finding-card.tsx:293 and :244` | pydantic-ai-exercised (OSC-OBS-0001), vercel-ai-chatbot-exercised (OSC-ARCH-0001, OSC-ARCH-0002) |
| No Recommendation block, so the card goes from evidence straight to classification <br> *load bearing* | `finding.recommendation === undefined` | `apps/web/src/ui/finding-card.tsx:121` | demo-populated (7 of 21), demonstration-system, pydantic-ai, crewai |
| No Suggested experiment block <br> *load bearing* | `finding.suggestedExperiment === undefined` | `apps/web/src/ui/finding-card.tsx:144` | flask, express, axios, langgraphjs, demo-populated (most findings) |

## Findings / expanded card / Measurements

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A five column table with one to three rows inside a horizontal scroller <br> *load bearing* | `finding.metrics.length between 1 and 3` | `apps/web/src/ui/finding-card.tsx:56` | demo-populated (1 and 2 rows), pydantic-ai (3 rows), crewai, langgraph |
| The 'Compared with' column reads 'not compared' in every row of every report <br> *load bearing* | `metric.comparisonValue === undefined` | `apps/web/src/ui/finding-card.tsx:73` | every fixture that has metrics |
| A comparison value beside the measurement, the only thing that column exists for <br> *load bearing* | `metric.comparisonValue !== undefined` | `apps/web/src/ui/finding-card.tsx:75` | **nothing here.** No rule sets comparisonValue anywhere in the corpus. Add comparisonValue to a metric in a copy of demo-populated.json. |
| The generated occurrence rows read '261 occurrence' and '236 component', because a unit is never pluralised <br> *load bearing* | `metric.unit is 'occurrence' or 'component'` | `apps/web/src/format.ts:142 via apps/web/src/ui/finding-card.tsx:71` | openai-agents-python, openai-agents-js, pydantic-ai, pydantic-ai-exercised, crewai, langgraph, demo-populated |
| A unit the formatter owns is rewritten: ratio and fraction become a percentage, ms becomes a duration, and the unit word disappears from the cell <br> *ordinary* | `metric.unit is one of ratio, fraction, ms, usd, percent, bytes` | `apps/web/src/format.ts:125` | demo-populated (ratio, ms), pydantic-ai-exercised (ratio), vercel-ai-chatbot-exercised (fraction) |
| An Estimated chip in the evidence class column of a finding whose own basis is something else <br> *ordinary* | `metric.basis !== finding.basis` | `apps/web/src/ui/finding-card.tsx:79` | demo-populated |

## Findings / expanded card / Affected components

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A single component button under a heading counting 1 <br> *load bearing* | `finding.components.length === 1` | `apps/web/src/ui/finding-card.tsx:97` | demo-populated, demonstration-system, pydantic-ai-exercised, vercel-ai-chatbot-exercised |
| Exactly 25 buttons, the pipeline ceiling, with the withheld count stated in the explanation above and carried as a measurement row <br> *load bearing* | `finding.components.length === 25` | `packages/findings/src/grouping.ts:81, rendered whole at apps/web/src/ui/finding-card.tsx:101` | pydantic-ai, pydantic-ai-exercised, openai-agents-python, openai-agents-js, crewai |
| More than 25 buttons: the browser applies no ceiling of its own and would draw every one <br> *edge* | `finding.components.length > 25` | `apps/web/src/ui/finding-card.tsx:101 (no slice)` | **nothing here.** Paste 200 component ids into findings[0].components in a copy of pydantic-ai.json. Worth designing: the doc claims a 25 ceiling on this screen, but the ceiling lives in the pipeline, not here. |
| A component the graph does not contain shows its raw id as the button label and navigates to a map that cannot select it <br> *edge* | `!index.componentsById.has(componentId)` | `apps/web/src/graph-index.ts:280 via apps/web/src/ui/finding-card.tsx:111` | **nothing here.** No fixture references an absent component. Add 'agent:ghost' to findings[0].components in a copy of flask.json. The components table names this case with a tg-note; the finding card does not. |

## Findings / expanded card / Source locations

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| One monospaced path with its own open control <br> *ordinary* | `finding.sourceLocations.length === 1` | `apps/web/src/ui/finding-card.tsx:295` | demo-populated, demonstration-system, flask |
| Ten paths, the pipeline cap, each with a repeated open control beneath it <br> *load bearing* | `finding.sourceLocations.length === 10` | `packages/findings/src/engine.ts:57, rendered at apps/web/src/ui/finding-card.tsx:298` | pydantic-ai, pydantic-ai-exercised, openai-agents-python, openai-agents-js, langgraph, crewai |
| A span renders as file:12-40 where a single line renders as file:12 <br> *ordinary* | `location.endLine !== undefined && location.endLine !== location.startLine` | `apps/web/src/format.ts:166` | most fixtures carry both forms; 202 of 305 referenced source spans are ranges |

## Findings / expanded card / Evidence

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A refusal panel: 'This claim carries no evidence references. A finding without evidence is an assertion.' <br> *load bearing* | `finding.evidence.length === 0` | `apps/web/src/ui/evidence-list.tsx:89` | **nothing here.** The schema requires at least one (packages/schema/src/finding.ts:105, minItems 1), so no valid bundle reaches it. Empty findings[0].evidence in a copy of flask.json. |
| A single evidence record under a heading counting 1 <br> *load bearing* | `finding.evidence.length === 1` | `apps/web/src/ui/evidence-list.tsx:109` | demo-populated (the seven chaos findings), demonstration-system, vercel-ai-chatbot-exercised |
| Twenty stacked records, each a meta line, a monospaced headline and a definition list, inside one expanded card <br> *load bearing* | `finding.evidence.length === 20` | `apps/web/src/ui/evidence-list.tsx:109` | pydantic-ai, pydantic-ai-exercised, vercel-ai-chatbot-exercised |
| A refusal panel counting the absent records, and each one drawn as a dashed outlined row saying it is not in this bundle <br> *load bearing* | `finding.evidence.some(id => !index.evidenceById.has(id))` | `apps/web/src/ui/evidence-list.tsx:99 and :52, styled at apps/web/src/styles.css:1251` | **nothing here.** Every reference resolves in all sixteen bundles. Add 'ev_deadbeefdeadbeef' to findings[0].evidence in a copy of flask.json. |

## Findings / expanded card / Evidence / one record

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Source span: the location as the headline, then Location and Symbol rows <br> *load bearing* | `evidence.kind === 'source_span'` | `apps/web/src/evidence-text.ts:39` | every fixture with findings |
| A source span that also carries an Excerpt and a File digest row, which changes the height of the record <br> *load bearing* | `evidence.excerpt !== undefined \|\| evidence.location.fileHash !== undefined` | `apps/web/src/evidence-text.ts:53 and :54` | **nothing here.** Zero of 305 referenced source spans carry either. Add an excerpt and a fileHash to one evidence record in a copy of pydantic-ai.json. |
| Config entry: file plus JSON pointer as the headline, with File, Pointer and Value rows <br> *load bearing* | `evidence.kind === 'config_entry' && evidence.value !== undefined` | `apps/web/src/evidence-text.ts:59` | demonstration-system, demo-populated |
| The same record with no Value row, which is exactly half of them <br> *ordinary* | `evidence.kind === 'config_entry' && evidence.value === undefined` | `apps/web/src/evidence-text.ts:69` | demonstration-system, demo-populated |
| An empty pointer renders as '/' rather than as an empty cell <br> *edge* | `evidence.location.pointer === ''` | `apps/web/src/evidence-text.ts:68` | **nothing here.** Set a config_entry pointer to '' in a copy of demonstration-system.json. |
| Span: the span name as the headline, then Span, Run, Trace, Span id, Attribute and Attribute value, six monospaced rows <br> *load bearing* | `evidence.kind === 'span'` | `apps/web/src/evidence-text.ts:75` | demo-populated, pydantic-ai-exercised, vercel-ai-chatbot-exercised |
| Derived: the rule name as the headline, a Derived from row listing input evidence ids, and a Note <br> *load bearing* | `evidence.kind === 'derived'` | `apps/web/src/evidence-text.ts:178` | crewai, pydantic-ai, pydantic-ai-exercised, demo-populated, demonstration-system, vercel-ai-chatbot-exercised |
| A Derived from row with an empty value, the one field in the whole screen that can render blank <br> *edge* | `evidence.kind === 'derived' && evidence.inputs.length === 0` | `apps/web/src/evidence-text.ts:186` | **nothing here.** Empty the inputs array of a derived record in a copy of crewai.json. Every other absent value is a word. |
| Absence: 'Searched for X, found none' with the scope and the number of items inspected <br> *load bearing* | `evidence.kind === 'absence'` | `apps/web/src/evidence-text.ts:192` | demonstration-system, demo-populated, pydantic-ai-exercised, vercel-ai-chatbot-exercised |
| Fault injection: 'Tool timeout into refunds' with the times applied and the run <br> *load bearing* | `evidence.kind === 'fault_injection'` | `apps/web/src/evidence-text.ts:140` | demo-populated |
| Metric: 'name = value' as the headline with the sample size and run <br> *load bearing* | `evidence.kind === 'metric'` | `apps/web/src/evidence-text.ts:92` | **nothing here.** No bundle contains a metric evidence record at all. Add one to bundle.evidence and reference it from a finding in a copy of demo-populated.json. |
| Scenario outcome: 'scenario: outcome', with optional Variant, Evaluator and Detail rows <br> *load bearing* | `evidence.kind === 'scenario_outcome'` | `apps/web/src/evidence-text.ts:108` | **nothing here.** No bundle contains one. Add a scenario_outcome record and reference it from a finding in a copy of demo-populated.json, which is the only bundle with scenario runs. |
| Dependency: 'package (ecosystem)' with a version range and a manifest that the open control targets <br> *ordinary* | `evidence.kind === 'dependency'` | `apps/web/src/evidence-text.ts:125` | **nothing here.** No bundle contains one. Add a dependency record and reference it from a finding in a copy of flask.json. |
| Model interpretation: provider and model, prompt digest, what it was grounded in, and whether a human reviewed it <br> *load bearing* | `evidence.kind === 'model_interpretation'` | `apps/web/src/evidence-text.ts:155` | **nothing here.** Analysis in this build is deterministic and the model_interpretation capability is unavailable in every bundle. Add such a record by hand to see it, including the 'Grounded in' fallback '(nothing recorded)' at evidence-text.ts:170. |
| 'Unrecognised evidence kind' with no fields, so the record still names its id, basis and producer <br> *edge* | `evidence.kind is outside the ten known kinds` | `apps/web/src/evidence-text.ts:228` | **nothing here.** Set an evidence record's kind to 'hunch' in a copy of flask.json. Note DefinitionList then renders 'Nothing recorded.' (apps/web/src/ui/primitives.tsx:338). |
| Only source spans, config entries and dependencies get an open control under the record; spans, metrics, absences, faults and derivations get none <br> *ordinary* | `evidenceLocation(record) !== null` | `apps/web/src/evidence-text.ts:247 via apps/web/src/ui/evidence-list.tsx:80` | demo-populated, demonstration-system (both forms in one card) |

## Findings / expanded card / Recommendation

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A summary sentence, an ordered list of two or three steps, and the effort and change risk note that labels itself a judgement <br> *load bearing* | `finding.recommendation !== undefined && steps.length > 0` | `apps/web/src/ui/finding-card.tsx:129` | every fixture that has recommendations; only 2 and 3 step lists exist |
| A summary and the effort note with no ordered list between them <br> *edge* | `finding.recommendation.steps.length === 0` | `apps/web/src/ui/finding-card.tsx:129` | **nothing here.** Empty recommendation.steps on findings[0] in a copy of flask.json. |
| 'Effort unknown and change risk unknown' in the note, the vocabulary's escape hatch <br> *edge* | `recommendation.effort === 'unknown' \|\| recommendation.risk === 'unknown'` | `apps/web/src/ui/finding-card.tsx:137, values from packages/schema/src/finding.ts:50` | **nothing here.** Only small and medium effort and low and medium risk occur in the corpus. Set effort and risk to 'unknown' on a recommendation in a copy of demo-populated.json. |

## Findings / expanded card / Suggested experiment

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A description, a copyable command block, and the expected signal, with no scenario line <br> *load bearing* | `suggestedExperiment !== undefined && suggestedExperiment.scenarioId === undefined` | `apps/web/src/ui/finding-card.tsx:148` | demo-populated, anthropic-quickstarts, crewai, langgraph, openai-agents-js, openai-agents-python, pydantic-ai, pydantic-ai-exercised, vercel-ai-chatbot |

## Findings / expanded card / Suggested experiment and actions row

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A 'Scenario X' meta line under the experiment, and a fourth action button 'Rerun relevant test' <br> *load bearing* | `finding.suggestedExperiment?.scenarioId !== undefined` | `apps/web/src/ui/finding-card.tsx:154 and :209` | **nothing here.** No finding in any bundle sets scenarioId. Add suggestedExperiment.scenarioId to a finding in a copy of demo-populated.json, the only bundle where rerun_scenario is available. The same field is the only thing that puts a scenarioId into the compare_runs request body (finding-card.tsx:170). |

## Findings / expanded card / Classification

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Taxonomy reads 'no unambiguous mapping' in prose rather than in code type <br> *load bearing* | `finding.taxonomy.length === 0` | `apps/web/src/ui/finding-card.tsx:328` | most findings in every fixture |
| One or two comma separated codes set in monospace, always owasp-llm or owasp-asi <br> *ordinary* | `finding.taxonomy.length > 0` | `apps/web/src/ui/finding-card.tsx:330` | pydantic-ai, demo-populated, crewai, anthropic-quickstarts, langgraph, openai-agents-js, openai-agents-python, vercel-ai-chatbot |
| An atlas, cwe or mast code, which are longer and change the row's wrap <br> *edge* | `taxonomy entry prefix is atlas, cwe or mast` | `packages/schema/src/finding.ts:124` | **nothing here.** Add 'cwe:CWE-77' to a taxonomy array in a copy of pydantic-ai.json. |
| Tags reads 'none' <br> *edge* | `finding.tags.length === 0` | `apps/web/src/ui/finding-card.tsx:335` | **nothing here.** Every finding in every bundle carries at least one tag. Empty findings[0].tags in a copy of flask.json. |
| A 'severity-capped' tag, the trace of a rule that asked for more than its evidence allowed <br> *edge* | `capSeverity lowered the proposed severity` | `packages/findings/src/engine.ts:147, packages/domain/src/severity.ts:61` | **nothing here.** No finding in the corpus was capped. The card shows the tag but never the metadata.severityCapReason that explains it, which is a gap worth designing. |
| A timestamp that does not match the expected shape is printed exactly as stored instead of as 'YYYY-MM-DD HH:MM:SS UTC' <br> *edge* | `!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(finding.createdAt)` | `apps/web/src/format.ts:159` | **nothing here.** Set createdAt to '2026-01-01T00:00:00Z' (no milliseconds) in a copy of flask.json. |
| 'eligible: <reason>' on the last definition row <br> *load bearing* | `finding.goalReadiness.eligible === true` | `apps/web/src/ui/finding-card.tsx:339` | demo-populated (8 of 21), demonstration-system, pydantic-ai |
| No conflict panel <br> *ordinary* | `finding.conflictsWith.length === 0` | `apps/web/src/ui/finding-card.tsx:344` | most findings in every fixture |
| 'This finding conflicts with OSC-REL-0003, and both are kept.' inside a refusal panel <br> *load bearing* | `finding.conflictsWith.length === 1` | `apps/web/src/ui/finding-card.tsx:346` | demo-populated (OSC-REL-0005, OSC-REL-0003), demonstration-system, vercel-ai-chatbot-exercised |
| Two ids joined by a comma while the sentence still says 'and both are kept', which is three findings <br> *load bearing* | `finding.conflictsWith.length >= 2` | `apps/web/src/ui/finding-card.tsx:346` | demo-populated (OSC-REL-0001), demonstration-system (OSC-REL-0001) |

## Findings / expanded card / Classification and actions row

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| 'not eligible: <reason>' while the Create goal button directly below is enabled, because the capability is declared per report and not per finding <br> *load bearing* | `finding.goalReadiness.eligible === false && capabilities.create_goal.available` | `apps/web/src/ui/finding-card.tsx:339 against :182` | demo-populated, demonstration-system, crewai, pydantic-ai |

## Findings / expanded card / actions row

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A single Copy finding button, because the bundle declares no server capability <br> *load bearing* | `bundle.capabilities does not mention create_goal, compare_runs or open_source_location` | `apps/web/src/ui/actions.tsx:31` | **nothing here.** All sixteen bundles declare all nine capabilities. Empty bundle.capabilities in a copy of flask.json to see the minimum card. |
| Copy enabled beside three disabled buttons, each with the server's own reason printed under it <br> *load bearing* | `capabilities declared with available false` | `apps/web/src/ui/actions.tsx:58 and :64` | flask, express, axios, langgraphjs (create_goal also disabled: 'no finding in this report is eligible to become a goal') |
| Copy, Create goal, Compare with baseline and Open source location all enabled, no reason lines <br> *load bearing* | `every declared capability the card uses is available` | `apps/web/src/ui/actions.tsx:59` | demo-populated |
| A button reading 'Create goal…' and disabled while the request is in flight <br> *ordinary* | `busy === true` | `apps/web/src/ui/actions.tsx:58 and :60` | demo-populated served with the local server |
| A result line under the button, plus a second line linking 'Open <goalId> in the goals section' <br> *load bearing* | `the create_goal request resolved ok` | `apps/web/src/ui/actions.tsx:70, apps/web/src/ui/finding-card.tsx:195` | demo-populated served with the local server |
| A result line carrying the server's error text, on an enabled button <br> *load bearing* | `the request resolved not ok, e.g. creating a goal from a finding whose goalReadiness is not eligible` | `apps/web/src/ui/actions.tsx:70, message from packages/goals/src/create.ts:253` | demo-populated served with the local server, on any of its 13 ineligible findings |
| Copy finding reports itself: 'Copied.' or 'The clipboard is not available here. Select the text and copy it manually.' <br> *ordinary* | `after a click, state is 'copied' or 'failed'` | `apps/web/src/ui/actions.tsx:104` | every fixture (the failed branch needs a context with no clipboard, such as a file: page in some browsers) |

## Findings / expanded card, whole body

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The same disabled Open source location button repeated once per source location and once per locatable evidence record, each carrying the same reason paragraph <br> *load bearing* | `open_source_location declared && unavailable && sourceLocations.length + locatable evidence is large` | `apps/web/src/ui/finding-card.tsx:304, apps/web/src/ui/evidence-list.tsx:80` | pydantic-ai, openai-agents-python (10 locations plus 20 evidence records in one card) |

## What a designer needs to know beyond the list

Corpus files live at corpus/.cache/bundles/*.json; demo-populated.json is now present there alongside the fifteen listed in the brief.

The documented 25 ceiling is not on this screen. docs/design/report-system.md:224 says "the findings follow at 25 components", but apps/web/src/ui/finding-card.tsx:101 has no slice and no ceiling notice: the truncation and its explanatory sentence are both produced in the pipeline (packages/findings/src/grouping.ts). Design consequence: a bundle from another producer, or a rule that stops grouping, puts an unbounded button list in the card with nothing saying so. Nothing in the browser states the reading the way the delta bar and the map canvas do.

What no fixture can show you today, in rough order of how much it matters: a critical severity (and its doubled mark); the "Compared with" column carrying an actual value, in every report it reads "not compared" in every row; a suggested experiment with a scenarioId, which is the only thing that renders the "Rerun relevant test" action and the "Scenario X" line; four of the ten evidence kinds (metric, scenario_outcome, dependency, model_interpretation) plus the unrecognised fallback; an evidence excerpt or file digest row; a finding with no evidence (the schema forbids it, the refusal panel exists anyway); an evidence id that does not resolve; a component id the graph does not contain; a card with only the Copy button, because all sixteen bundles declare all nine capabilities. Any of these can be reached by editing one field in one bundle and rendering a standalone page from it.

Three live regions fire on this screen at once: the search status (apps/web/src/ui/filters.tsx:93), the match count sentence (findings.tsx:206) and the shell's announcement channel that every token toggle and every action writes into (ui/filters.tsx:31, ui/actions.tsx:41). A single keystroke in the search box updates two of them.

Both lists always render in the fixed order Risks then Strengths, and both always render: the empty one becomes a refusal panel with a heading counting 0 rather than disappearing. That is a deliberate choice worth keeping visible in any redesign.

The severity deep link is seeded once, in a useState initialiser (findings.tsx:80). Filter state is local to the section and is lost the moment the reader visits another screen and returns, while the URL keeps the finding and severity parameters. A card opened by hand stays open across filter changes, because <details open> is only written when the prop value changes.

Wording that a designer will want to look at: the match sentence never singularises ("1 risks and 0 strengths"); the collapsed row reads "1 evidence"; a two-id conflict panel still says "and both are kept"; the generated occurrence metrics render as "261 occurrence" and "236 component" because a unit is never pluralised; and the grouped-finding sentences use bare numbers while everything else on the page goes through formatInteger.

The search haystack (filters.ts:45) covers id, title, explanation, impact, ruleId, component ids, tags and taxonomy. It does not cover the category, the severity, the recommendation, the evidence, or the component display names the card actually shows, so a reader searching what they can see can miss, and a row can match on text that is nowhere on screen.

Filter chip counts are computed against bundle.findings, never against the current match set, so they are stable but can disagree with what is on screen the moment two groups are combined.

Sorting is severity rank, then confidence, then id (filters.ts:73). Confidence is the tiebreaker for everything, and only four values exist in the corpus, so within one severity the order is effectively by identifier.

