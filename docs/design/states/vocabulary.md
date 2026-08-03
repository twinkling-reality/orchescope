# The shared vocabulary: every state

153 states across 103 blocks. 51 of them are reached by no report in `corpus/.cache/bundles`, so `pnpm states` will not show them to you and the fourth column says what would.

Source: `Cross cutting vocabulary: the ten primitives, the presence marks, the basis and severity descriptors, the formatters, the headline generator and the delta bar builder (apps/web/src/ui/primitives.tsx, ui/presence.tsx, ui/safe-link.tsx, basis.ts, format.ts, headline.ts, delta-bar.ts, styles.css)`.

## Thresholds

| Constant | Value | Where | What it switches | Why that number |
| --- | --- | --- | --- | --- |
| `CELL_LIMIT` | 120 | `apps/web/src/delta-bar.ts:17` | At or below 120 declared components one bar cell is one component and the caption says so. Above it componentsPerCell becomes ceil(declared/120), the cell count drops to about 61 to 120, the filled count becomes a rounded share rather than a count, and the caption changes to name how many components one cell stands for. | Stated in the module comment as a readability limit: openai-agents-python declares 917, and one cell per component at a few pixels each is neither readable nor something to put in a document. The number itself is taste, not arithmetic, unlike the map's 120. |
| `DENSE_ABOVE` | 48 | `apps/web/src/delta-bar.ts:20` | Above 48 total cells (declared cells plus outside cells) the bar gains the `dense` class: the gap between cells closes from 3px to 1px and each cell changes from a 24px basis to flex 1 1 0 with a 2px floor. | The comment argues it directly: 3px of air between 5px of cell is noise. Taste, but with the reasoning stated. |
| `SPELLED length` | 13 entries, zero to twelve | `apps/web/src/headline.ts:18` | A count of 0 to 12 is spelled as a word inside the display sentence and takes the prose voice. A count of 13 or more, or any non integer or negative, becomes a separate mono `.data` segment the caller sets at 0.92em and weight 300. | Stated: a numeral is the honest rendering above twelve because `two hundred and eight` is not a thing a reader can compare against the next report. Twelve is the conventional English cut, undocumented beyond that. |
| `GROUP_SIZE` | 3 | `apps/web/src/format.ts:6` | Below 1000 a number is a plain run of digits. At 1000 and above it gains a plain space every three digits, which widens the string by one character per group. Deliberately locale independent, so no comma or thin space is ever used. | Stated as locale independence, so the same bundle reads the same on every machine and the tests do not depend on an ICU build. |
| `Duration scale steps` | 1 ms, 1000 ms, 60000 ms | `apps/web/src/format.ts:70, 73, 76, 79` | Below 1 ms: three decimals and `ms`. 1 to 999 ms: one decimal and `ms`. 1 s to 59.99 s: two decimals and ` s`. 60 s and above: `N min S.S s`, two units in one string. A whole number short circuits to the integer form at every step, so 0 reads `0 ms` and 1000 reads `1 s`. | Undocumented, taste. The precision falls as the magnitude rises, which is the usual rule, but the integer short circuit inside formatNumber means the decimal count is not actually constant within a step. |
| `Currency decimal switch` | absolute value 1 | `apps/web/src/format.ts:88` | Below one dollar a cost gets four decimals, at or above it two. A whole number gets none at all, because formatNumber returns the integer form before the decimals argument is read. | Undocumented, taste. Four decimals below a dollar is the right call for per call model spend; the whole number case looks unintended. |
| `Byte scale steps` | 1024, five units B KiB MiB GiB TiB | `apps/web/src/format.ts:111, 114` | Below 1024 an integer and ` B` with no decimals. At each further 1024 the unit steps up and the value takes exactly one decimal. Above TiB the unit stops and the number grows without bound. | Binary multiples with the IEC unit names, so the number matches what a file system reports. The unit list ends at TiB because a scan of a repository will not exceed it; nothing enforces that. |
| `formatPercent default decimals` | 1 | `apps/web/src/format.ts:93` | Every percentage on the page carries exactly one decimal place, including 100.0% and 0.0%. A non zero rate below 0.0005 renders as 0.0%, which reads as nothing. | Undocumented, taste. One place is right for an exercise rate in the tens of percent and wrong for the sub percent rates a large repository produces. |
| `formatNumber default decimals` | 2 | `apps/web/src/format.ts:35` | A fractional value gets two places; a whole one gets none. This is the default behind every metric value with an unrecognised unit, every overlay bar value, and every amplification factor. | Undocumented, taste. |
| `formatConfidence decimals` | 2 | `apps/web/src/format.ts:100` | A fractional confidence reads 0.85; a confidence of exactly 1 or 0 reads `1` or `0`, so a confidence column mixes one and four character values. | Undocumented. The mixed width is a consequence of formatNumber's integer short circuit rather than a decision. |
| `MeasureBar clamp` | 0 to 1 | `apps/web/src/ui/primitives.tsx:358` | The share is clamped into the unit interval and written as a percentage with two decimals into the --bar-share custom property. Anything at or below zero draws an empty track; anything at or above one draws a full bar. | Stated indirectly: the bar is a ranking aid and never the only place the number appears, so clamping cannot lose information the reader needs. |
| `buildBarRows scale guard` | max > 0 | `apps/web/src/filters.ts:268` | When the largest value in the set is zero or negative, every share becomes 0 and every bar is empty. When every value is equal and positive, every share becomes 1 and every bar is full. Neither case is said in words beside the bars. | Undocumented. The guard is a division safety check rather than a considered representation choice, which is why the all equal case reads as though everything is at maximum. |
| `SeverityMark mark count` | 2 for critical, 1 for everything else | `apps/web/src/ui/primitives.tsx:143` | critical draws two 7px squares overlapped by a -3px margin; every other rank draws one, and the rank is then carried by fill and height: filled, filled at 3px, hollow, hollow at 4px, hollow circle for unranked. | Stated: two hues cover five severities, so hue alone cannot separate them and is never asked to. All five forms differ in greyscale and more ink means worse. |
| `Navigation count omission` | count > 0 | `apps/web/src/ui/shell.tsx:139` | A section count appears beside its name only above zero. At zero the number is omitted entirely rather than shown as 0. | Stated: a navigation of zeros reads as chrome while the screen itself refuses in a sentence that says considerably more than a nought would. |

## Eyebrow, non heading form. Used by app.tsx loading and failure pages, shell.tsx provenance, goals card, comparison card, scenario card, chaos run card, benchmark card

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Eyebrow as a paragraph, outside the heading outline <br> *load bearing* | `props.level === undefined` | `apps/web/src/ui/primitives.tsx:55` | every fixture (shell provenance); demo-populated (goal, comparison, benchmark, chaos cards); demonstration-system (scenario card) |

## Eyebrow as a block heading. Every section's top level blocks

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Eyebrow as h3, the level a screen reader navigates blocks by <br> *load bearing* | `props.level === 3` | `apps/web/src/ui/primitives.tsx:41` | every fixture |

## Eyebrow as a group heading inside a block. Overview coverage, goals, comparisons, resilience, component details, finding card, evaluators

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Eyebrow as h4, a group inside a block <br> *ordinary* | `props.level === 4` | `apps/web/src/ui/primitives.tsx:48` | demo-populated, demonstration-system, crewai (unsupported inputs group) |

## Eyebrow, everywhere it names a block that is not a list

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Eyebrow with no trailing count <br> *load bearing* | `props.count === undefined` | `apps/web/src/ui/primitives.tsx:38` | every fixture |

## Eyebrow above any list: findings, overlay bars, runs, relations, evidence, acceptance criteria

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Eyebrow with a count in --muted after the label <br> *load bearing* | `props.count !== undefined && props.count > 0` | `apps/web/src/ui/primitives.tsx:38, styles.css:309` | flask, express, axios (findings 1); demo-populated (findings 21, overlay bars 15); pydantic-ai-exercised (relations 839) |

## Findings, a group heading over an empty group

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Eyebrow showing a literal zero beside the label <br> *ordinary* | `props.count === 0, passed explicitly when a finding group is empty, and implicitly wherever a `.length` is zero` | `apps/web/src/sections/findings.tsx:40` | flask, express, axios, langgraph, pydantic-ai (no strengths, so the strengths group renders count 0) |

## Eyebrow above a large list: component details relations, map table, goals evidence

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A four digit count in an eyebrow, unlike every other number on the page, is not digit grouped <br> *edge* | `props.count >= 1000. The count is rendered with String(props.count), not formatInteger, so 1953 reads `1953` where the same number elsewhere reads `1 953`` | `apps/web/src/ui/primitives.tsx:38` | pydantic-ai-exercised (839 relations is three digits; the component details incoming/outgoing counts and goals lists stay below 1000 in every fixture) |

## Goals, the head of a goal card

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| An eyebrow carrying a value rather than the kind of block, set in all caps <br> *edge* | `Goals screen renders <Eyebrow>{goal.id}</Eyebrow>, so an identifier is uppercased by the stylesheet` | `apps/web/src/sections/goals.tsx:80` | demo-populated (2 goals) |

## Eyebrow, any

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The id prop that would let an eyebrow label a region is never passed <br> *edge* | `props.id === undefined at every one of the 77 call sites` | `apps/web/src/ui/primitives.tsx:34` | every fixture |

## Overview, the delta headline

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Display sentence with no numeral in it <br> *load bearing* | `Every segment of deltaHeadline() has kind 'text', which happens when the governing count is 0..12 or when the sentence takes one of the two count free forms` | `apps/web/src/ui/primitives.tsx:68, headline.ts:60` | demo-populated (`Seven of the things this repository declares have never run.`) |
| Display sentence broken by a mono numeral in a .data span <br> *load bearing* | `spellCount(count) === null, i.e. the governing count is >= 13, not an integer, or negative` | `apps/web/src/ui/primitives.tsx:70, styles.css:367` | pydantic-ai-exercised (953), vercel-ai-chatbot-exercised (16) |
| `Everything this repository declares ran, and nothing ran that it does not declare.` <br> *load bearing* | `declared > 0 && neverExercised === 0 && exercisedNotDeclared === 0` | `apps/web/src/headline.ts:86` | **nothing here.** Empty reconciliation.declaredNotExercised.components and reconciliation.exercisedNotDeclared.components in demo-populated.json |
| `Everything this repository declares ran, and so did N things it does not declare.` with a lower case spelled count mid sentence <br> *ordinary* | `declared > 0 && neverExercised === 0 && exercisedNotDeclared > 0` | `apps/web/src/headline.ts:90` | **nothing here.** Empty reconciliation.declaredNotExercised.components in demo-populated.json, leaving its one exercisedNotDeclared component |
| `One of the things this repository declares has never run.` singular verb <br> *ordinary* | `declared > 0 && neverExercised === 1` | `apps/web/src/headline.ts:100` | **nothing here.** Trim reconciliation.declaredNotExercised.components in demo-populated.json to one entry |
| `... of the things this repository declares have never run.` plural verb <br> *load bearing* | `declared > 0 && neverExercised > 1` | `apps/web/src/headline.ts:100` | demo-populated (7), vercel-ai-chatbot-exercised (16), pydantic-ai-exercised (953) |
| A spelled count opening the sentence is capitalised <br> *ordinary* | `position === 'opens' && 0 <= count <= 12` | `apps/web/src/headline.ts:60` | demo-populated (`Seven`) |
| A numeral inside the 34px display line, one weight step heavier and 0.92em <br> *ordinary* | `A Data span is a descendant of .display, which happens only for a headline count segment` | `apps/web/src/styles.css:367` | pydantic-ai-exercised, vercel-ai-chatbot-exercised |

## Overview, the delta headline (module state only)

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| `This repository declares nothing for a run to exercise.` <br> *edge* | `declared === 0 && exercisedNotDeclared === 0` | `apps/web/src/headline.ts:72` | **nothing here.** Call deltaHeadline directly, or remove the guard at sections/overview.tsx:285 and render orchescope-discovery with a reconciliation block attached |
| `N things ran, and this repository declares none of them.` <br> *edge* | `declared === 0 && exercisedNotDeclared > 0` | `apps/web/src/headline.ts:74` | **nothing here.** Same as above; set reconciliation.coverage.declaredComponents to 0 on demo-populated while keeping exercisedNotDeclared.components non empty |
| The word `zero` reaching a sentence <br> *edge* | `spellCount(0) === 'zero'; only the declared === 0 branches can pass zero, and both are guarded` | `apps/web/src/headline.ts:19` | **nothing here.** Unreachable through deltaHeadline as written; spellCount(0) is only observable from the module |

## Overview, the delta figure

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The 56px exercise rate with its mono qualifier <br> *load bearing* | `reconciliation.coverage.componentExerciseRate !== undefined` | `apps/web/src/sections/overview.tsx:320, primitives.tsx:96` | demo-populated (68.2%), vercel-ai-chatbot-exercised (15.8%), pydantic-ai-exercised (0.3%) |
| `no rate` in --faint where the percentage would be, because a rate with no runs behind it is not zero percent <br> *load bearing* | `reconciliation.coverage.componentExerciseRate === undefined` | `apps/web/src/sections/overview.tsx:327, styles.css:342` | **nothing here.** Delete coverage.componentExerciseRate from demo-populated.json's reconciliation block |
| A non zero rate that reads `0.0%`, which a reader takes as nothing <br> *ordinary* | `0 < fraction < 0.0005` | `apps/web/src/format.ts:97` | **nothing here.** Set reconciliation.coverage.componentExerciseRate to 0.0002 in pydantic-ai-exercised.json |

## Overview, the delta figure qualifier

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| `... exercised · 1 run` <br> *ordinary* | `bundle.summary.runCount === 1` | `apps/web/src/sections/overview.tsx:329` | pydantic-ai-exercised, vercel-ai-chatbot-exercised |
| `... exercised · 10 runs` <br> *ordinary* | `bundle.summary.runCount !== 1, including 0` | `apps/web/src/sections/overview.tsx:329` | demo-populated (10 runs) |
| The qualifier wraps below the figure <br> *edge* | `The qualifier string is long enough for .readout's flex-wrap to break it, e.g. `3 of 1 953 exercised · 1 run` in a narrow main column` | `apps/web/src/styles.css:325` | pydantic-ai-exercised |

## Data, every number on every screen

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A number in mono, tabular figures <br> *load bearing* | `default` | `apps/web/src/ui/primitives.tsx:111, styles.css:355` | every fixture |

## Overview top risks and the finding card, the confidence value

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A number carrying a tooltip that explains its scale <br> *ordinary* | `props.title !== undefined; passed at exactly two call sites, both `Confidence in this claim, from 0 to 1.`` | `apps/web/src/ui/finding-card.tsx:272, sections/overview.tsx:427` | flask, express, axios, demonstration-system, demo-populated, every fixture with at least one finding |

## Data, nowhere

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The --faint `nil` form of Data exists in the component and the stylesheet and is passed by no call site <br> *edge* | `props.nil === true, never true in the workspace` | `apps/web/src/ui/primitives.tsx:111, styles.css:361` | **nothing here.** No bundle reaches it. Only Figure and RuledStat pass nil today |

## BasisChip, and the RuledStat chip. Findings, evidence records, component details, overlay meta, goals

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| `OBSERVED`, title `Seen in a runtime trace of the system actually executing.` <br> *load bearing* | `basis === 'observed'` | `apps/web/src/basis.ts:37` | demo-populated, pydantic-ai-exercised, vercel-ai-chatbot-exercised |

## BasisChip. Every screen that shows a component or a static finding

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| `DISCOVERED`, title `Read from source code or configuration, not executed.` <br> *load bearing* | `basis === 'discovered'` | `apps/web/src/basis.ts:43` | every fixture; 30 555 occurrences across the corpus, the overwhelming default |

## BasisChip and the RuledStat chip. Overview relations-never-exercised stat, derived findings

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| `INFERRED`, title `Derived from other evidence by a deterministic rule.` <br> *load bearing* | `basis === 'inferred'` | `apps/web/src/basis.ts:49` | every fixture with a finding: flask, express, axios, demonstration-system, demo-populated, langgraphjs, crewai and the rest |

## BasisChip, on whichever single claim carries it

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| `ESTIMATED`, title `Computed from a model of the system rather than measured.` <br> *edge* | `basis === 'estimated'` | `apps/web/src/basis.ts:55` | demo-populated, and exactly once in the whole corpus |

## BasisChip. Resilience outcomes and the resilience overlay on Performance and the map

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| `SIMULATED`, title `Produced while faults were injected, so it is not steady state behaviour.` <br> *ordinary* | `basis === 'simulated'` | `apps/web/src/basis.ts:61` | demo-populated only (33 occurrences, all from its one chaos run) |

## BasisChip, anywhere a model produced claim would appear

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| `MODEL INTERPRETED`, the longest chip label, title `Proposed by a language model and checked against the supplied evidence.` <br> *load bearing* | `basis === 'model_interpreted'` | `apps/web/src/basis.ts:67` | **nothing here.** Set the basis of one finding in demo-populated.json to `model_interpreted`. It is the only label that will wrap or overflow a table cell, so it needs looking at |

## BasisChip, any

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| `UNKNOWN BASIS`, title `This report used an evidence class this page does not recognise.` <br> *ordinary* | `describeBasis receives a string outside the six, which is what a bundle written by a newer build produces` | `apps/web/src/basis.ts:75, 83` | **nothing here.** Set a finding's basis to any unrecognised string in any bundle |

## BasisChip proper (findings, evidence, component details, goals)

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The chip carries a visually hidden ` evidence class: <meaning>` after the label <br> *ordinary* | `always, in BasisChip` | `apps/web/src/ui/primitives.tsx:128` | every fixture |

## Overview, the ruled stat rows

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The same looking chip under a RuledStat has no hidden meaning and no screen reader text at all, only a title attribute <br> *ordinary* | `always, in RuledStat, which builds its own span rather than using BasisChip` | `apps/web/src/ui/primitives.tsx:240` | every fixture (the Overview coverage row is always drawn) |

## SeverityMark. Findings list, overview top risks, component details, the overview severity legend

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Two overlapping filled 7px squares in --high, label `CRITICAL` <br> *load bearing* | `finding.severity === 'critical'` | `apps/web/src/basis.ts:120, primitives.tsx:143` | **nothing here.** Change one finding's severity to `critical` in demo-populated.json. It is the only mark that draws two elements and the only one with a negative margin, so it has never been seen |

## SeverityMark, everywhere a finding appears

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| One filled square in --high, label `HIGH` <br> *load bearing* | `finding.severity === 'high'` | `apps/web/src/basis.ts:121` | demo-populated (3), demonstration-system (1), vercel-ai-chatbot-exercised, pydantic-ai-exercised |
| One filled 3px half height bar in --medium, label `MEDIUM` <br> *load bearing* | `finding.severity === 'medium'` | `apps/web/src/basis.ts:122, styles.css:425` | demo-populated (6), demonstration-system (3), flask, express, axios |
| One hollow square in --faint, label `LOW` <br> *load bearing* | `finding.severity === 'low'` | `apps/web/src/basis.ts:123, styles.css:431` | demo-populated (10), demonstration-system, langgraphjs |

## SeverityMark, mostly on strengths

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| One hollow 4px half height bar in --faint, label `INFO` <br> *ordinary* | `finding.severity === 'info'` | `apps/web/src/basis.ts:124, styles.css:436` | demo-populated (2 strengths), demonstration-system (2 strengths), crewai, vercel-ai-chatbot |

## SeverityMark, any

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A hollow circle in --faint and the bundle's own severity string as the label, uppercased by the stylesheet <br> *ordinary* | `describeSeverity receives a string outside the five. The label is untrusted bundle text set in all caps at 10px` | `apps/web/src/basis.ts:135, styles.css:440` | **nothing here.** Set a finding's severity to any unrecognised string in any bundle. Worth doing with a long string, because .sev sets white-space: nowrap |

## Overview, `Severity in this report`

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The legend lists only severities with a non zero count, in critical to info order <br> *ordinary* | `SEVERITY_ORDER filtered by summary.findingCountBySeverity[severity] > 0` | `apps/web/src/sections/overview.tsx:658` | demo-populated shows High 3, Medium 6, Low 10 and omits Critical and Info |

## Overview, `How to read this`

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The whole severity group disappears, leaving only the evidence key <br> *ordinary* | `every summary.findingCountBySeverity value is 0, which includes a report whose only findings are strengths, because the summary counts risks only` | `apps/web/src/sections/overview.tsx:683` | orchescope-discovery (no findings at all) |

## Overview, the declaration bar

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| One cell per declared component, caption `Each cell is one declared component.` <br> *load bearing* | `reconciliation.coverage.declaredComponents <= 120` | `apps/web/src/delta-bar.ts:63, 76` | demo-populated (22 cells), vercel-ai-chatbot-exercised (19 cells) |
| A fixed bar of about 120 cells carrying a proportion, caption naming how many components one cell stands for <br> *load bearing* | `reconciliation.coverage.declaredComponents > 120` | `apps/web/src/delta-bar.ts:78` | pydantic-ai-exercised (956 declared, 8 components per cell, 120 cells) |
| Every declared cell hollow while the accessible name and the figure both say a run reached three components <br> *load bearing* | `Math.round((exercised / declared) * declaredCells) === 0 with exercised > 0, i.e. exercised/declared < 1/240` | `apps/web/src/delta-bar.ts:67` | pydantic-ai-exercised (3 of 956 exercised draws 0 filled cells of 120) |
| The bar halves in length as the repository grows by one component <br> *ordinary* | `declared === 120 draws 120 cells; declared === 121 sets componentsPerCell to 2 and draws 61. The cell count then oscillates between about 61 and 120 forever as declared grows` | `apps/web/src/delta-bar.ts:63` | **nothing here.** Set reconciliation.coverage.declaredComponents to 120 and then 121 in any bundle carrying a reconciliation |
| The 3px gaps between cells close to 1px and cells become flexible rather than 24px wide <br> *load bearing* | `cells.length + outside > 48` | `apps/web/src/delta-bar.ts:88, styles.css:460` | pydantic-ai-exercised (121 cells) |
| A dense bar that is still one cell per component, so the picture is literal but each cell is 2px <br> *ordinary* | `48 < declared + outside <= 120` | `apps/web/src/delta-bar.ts:88` | **nothing here.** Set reconciliation.coverage.declaredComponents to 60 in demo-populated.json, with exercisedComponents at 40 |
| No dashed boundary, no Declared/Outside caption, and the lede ends `Nothing ran that this repository does not declare.` <br> *load bearing* | `reconciliation.exercisedNotDeclared.components.length === 0` | `apps/web/src/ui/primitives.tsx:179, 184, delta-bar.ts:81` | **nothing here.** Empty reconciliation.exercisedNotDeclared.components in demo-populated.json |
| A dashed boundary, filled cells past it, and a two word caption row under the bar <br> *load bearing* | `reconciliation.exercisedNotDeclared.components.length > 0` | `apps/web/src/ui/primitives.tsx:179` | demo-populated (1), vercel-ai-chatbot-exercised (2), pydantic-ai-exercised (1) |
| One undeclared component in 956 still draws one whole cell past the boundary, so the outside side is over represented by a factor of 8 <br> *load bearing* | `undeclared > 0 && Math.round(undeclared / componentsPerCell) === 0, forced up to 1` | `apps/web/src/delta-bar.ts:47` | pydantic-ai-exercised |
| Every declared cell filled, no hollow cells at all <br> *ordinary* | `coverage.exercisedComponents >= coverage.declaredComponents` | `apps/web/src/delta-bar.ts:60` | **nothing here.** Set exercisedComponents equal to declaredComponents in demo-populated.json |

## Overview, the declaration bar (unreachable through the screen)

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| An empty bar, or a bar that is nothing but a boundary and outside cells <br> *edge* | `declared === 0` | `apps/web/src/delta-bar.ts:71` | **nothing here.** Call buildDeltaBar with declared 0, or remove the guard and give orchescope-discovery a reconciliation block |

## Overview, the declaration bar accessible name

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| `1 of 1 declared component was exercised. 1 component ran that was never declared` <br> *ordinary* | `declared === 1 and/or undeclared === 1` | `apps/web/src/delta-bar.ts:83, 91` | demo-populated, pydantic-ai-exercised and vercel-ai-chatbot-exercised all use the singular for the undeclared clause when the count is 1 |

## BarCell, the declaration bar and the evidence key on Overview

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A solid --ink cell <br> *load bearing* | `filled === true` | `apps/web/src/ui/primitives.tsx:159, styles.css:469` | demo-populated, vercel-ai-chatbot-exercised |
| A 1px --outline cell with a transparent centre <br> *load bearing* | `filled === false` | `apps/web/src/ui/primitives.tsx:159, styles.css:473` | demo-populated, vercel-ai-chatbot-exercised, pydantic-ai-exercised |

## Overview, the key under the declaration bar

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Two key rows: exercised, and declared but never exercised <br> *ordinary* | `reconciliation.exercisedNotDeclared.components.length === 0` | `apps/web/src/ui/primitives.tsx:211` | **nothing here.** Empty reconciliation.exercisedNotDeclared.components in demo-populated.json |
| Three key rows, the first and third carrying an identical filled swatch <br> *load bearing* | `reconciliation.exercisedNotDeclared.components.length > 0` | `apps/web/src/ui/primitives.tsx:211` | demo-populated, vercel-ai-chatbot-exercised, pydantic-ai-exercised |
| A key row reading `Exercised (0)` or `Declared, never exercised (0)` <br> *edge* | `coverage.exercisedComponents === 0, or declaredNotExercised.components.length === 0 while an undeclared component exists` | `apps/web/src/ui/primitives.tsx:205, 209` | **nothing here.** Set exercisedComponents to 0 in vercel-ai-chatbot-exercised.json |

## RuledStat. Overview, the delta stat row and the coverage stat row

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A 22px mono value, a label, and a basis word under a rule <br> *load bearing* | `props.nil is absent or false` | `apps/web/src/ui/primitives.tsx:238` | every fixture (the coverage row is unconditional) |

## Overview, the delta stat row and the coverage stat row

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The value drops to --faint because the count is zero <br> *load bearing* | `the call site passes nil={x.length === 0}: relations never exercised, relations never declared, contradictions, repeated side effects, files skipped` | `apps/web/src/ui/primitives.tsx:238, sections/overview.tsx:343` | demo-populated (contradictions 0), pydantic-ai-exercised (repeated side effects 0), anthropic-quickstarts, axios, express, flask, demo-populated (files skipped 0) |

## Overview, the coverage stat row

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The word `unknown` in the 22px mono slot where a duration or a byte count should be <br> *edge* | `graph.coverage.durationMs or bytesParsed is not finite, which the formatters answer with UNKNOWN rather than a number` | `apps/web/src/format.ts:12, 68` | **nothing here.** Set graph.coverage.durationMs to null in any bundle |

## Overview, both stat rows

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Four ruled stats side by side, each divided by a --rule-soft left border <br> *load bearing* | `always: both StatRow call sites pass exactly four RuledStats` | `apps/web/src/sections/overview.tsx:338, 530, styles.css:533` | every fixture |
| The auto-fit grid drops to two or one column and the .stat + .stat left border lands at the start of a wrapped row rather than between two stats <br> *ordinary* | `the main column is narrower than 4 x 150px, which happens on the narrow layout and in the standalone export at tablet width` | `apps/web/src/styles.css:533, 543` | every fixture at a narrow width |

## DisclosureRow. Overview reference and coverage disclosures, goals scope row

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A single column look-it-up row, 12.5px --muted title, chevron pointing right <br> *load bearing* | `props.lead === undefined && props.meta === undefined && open is false` | `apps/web/src/ui/primitives.tsx:270, styles.css:604` | every fixture (`How the delta was computed`, `What each evidence class means`) |

## Overview reference, goals scope row

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The same row with the title in --ink and the chevron rotated 90 degrees <br> *load bearing* | `the reader opens it, or props.open is true` | `apps/web/src/styles.css:619, 644` | demo-populated (goals scope row opens when the goal is the highlighted one) |

## Overview top risks, Findings finding cards

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| An 84px lead column carrying a severity mark, the title, and a right aligned meta column <br> *load bearing* | `props.lead !== undefined \|\| props.meta !== undefined` | `apps/web/src/ui/primitives.tsx:272, styles.css:579` | every fixture with a finding: flask, express, axios, demonstration-system, demo-populated and the rest |

## Overview top risks, and Overview next steps

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A row that arrives already expanded <br> *load bearing* | `open={index === 0} for the worst risk, and open={true} for every next action` | `apps/web/src/sections/overview.tsx:418, 502` | demo-populated, demonstration-system, flask, express, axios |

## Overview, the contradictions, side effects, skipped files, adapters, languages and capabilities disclosures

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A small --faint count after the title, inside the summary <br> *ordinary* | `props.count !== undefined` | `apps/web/src/ui/primitives.tsx:277, styles.css:623` | crewai (skipped 7, unsupported 1), pydantic-ai (skipped 34), every fixture (adapters 11) |

## Overview, contradictions and repeated side effects

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A disclosure headed with a zero count <br> *ordinary* | `delta.contradictions.length === 0 or delta.duplicateSideEffects.length === 0, and the block is rendered anyway` | `apps/web/src/sections/overview.tsx:167, 212` | demo-populated (contradictions 0), pydantic-ai-exercised (both 0) |

## DisclosureRow, any

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A three column row with an empty right column, or with an empty 84px left column <br> *edge* | `exactly one of props.lead and props.meta is defined` | `apps/web/src/ui/primitives.tsx:270` | **nothing here.** Only reachable by a new call site; no bundle edit produces it |

## RefusalPanel. Findings, an empty finding group with no filter applied

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A bordered panel with one 13.5px sentence and nothing else <br> *load bearing* | `props.children is null and props.commands is undefined` | `apps/web/src/ui/primitives.tsx:302, sections/findings.tsx:43` | flask, express, axios, langgraph, openai-agents-js, pydantic-ai, anthropic-quickstarts (no strengths, so the strengths group refuses with a title only) |

## RefusalPanel, every screen

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A title and one or more --muted paragraphs, no command <br> *load bearing* | `props.children present, props.commands undefined` | `apps/web/src/ui/primitives.tsx:304` | demo-populated (`This overlay carries no values` is guarded, but the Findings filter-matched-nothing and the evidence-with-no-references panels take this shape), every fixture without a run on Performance |

## RefusalPanel. Map with no components, Comparisons, Goals, Resilience, Performance, Findings

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A title, a body, and one command block in a mono pre <br> *load bearing* | `props.commands has length 1` | `apps/web/src/ui/primitives.tsx:305` | orchescope-discovery (map refusal, `init --manifest`), every fixture without a chaos run, benchmark, comparison or goal |

## Overview, `This repository declares nothing`

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Two stacked command blocks <br> *ordinary* | `props.commands has length 2` | `apps/web/src/sections/overview.tsx:291` | **nothing here.** Attach a reconciliation with coverage.declaredComponents 0 to orchescope-discovery.json |

## Overview, the no run refusal

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Three stacked command blocks, the tallest refusal in the system <br> *load bearing* | `bundle.reconciliation === undefined` | `apps/web/src/sections/overview.tsx:269` | 13 of the 16 fixtures: flask, express, axios, demonstration-system, vercel-ai-chatbot, anthropic-quickstarts, langgraphjs, openai-agents-js, langgraph, crewai, openai-agents-python, pydantic-ai, orchescope-discovery |

## Overview incomplete input, app.tsx failure page

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A refusal whose body is a bulleted plain list of problems, one per failed adapter or per load attempt <br> *ordinary* | `failedAdapters(bundle).length > 0, or neither bundle source produced a document` | `apps/web/src/sections/overview.tsx:57, app.tsx:113` | pydantic-ai-exercised and vercel-ai-chatbot-exercised report 10 adapters where the others report 11, so an adapter failure list is close; no fixture carries a failed adapter record |

## CommandBlock and RefusalPanel commands, every screen

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| An argv element wrapped in single quotes because it contains a space or a shell character <br> *ordinary* | `quoteArg finds a character outside [A-Za-z0-9_@%+=:,./-]` | `apps/web/src/format.ts:179` | demonstration-system and demo-populated scenario targets (`scenarioRows` renders the scenario command) |

## CommandBlock, a scenario target command

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| An empty argv element renders as a bare pair of quotes <br> *edge* | `an argv element is the empty string` | `apps/web/src/format.ts:179` | **nothing here.** Add an empty string to a scenario's target.command in demonstration-system.json |

## Overview next steps

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A command block introduced by a small label line <br> *edge* | `props.label !== undefined` | `apps/web/src/ui/primitives.tsx:319` | **nothing here.** No bundle reaches it; the labelled form is only reachable from a new call site |

## Meta. Finding card scenario line, map census

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| One mono word with no leading middle dot <br> *ordinary* | `exactly one element child survives its conditionals` | `apps/web/src/ui/finding-card.tsx:155, styles.css:265` | demo-populated (a chaos backed finding shows `Scenario ...` alone) |

## Meta. Component details, finding card, goals, comparisons, scenarios, performance overlays

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Mono words separated by --rule middle dots, wrapping at the measure <br> *load bearing* | `two or more element children` | `apps/web/src/ui/primitives.tsx:327, styles.css:265` | every fixture (component details always renders kind, basis, confidence, id) |

## Component details, the component head and every edge row

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A BasisChip sitting inside a middle dot separated meta line, at 9.5px against the line's 10.5px <br> *ordinary* | `always, for a component or an edge` | `apps/web/src/ui/component-details.tsx:87, 329` | every fixture with at least one component |

## Comparisons card, component details edge row, Performance overlay meta

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A meta line loses one of its words and the dot count drops with it <br> *ordinary* | `comparison.goalId === undefined, edge.runtimeOnly === false, or scale.unit === null` | `apps/web/src/sections/comparisons.tsx:189, ui/component-details.tsx:88, sections/performance.tsx:225` | demo-populated (the architecture and resilience overlays have no unit; the runtime overlays do) |

## DefinitionList. Component details, comparisons, resilience, scenarios, performance, goals, finding card, evidence records

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A label and value grid, values in prose <br> *load bearing* | `props.rows.length > 0 && row.code !== true` | `apps/web/src/ui/primitives.tsx:341` | every fixture |

## Component details configuration, scenario identifier and command

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The value set in mono <br> *ordinary* | `row.code === true` | `apps/web/src/ui/primitives.tsx:345` | demonstration-system, demo-populated (scenario rows), every fixture with component details |

## DefinitionList, nowhere today

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| `Nothing recorded.` in small --muted text instead of a list <br> *edge* | `props.rows.length === 0` | `apps/web/src/ui/primitives.tsx:337` | **nothing here.** Unreachable from any bundle. Reaching it means removing the guard at ui/component-details.tsx:139 |

## MeasureBar. Performance overlay bars

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A fully filled 6px --ink bar <br> *load bearing* | `row.value === max, so share === 1` | `apps/web/src/ui/primitives.tsx:358, filters.ts:268` | demo-populated (the top row of every overlay bar list) |

## Performance overlay bars

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| An empty --rule-soft track with no fill at all, beside a value of 0 <br> *load bearing* | `row.value === 0 while max > 0` | `apps/web/src/ui/primitives.tsx:359` | demo-populated (the tokens overlay holds 0 and 14055; errors and retries hold 0 and 3) |
| Every bar in the list drawn full width, so the bar column carries no information at all <br> *load bearing* | `every value in the overlay is the same non zero number, so every share is 1` | `apps/web/src/filters.ts:268` | demo-populated (the permissions overlay is five values of 1; scenario_coverage is fifteen values of 10) |
| Every bar empty, because the guard is max > 0 rather than max !== min <br> *ordinary* | `every finite value in the overlay is 0 or negative, so max === 0 and every share is 0` | `apps/web/src/filters.ts:268` | **nothing here.** Set every value in demo-populated's errors overlay to 0 |
| A negative measurement draws an empty bar, indistinguishable from a measurement of zero <br> *edge* | `row.value < 0 while max > 0, clamped by Math.max(0, ...)` | `apps/web/src/ui/primitives.tsx:358` | **nothing here.** Set one value in demo-populated's latency overlay to a negative number |
| The bar list is windowed and reports how many rows are off screen <br> *ordinary* | `rows.length is large enough for VirtualList to window it` | `apps/web/src/sections/performance.tsx:229` | pydantic-ai-exercised (the architecture overlay carries 1953 values) |

## OptionalNumber. Performance distributions and the component metrics table, Resilience outcomes, component details metrics

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A mono number <br> *load bearing* | `the value is a finite number` | `apps/web/src/ui/primitives.tsx:382` | demo-populated, pydantic-ai-exercised, vercel-ai-chatbot-exercised |

## OptionalNumber, everywhere it is used

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| `not measured` in --muted, with the title `Not measured. This is not a value of zero.` <br> *load bearing* | `value is null or undefined` | `apps/web/src/ui/primitives.tsx:375` | demo-populated, pydantic-ai-exercised, vercel-ai-chatbot-exercised. Every one of the 150 component metric records in demo-populated leaves costUsd undefined, so the whole Cost column of the Performance table reads `not measured` |
| The same `not measured` word, this time standing for a NaN or an infinity that came out of a division <br> *edge* | `!Number.isFinite(value)` | `apps/web/src/ui/primitives.tsx:375` | **nothing here.** Set a componentMetrics record's p95DurationMs to a string that parses to NaN, or divide by a zero sample size upstream |

## Performance, the distribution table

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| `withheld` in --muted where a quantile would be, with a title naming the sample size and the sample size the quantile needed <br> *load bearing* | `distribution.withheld contains an entry for that quantile` | `apps/web/src/sections/performance.tsx:48` | demo-populated (its benchmark distributions withhold quantiles for small samples) |

## State. Overview capabilities table

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| `yes` or `no` as a bare word <br> *load bearing* | `trueLabel and falseLabel are both absent` | `apps/web/src/ui/primitives.tsx:391, sections/overview.tsx:737` | demo-populated (7 available capabilities read `yes`, 2 read `no`) |

## State. Comparisons acceptance, Performance run success, Overview duplicate side effects

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A domain word pair instead of yes/no: satisfied / not satisfied, succeeded / failed, present / absent <br> *load bearing* | `trueLabel and falseLabel are supplied` | `apps/web/src/sections/comparisons.tsx:215, performance.tsx:308, overview.tsx:242` | demo-populated (one comparison, ten runs, one repeated side effect) |

## PresenceMark. Components table on the map, component details

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A filled 7px square and `EXERCISED`, title `Declared in this repository and reached by at least one ingested run.` <br> *load bearing* | `index.hasRuntimeEvidence && !runtimeOnly.has(id) && !neverExercised.has(id) && component.presence.runtime` | `apps/web/src/ui/presence.tsx:48` | demo-populated (14 components), pydantic-ai-exercised (2), vercel-ai-chatbot-exercised (1) |

## Components table on the map, component details

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A filled square and `RAN, NEVER DECLARED`, title `Observed in a run and not declared anywhere this scan could read.` <br> *load bearing* | `component.presence.runtime && !presence.static && !presence.manifest` | `apps/web/src/ui/presence.tsx:42, graph-index.ts:190` | demo-populated (1), pydantic-ai-exercised (1), vercel-ai-chatbot-exercised (2) |
| A hollow --outline square and `NEVER EXERCISED` <br> *load bearing* | `index.neverExercised.has(id), which is fed from reconciliation.declaredNotExercised when there is one, and otherwise from hasRuntimeEvidence && !presence.runtime` | `apps/web/src/ui/presence.tsx:45, graph-index.ts:193` | pydantic-ai-exercised (1950), vercel-ai-chatbot-exercised (40), demo-populated (18) |
| A dashed --outline square and `NO RUN TO COMPARE`, title `This report carries no run, so whether this component executes is unknown rather than false.` <br> *load bearing* | `bundle.runs.length === 0 && bundle.scenarioRuns.length === 0` | `apps/web/src/ui/presence.tsx:39, styles.css:1462` | 12 fixtures: flask (4), express (5), axios (8), demonstration-system (32), vercel-ai-chatbot (41), anthropic-quickstarts (53), langgraphjs (709), openai-agents-js (768), langgraph (852), crewai (987), openai-agents-python (1390), pydantic-ai (1726) |

## Components table on the map

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| No presence mark is drawn at all because there is no component to mark <br> *ordinary* | `bundle.graph.components.length === 0` | `apps/web/src/sections/map.tsx:91` | orchescope-discovery |

## SafeLink. Component details configuration, wherever a repository supplied url appears

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A real anchor with rel=noreferrer noopener and the resolved address as its title <br> *ordinary* | `safeHref returns a http, https or file address` | `apps/web/src/ui/safe-link.tsx:30` | any fixture whose component details carry a url key |

## Component details configuration

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The address rendered as inert text with the title `This link was not a http, https or file address, so it is shown as text.` <br> *ordinary* | `safeHref returns null, i.e. the scheme is anything else including javascript: and data:` | `apps/web/src/ui/safe-link.tsx:21, styles.css:934` | **nothing here.** Set a component's details.url to `javascript:alert(1)` in demo-populated.json |

## Every number under 1000, on every screen

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A plain run of digits <br> *load bearing* | `Math.abs(Math.round(value)) < 1000` | `apps/web/src/format.ts:26` | every fixture |

## Map component counts, Performance token counts, coverage file counts

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Digits split into threes by a plain space, so the number is one character wider per group <br> *load bearing* | `Math.abs(Math.round(value)) >= 1000` | `apps/web/src/format.ts:14` | pydantic-ai (1 726 components), openai-agents-python (1 390), demo-populated (14 055 tokens), crewai (1 272 files) |

## Comparisons metric deltas

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A leading hyphen before the grouped digits <br> *ordinary* | `Math.round(value) < 0` | `apps/web/src/format.ts:31` | demo-populated (its one comparison carries metric deltas) |
| `-0.00`, a signed zero <br> *edge* | `-0.005 < value < 0 with two decimals` | `apps/web/src/format.ts:46` | **nothing here.** Set a comparison metric delta to -0.001 in demo-populated.json |

## Any formatted number

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The word `unknown` in place of every numeric shape <br> *ordinary* | `!Number.isFinite(value) in formatInteger, formatNumber, formatFixed, formatDuration, formatUsd, formatPercent, formatConfidence or formatBytes` | `apps/web/src/format.ts:12` | **nothing here.** Set graph.coverage.bytesParsed to null in any bundle; treegrid-view already renders the same constant for a component with no relations recorded |

## Resilience amplification factors, comparisons, overlay bar values

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A whole number renders with no decimal point beside neighbours that have two <br> *load bearing* | `Number.isInteger(value) inside formatNumber, so 2 reads `2` in the same column where 2.5 reads `2.50`` | `apps/web/src/format.ts:39` | demo-populated (`2 times the baseline retries` beside a fractional cost amplification) |

## Performance durations, component details self time, scenario timeouts

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Three decimal places and a `ms` suffix <br> *ordinary* | `0 < ms < 1` | `apps/web/src/format.ts:70` | **nothing here.** Set a componentMetrics selfDurationMs to 0.4 in demo-populated.json |

## Performance durations

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| `0 ms`, no decimals, because zero is an integer and takes the integer path inside the sub millisecond branch <br> *ordinary* | `ms === 0` | `apps/web/src/format.ts:71` | demo-populated (its latency overlay holds a zero) |

## Performance, Resilience, component details, Overview scan duration

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| One decimal place and `ms` <br> *load bearing* | `1 <= ms < 1000` | `apps/web/src/format.ts:73` | demo-populated (63 ms scan), vercel-ai-chatbot-exercised (108 ms), every fixture's coverage duration under a second |

## Overview scan duration, scenario timeouts, benchmark durations

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Two decimal places and ` s` <br> *load bearing* | `1000 <= ms < 60000` | `apps/web/src/format.ts:76` | flask (1.36 s), langgraphjs (1.50 s), crewai (3.59 s), langgraph (3.82 s), pydantic-ai (4.53 s) |

## Scenario timeouts, benchmark and chaos durations

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| `N min S.S s`, two units in one string, the minutes grouped once they pass 999 <br> *ordinary* | `ms >= 60000` | `apps/web/src/format.ts:79` | **nothing here.** Set a scenario's target.timeoutMs to 120000 in demonstration-system.json, or graph.coverage.durationMs to 90000 |

## Any duration

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A negative duration falls through the `ms < 1` test and renders as `-5 ms` rather than as unknown <br> *edge* | `ms < 0` | `apps/web/src/format.ts:70` | **nothing here.** Set a recoveryTimeMs to a negative number in demo-populated's chaos report |

## Performance cost columns, component details cost

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Four decimal places, `USD 0.5000` <br> *load bearing* | `0 < Math.abs(value) < 1 and the value is not an integer` | `apps/web/src/format.ts:88` | **nothing here.** Add costUsd: 0.0042 to a componentMetrics record in demo-populated.json |

## Performance cost columns

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Two decimal places, `USD 12.35` <br> *ordinary* | `Math.abs(value) >= 1 and the value is not an integer` | `apps/web/src/format.ts:88` | **nothing here.** Add costUsd: 12.345 to a componentMetrics record in demo-populated.json |
| `USD 0` and `USD 1`, with no decimal places at all, in a column where every other cell has two or four <br> *load bearing* | `Number.isInteger(value), because formatNumber short circuits before the decimals argument is used` | `apps/web/src/format.ts:39, 89` | **nothing here.** Add costUsd: 0 to a componentMetrics record in demo-populated.json. A zero cost reads `USD 0`, which is the shape most likely to appear first |

## Overview the delta figure, comparisons rates

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Always one decimal place, `68.2%` <br> *load bearing* | `any finite ratio` | `apps/web/src/format.ts:93` | demo-populated (68.2%), vercel-ai-chatbot-exercised (15.8%) |

## Component details meta, finding card meta, components table confidence column

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| `1` and `0` with no decimals, in a column where every other value has two <br> *load bearing* | `Number.isInteger(confidence), which a confidence of exactly 1 satisfies` | `apps/web/src/format.ts:104` | most fixtures record a confidence of 1 on discovered components, so the column mixes `1` and `0.85` |

## Overview, the files parsed stat label

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| An integer and ` B`, no decimals <br> *ordinary* | `value < 1024` | `apps/web/src/format.ts:118` | **nothing here.** Set graph.coverage.bytesParsed to 900 in demo-populated.json |
| One decimal place and a scaled unit, `11.9 MiB` <br> *load bearing* | `value >= 1024` | `apps/web/src/format.ts:118` | demo-populated (102.2 KiB), pydantic-ai (11.9 MiB), crewai (9.7 MiB) |
| The unit stops at TiB and the number keeps growing, so a very large figure reads `1 099 511 627 776.0 TiB` <br> *edge* | `value >= 1024^5` | `apps/web/src/format.ts:114` | **nothing here.** Set graph.coverage.bytesParsed to 1.2e24 in any bundle |

## Finding card metrics, evidence records

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A metric with unit ms or milliseconds is rendered as a duration and the unit is not repeated <br> *ordinary* | `unit.trim().toLowerCase() is 'ms' or 'milliseconds'` | `apps/web/src/format.ts:127` | demo-populated (two metric records carry ms) |
| A metric with unit usd or dollars is rendered as currency <br> *ordinary* | `unit is 'usd' or 'dollars'` | `apps/web/src/format.ts:130` | **nothing here.** Set an evidence metric's unit to `usd` in demo-populated.json |
| A metric with unit ratio or fraction becomes a percentage, so 0.5 reads `50.0%` <br> *ordinary* | `unit is 'ratio' or 'fraction'` | `apps/web/src/format.ts:133` | **nothing here.** Set an evidence metric's unit to `ratio` in demo-populated.json |
| A metric with unit percent or % is treated as already scaled, so 50 reads `50%`, one decimal place fewer than the ratio path <br> *ordinary* | `unit is 'percent' or '%'` | `apps/web/src/format.ts:136` | **nothing here.** Set an evidence metric's unit to `%` in demo-populated.json |
| A metric with unit bytes is scaled to KiB or MiB <br> *edge* | `unit is 'bytes'` | `apps/web/src/format.ts:139` | **nothing here.** Set an evidence metric's unit to `bytes` in demo-populated.json |
| Two decimals and the bundle's own unit string appended verbatim, in whatever case and length the report wrote it <br> *load bearing* | `unit matches none of the known tokens` | `apps/web/src/format.ts:142` | every fixture with a metric evidence record: units seen are occurrence, component, count, tool, tokens, runs |

## Finding card metrics

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A trailing space with nothing after it, because the unit is appended unconditionally <br> *edge* | `unit is the empty string` | `apps/web/src/format.ts:142` | **nothing here.** Set an evidence metric's unit to the empty string in demo-populated.json |

## Everywhere a machine token reaches prose: component kinds, edge kinds, categories, capability names, verdicts, statuses, overlay bases

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| `agent_group` becomes `Agent group` <br> *load bearing* | `the token contains an underscore or a lower case first letter` | `apps/web/src/format.ts:146` | every fixture |

## Same call sites

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| An all whitespace or empty token is returned exactly as it came, so it renders as nothing <br> *edge* | `token.replaceAll('_',' ').trim().length === 0, which includes '_' and '__'` | `apps/web/src/format.ts:149` | **nothing here.** Set a component's kind to `_` in any bundle |
| The raw ISO string, with its T and its Z, because the regex demands exactly three fractional digits and a Z <br> *ordinary* | `the timestamp has no milliseconds, six fractional digits, or an offset instead of Z` | `apps/web/src/format.ts:162` | **nothing here.** Set generatedAt to `2026-07-27T15:59:00Z` in any bundle |
| `src/agent.ts:42-58` <br> *ordinary* | `endLine !== undefined && endLine !== startLine` | `apps/web/src/format.ts:167` | demo-populated, demonstration-system, and every corpus fixture with multi line components |

## Rail provenance stamp, goals, comparisons, resilience, performance, finding card

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| `2026-07-27 15:59:00 UTC` <br> *load bearing* | `the ISO string matches exactly YYYY-MM-DDTHH:MM:SS.mmmZ` | `apps/web/src/format.ts:159` | every fixture |

## Finding card source locations, component details, evidence records

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| `src/agent.ts:42` <br> *load bearing* | `endLine is undefined or equal to startLine` | `apps/web/src/format.ts:169` | every fixture with a finding or a located component |

## The search status line under a filter field, on Findings and the map

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| `1 finding shown` <br> *ordinary* | `count === 1` | `apps/web/src/format.ts:174` | flask, express, axios (one finding each) |

## Same

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| `0 findings shown`, `21 findings shown` <br> *load bearing* | `count !== 1, which includes 0 and any negative` | `apps/web/src/format.ts:174` | demo-populated (21), any fixture with a query that matches nothing (0) |

## Findings and component details, the evidence list

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| `1 evidence records are referenced and absent from this bundle.`, a plural verb with a count of one <br> *ordinary* | `exactly one referenced evidence id is absent from bundle.evidence` | `apps/web/src/ui/evidence-list.tsx:104` | **nothing here.** Delete one evidence record from demo-populated.json while leaving the finding that references it |

## Findings and component details, one row of the evidence list

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A dashed .evidence.missing row naming the identifier that is not in the bundle <br> *ordinary* | `index.evidenceById.get(id) === undefined` | `apps/web/src/ui/evidence-list.tsx:55, styles.css:1251` | **nothing here.** Same edit as above |

## Findings, a finding with no evidence

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A refusal panel reading `This claim carries no evidence references.` <br> *ordinary* | `finding.evidence.length === 0` | `apps/web/src/ui/evidence-list.tsx:91` | **nothing here.** Empty a finding's evidence array in demo-populated.json |

## Every screen that offers a server backed action

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| No control at all, and no explanation, because the capability is not declared <br> *load bearing* | `capabilityState(...).declared === false` | `apps/web/src/ui/actions.tsx:31` | **nothing here.** Remove an entry from the capabilities array in demo-populated.json |
| A disabled button, its title carrying the server's reason, and the reason repeated below it prefixed by a visually hidden `Unavailable: ` <br> *load bearing* | `state.declared && !state.available` | `apps/web/src/ui/actions.tsx:58, 64` | demo-populated (model_interpretation and cost_estimate are declared and unavailable), pydantic-ai-exercised and vercel-ai-chatbot-exercised (six of nine unavailable) |
| An enabled button whose title is the hint <br> *load bearing* | `state.declared && state.available && !busy` | `apps/web/src/ui/actions.tsx:59` | demo-populated (seven of nine) |
| The label gains a trailing ellipsis and the button disables itself while the task runs <br> *ordinary* | `busy === true` | `apps/web/src/ui/actions.tsx:62` | any fixture served by the local report server, while a request is in flight |
| A result line under the button, in the same style whether the outcome succeeded or failed <br> *ordinary* | `outcome !== null. The ok and not ok cases render identically; only the message differs` | `apps/web/src/ui/actions.tsx:70` | any served fixture after a control is pressed |

## What a designer needs to know beyond the list

SCOPE. This is the shared vocabulary, so every state above is inherited by every screen that uses the piece. The usage map, counted by call site: Eyebrow 77 sites across all eight sections plus the shell, the finding card, component details, the graph canvas and the evaluators; Data 32 sites; RefusalPanel 26; DisclosureRow 12; DefinitionList 15; Meta 14; BasisChip 7; SeverityMark 5; RuledStat 8, all on Overview; OptionalNumber 10, on Performance, Resilience and component details; State 4; MeasureBar 1, on Performance; Display, Figure, DeclarationBar, EvidenceKey, StatRow and CommandBlock live only on Overview. Changing Eyebrow, Data or RefusalPanel changes every screen; changing Display, Figure or the declaration bar changes Overview alone.

THE FOUR THINGS I WOULD PUT IN FRONT OF A DESIGNER FIRST.
1. The declaration bar can draw nothing filled while the figure above it says a run reached three components. pydantic-ai-exercised does this today: 3 of 956 exercised rounds to 0 of 120 cells. The module protects the undeclared side from rounding away (delta-bar.ts:47) and does not protect the exercised side (delta-bar.ts:67). The accessible name is correct, the picture is not, and the two contradict each other in the same block.
2. Two of the ten primitives have their most consequential appearance unreachable from any fixture. SeverityMark has never drawn `critical`, its only two element form. BasisChip has never drawn `model_interpreted`, its only two word label, which is the one that will wrap in a table cell or overflow `.meta`'s nowrap.
3. Cost is `not measured` everywhere. All 150 componentMetrics records in demo-populated, and all 3 in each exercised corpus bundle, leave costUsd undefined. So formatUsd has never rendered in a report, and the whole Cost column of the Performance table and the cost rows of component details are a column of the same grey phrase.
4. MeasureBar's degenerate case is live. demo-populated's permissions overlay is five values of 1 and its scenario_coverage overlay is fifteen values of 10, so both draw a column of identical full width bars. Nothing beside them says the set has no spread, unlike the map overlay, which has normaliseValue returning the midpoint for exactly this case (overlay.ts:74).

INCONSISTENCIES INSIDE THE VOCABULARY, worth deciding about rather than inheriting.
- Eyebrow's count is rendered with `String(props.count)`, not `formatInteger`, so a four digit count in an eyebrow is the only ungrouped number in the workspace.
- RuledStat builds its own `.basis` span rather than using BasisChip, so it has the tooltip but none of the visually hidden meaning that BasisChip carries. Two chips that look identical are not equally reachable by a screen reader.
- `Data`'s `nil` prop and its `.data.nil` rule exist and are passed by no call site; `DefinitionList`'s `Nothing recorded.` branch is guarded away at every call site; `CommandBlock`'s `label` prop is never passed; `Eyebrow`'s `id` prop is never passed. Four pieces of the vocabulary are unreachable.
- `formatNumber` short circuits on an integer before the decimals argument is honoured, which leaks into formatUsd (`USD 0` beside `USD 12.35`), formatConfidence (`1` beside `0.85`) and formatDuration (`0 ms` in a column of `1.2 ms`). Every mixed width column in the report traces back to that one line, format.ts:39.
- The evidence list's missing record message is hard plural: one absent record reads `1 evidence records are referenced`. Everything else in the workspace goes through `pluralise` or an explicit ternary.
- The evidence key draws `Exercised` and `Ran, never declared` with the same filled swatch, because both are measured. Correct by the fill rule, ambiguous as a key.
- Goals sets a goal identifier in an Eyebrow, which the design record says an eyebrow is never used for.

WHAT THE FIXTURES CANNOT REACH AT ALL, so nothing above is a substitute for an edited bundle: severity `critical` and any unranked severity; basis `model_interpreted` and any unknown basis; the `unknown` output of every formatter; the minute branch of formatDuration; the sub kibibyte and above tebibyte branches of formatBytes; every branch of formatUsd; the usd, ratio, percent and bytes branches of formatMetricValue; a raw timestamp; a refused SafeLink; a truncated scan (`graph.coverage.truncated` is false in all sixteen); a bar with no undeclared components; a headline for a repository that declares nothing (guarded by the Overview before the module is called) and a headline for a repository where everything ran; a dense bar that is still literal (49 to 120 declared); and an absent capability. A single hand edited copy of demo-populated.json reaches most of them, and it is worth keeping one in the corpus as a deliberately adversarial fixture rather than reaching each one by hand.

CONVENTIONS THE WHOLE VOCABULARY HOLDS, which a redesign has to preserve. Absence is always a word and never a dash, a blank or a zero: `unknown`, `not measured`, `withheld`, `no rate`, `not fixed`, `none`, `no run to compare`. Fill means measured, on the bar cell, the presence mark and the severity mark alike. Hue appears only on `.sev.is-critical`, `.sev.is-high` and `.sev.is-medium` and is always doubled by mark form. Every tooltip in this area is a `title` attribute, which is unreachable on a touch device and unstyleable; BasisChip and the capability action are the only two that also carry a visually hidden text equivalent. Untrusted bundle text reaches all caps in exactly three places: the unranked severity label, `humanise`d kinds inside `.meta`, and the goal identifier in an eyebrow.

