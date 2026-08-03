# The shell and the controls: every state

78 states across 23 blocks. 28 of them are reached by no report in `corpus/.cache/bundles`, so `pnpm states` will not show them to you and the fourth column says what would.

Source: `The shell, the routes, and the controls that appear on every screen`.

## Thresholds

| Constant | Value | Where | What it switches | Why that number |
| --- | --- | --- | --- | --- |
| `MIN_PROGRESS_SHARE` | 0.08 | `apps/web/src/ui/shell.tsx:46` | Below 8% of requests finished the bar still draws an 8% fill, so a request that has just started shows a visible sliver rather than an empty track. Above 8% the fill is the true fraction. | Taste, undocumented. It is the only constant in the shell with no comment justifying it, and it is the one place the page draws more than it measured. |
| `Navigation count floor` | count > 0 | `apps/web/src/ui/shell.tsx:139` | At zero the count element is omitted entirely; at one or more it renders. Overview is pinned to a literal zero so it is never counted. | Documented at shell.tsx:118-123: a navigation of zeros reads as chrome, while the screen itself refuses in a sentence that says considerably more than a nought would. |
| `GROUP_SIZE` | 3 | `apps/web/src/format.ts:6` | A navigation count under 1000 is a bare numeral; at 1000 and above it gains a space every three digits, so `1953` becomes `1 953` and the count grows a glyph wider than its digit count implies. | Locale independent digit grouping, chosen so the same bundle reads the same on every machine and the unit tests do not depend on an ICU build. |
| `Commit abbreviation` | 7 | `apps/web/src/ui/shell.tsx:190` | However many of the schema's permitted 7 to 40 hex characters the bundle stores, the chrome shows the first seven. A commit shorter than seven is impossible; an absent commit slices to the empty string and leaves a double space in the line. | Taste, undocumented. It matches git's own default abbreviation. |
| `SECTIONS.length` | 8 | `apps/web/src/routes.ts:6-15` | Alt with 1 to 8 reaches a section; Alt with 9 or 0 indexes past the end and does nothing. The help panel hard codes the phrase `Alt and 1 to 8`, so a ninth section would be unreachable by shortcut and the panel would be wrong. | The number of screens, restated in prose at shell.tsx:34 rather than derived from SECTIONS.length. |
| `Error body truncation` | 500 | `apps/web/src/client.tsx:78` | A server error body that is not JSON is cut to its first 500 characters and shown verbatim as the action result line under the control. Below 500 it is complete; above it, it stops mid sentence with no ellipsis. | Bounded output, per the repository's prohibition on unbounded output. The cut point itself is undocumented. |
| `--column` | 1200px | `apps/web/src/styles.css:90` | The width the report reads in, centred under the chrome. It was a bare 1000px beside a 216px rail. It decides whether a seven column components table fits without scrolling sideways, which on the widest corpus reports it now does. | Recorded in docs/design/report-system.md: the rail's 216px of width was worth more to the reports than its height was to the chrome. |

## Chrome, identity

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Project name fits the chrome on one line <br> *load bearing* | `bundle.projectName renders under 34ch at 20px/300; every project name in the corpus does, the longest being 21 characters` | `apps/web/src/ui/shell.tsx:206` | every fixture |
| Project name wraps to a second line <br> *edge* | `bundle.projectName exceeds the 34ch cap; `overflow-wrap: anywhere` breaks it mid word only once the identity track itself is squeezed, which needs both a long name and a narrow window` | `apps/web/src/ui/shell.tsx:206 with apps/web/src/styles.css:768` | **nothing here.** Audit a directory whose name is longer than 34 characters, or open any fixture between 880 and 940px with one. |

## Chrome, provenance line

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Revision line: named ref, short commit, the word clean <br> *load bearing* | `graph.provenance.git !== undefined && git.ref !== undefined && git.commit !== undefined && git.dirty === false` | `apps/web/src/ui/shell.tsx:172-175` | flask, express, axios, crewai, langgraph, pydantic-ai (all render `HEAD <7 hex> clean`) |
| Revision line ends in the word dirty <br> *load bearing* | `git.dirty === true` | `apps/web/src/ui/shell.tsx:175` | demonstration-system, orchescope-discovery, demo-populated (`main 51ce695 dirty`) |
| Ref reads HEAD rather than a branch name <br> *ordinary* | `git.ref === 'HEAD', which is what a pinned corpus checkout produces` | `apps/web/src/ui/shell.tsx:175` | every corpus repository except demonstration-system, orchescope-discovery and demo-populated |
| No git revision recorded <br> *load bearing* | `graph.provenance.git === undefined; the third line becomes the sentence `no git revision recorded` instead of three mono tokens` | `apps/web/src/ui/shell.tsx:172-174` | **nothing here.** Delete `graph.provenance.git` from any bundle, e.g. flask.json. The schema marks git optional (packages/schema/src/graph.ts:129), so a scan of a directory that is not a git checkout produces this. |
| Ref missing, so the line reads `unknown ref <sha> clean` <br> *edge* | `git !== undefined && git.ref === undefined` | `apps/web/src/ui/shell.tsx:175` | **nothing here.** Delete `graph.provenance.git.ref` from flask.json. `ref` is individually optional in the schema. |
| Commit missing, so the line carries a hole between the ref and the word <br> *edge* | `git !== undefined && git.commit === undefined; `(git.commit ?? '').slice(0, 7)` yields an empty string and the template still emits both spaces, giving `main dirty`` | `apps/web/src/ui/shell.tsx:175` | **nothing here.** Delete `graph.provenance.git.commit` from demonstration-system.json. `commit` is individually optional in the schema. |
| Generated at, as a UTC date and time <br> *load bearing* | `bundle.generatedAt matches /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, rendered `2026-07-27 19:44:02 UTC`` | `apps/web/src/format.ts:158-164, called from apps/web/src/ui/shell.tsx:180` | every fixture |
| Generated at, as the raw ISO string <br> *edge* | `bundle.generatedAt does not match the millisecond pattern, so formatTimestamp returns the input untouched and the line reads `2026-07-27T19:44:02Z`` | `apps/web/src/format.ts:160-162` | **nothing here.** Change `generatedAt` in any bundle to drop the milliseconds. The page's own validator only checks the string is non empty (apps/web/src/bundle.ts:113), so a bundle from an older writer or a third party tool reaches this. |

## Chrome, navigation

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Eight bare section labels, not one count <br> *load bearing* | `summary.componentCount === 0 && findings.length === 0 && runs.length === 0 && chaosReports.length === 0 && scenarios.length === 0 && comparisons.length === 0 && goals.length === 0` | `apps/web/src/ui/shell.tsx:133 and 154` | orchescope-discovery |
| Only System map and Findings carry a count <br> *load bearing* | `componentCount > 0 && findings.length > 0 and every other section collection is empty` | `apps/web/src/ui/shell.tsx:122-134` | flask, express, axios, anthropic-quickstarts, vercel-ai-chatbot, langgraphjs, langgraph, crewai, openai-agents-js, openai-agents-python, pydantic-ai |
| Scenarios carries a count while Performance does not <br> *ordinary* | `scenarios.length > 0 && runs.length === 0: scenarios were defined and never run, and the navigation cannot tell those apart` | `apps/web/src/ui/shell.tsx:127-128` | demonstration-system |
| Performance carries a count <br> *ordinary* | `runs.length > 0. Note the count is runs only: metrics, benchmarks and overlays never contribute` | `apps/web/src/ui/shell.tsx:126` | vercel-ai-chatbot-exercised, pydantic-ai-exercised (1), demo-populated (10) |
| Every section except Overview carries a count <br> *load bearing* | `all seven counted collections non empty; the maximum the navigation can show` | `apps/web/src/ui/shell.tsx:122-134` | demo-populated |
| Overview is the one section with no count, ever <br> *ordinary* | `counts.overview is the literal 0, so countOf('overview') always returns undefined` | `apps/web/src/ui/shell.tsx:123` | every fixture |
| A count of a thousand or more gains a space separator <br> *edge* | `count >= 1000; formatInteger groups digits in threes with a space, so the navigation reads `1 953` and the count is two glyphs wider than the label implies` | `apps/web/src/format.ts:14-24, called at apps/web/src/ui/shell.tsx:154` | openai-agents-python (1 390), pydantic-ai (1 726), pydantic-ai-exercised (1 953) |
| System map count is every declared component, including the ones the map does not draw <br> *load bearing* | `summary.componentCount > the number of components the layout gives coordinates to` | `apps/web/src/ui/shell.tsx:130 against packages/report/src/layout.ts` | openai-agents-python (the navigation says 1 390, the canvas draws 299), langgraphjs (709 against 578), crewai (987 against 294) |
| The current section is marked <br> *load bearing* | `state.route.section === section.id; the link gains `current`, `aria-current="page"`, ink colour, weight 500 and a left rule` | `apps/web/src/ui/shell.tsx:144-151` | every fixture |

## Chrome navigation and main column

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| An unrecognised fragment lands on Overview with nothing said <br> *ordinary* | `parseHash's path is not one of the eight section ids, so the route falls back to `overview` and Overview is marked current, with no message that the address was not understood` | `apps/web/src/routes.ts:63` | every fixture, by opening `#/nope` |

## Every screen

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A component selected on the map stays selected after navigating away <br> *ordinary* | `route action with no `component` param: `params['component'] ?? state.selected` keeps the previous selection rather than clearing it` | `apps/web/src/store.tsx:50` | any fixture with components, by selecting on the map then clicking Findings |
| A malformed percent escape in the fragment is kept as literal text <br> *edge* | `decodeURIComponent throws on the raw key or value, so the raw text becomes the param and reaches the section as a selection id that matches nothing` | `apps/web/src/routes.ts:37-43` | any fixture, by opening `#/map?component=%E0%A4%A` |

## Page frame, top edge

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| No progress bar <br> *load bearing* | `state.pending === 0` | `apps/web/src/ui/shell.tsx:45-47` | every fixture, at rest |
| One request in flight, singular, and the bar at its 8% floor <br> *load bearing* | `pending === 1 && completed === 0; share is Math.max(0.08, 0/1) so the fill is 8% wide with nothing finished, and the label reads `1 request in flight, 0 of 1 finished.`` | `apps/web/src/ui/shell.tsx:49 and 64` | demo-populated, by pressing Create goal, Rerun relevant test, Compare with baseline or Open source location |
| Several requests in flight, plural, with a real fraction <br> *ordinary* | `pending > 1; the label pluralises `request` and the fill is completed/total` | `apps/web/src/ui/shell.tsx:64` | demo-populated, by pressing two capability controls before the first answers |
| The total rises while the bar is showing <br> *edge* | `a task starts while pending > 0: total = pending + completed, so aria-valuemax and the `of N` in the label both increase and the fill can move backwards` | `apps/web/src/ui/shell.tsx:48-49, apps/web/src/store.tsx:57-67` | demo-populated, by starting a third action while two are in flight |
| The progress bar can never appear <br> *ordinary* | `no declared capability is available, so no control can issue a request and pending never leaves zero` | `apps/web/src/ui/actions.tsx:58 gating apps/web/src/ui/shell.tsx:42` | axios, express, flask, langgraphjs, orchescope-discovery (nothing but export_standalone available, and that has no control) |

## Main column, above the section

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Keyboard help closed <br> *load bearing* | `state.helpOpen === false; the chrome button carries aria-expanded="false"` | `apps/web/src/ui/shell.tsx:84-86, 239` | every fixture |
| Keyboard help open, pushing the section down <br> *load bearing* | `state.helpOpen === true; a bordered panel with role="dialog", ten fixed shortcut rows and a Close button, mounted between the live region and the section content rather than over it` | `apps/web/src/ui/shell.tsx:81-110, mounted at 251` | every fixture, by the chrome button or by typing `?` |
| Help lists components table keys on a screen with no components table <br> *ordinary* | `SHORTCUTS is a fixed list of ten; six of them describe the treegrid, and it renders identically on Goals, Comparisons and Resilience` | `apps/web/src/ui/shell.tsx:27-38` | every fixture, by opening help on any section other than System map |
| No repair note <br> *load bearing* | `repaired.length === 0` | `apps/web/src/ui/shell.tsx:252` | every fixture |
| One field was missing and was defaulted to empty <br> *load bearing* | `repaired.length === 1; a `refusal` note titled `This report was missing part of itself.` naming the raw JSON key, on every screen until the page is reloaded` | `apps/web/src/ui/shell.tsx:252-259, filled at apps/web/src/bundle.ts:137-141` | **nothing here.** Delete the `runs` key from vercel-ai-chatbot-exercised.json. No fixture reaches this: every bundle the pipeline writes carries all twelve optional arrays and `metadata`. |
| A comma separated run of raw field names <br> *ordinary* | `repaired.length > 1; the names are the JSON keys unaltered, so the reader sees `componentMetrics, chaosReports, scenarioRuns` in prose` | `apps/web/src/ui/shell.tsx:256` | **nothing here.** Delete several of the twelve OPTIONAL_ARRAYS keys plus `metadata` from any bundle. All thirteen at once is the ceiling. |

## Main column and every action site

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Capabilities were the repaired field, so the note appears and every action control silently vanishes <br> *load bearing* | `repaired includes 'capabilities' and bundle.capabilities === []; indexCapabilities returns an empty map, every CapabilityAction returns null, and the `What this report can do from here` disclosure is omitted` | `apps/web/src/bundle.ts:137-141, apps/web/src/ui/actions.tsx:31, apps/web/src/sections/overview.tsx:720` | **nothing here.** Delete the `capabilities` key from demo-populated.json. The repair note names the gap, but nothing on the page connects it to the four missing buttons. |

## Main column, footer

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Read from the document itself <br> *load bearing* | `source === 'embedded', which is the case for both the served report and the standalone export, because the server substitutes the bundle into index.html` | `apps/web/src/ui/shell.tsx:264, apps/web/src/client.tsx:35-38, packages/report-server/src/server.ts:207-212` | every fixture |
| Read from the local report server <br> *edge* | `source === 'server', which requires the placeholder to survive into the delivered index.html so the page falls through to fetching /api/report` | `apps/web/src/client.tsx:39-55, rendered at apps/web/src/ui/shell.tsx:264` | **nothing here.** Serve apps/web/dist as static files with any other server while the report server holds /api/report. No shipped configuration produces it, so the sentence is written for a path the product does not take. |

## Loading page

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Reading the report <br> *ordinary* | `phase.status === 'loading'; a centred column with no chrome, naming both sources` | `apps/web/src/app.tsx:90-100, returned at 260-262` | every fixture, for one frame; a longer moment only when the bundle is fetched rather than embedded |

## Failure page

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The server answered with a status <br> *edge* | `the report was fetched and !response.ok; one problem line carrying the status and status text` | `apps/web/src/client.tsx:47-52` | **nothing here.** Only reachable on the 'server' source path. Serve apps/web/dist statically with /api/report returning 500. |
| Nothing embedded and the endpoint is unreachable <br> *load bearing* | `no embedded block (or the placeholder is still literal) and fetch threw; the line reads `No report is embedded in this page and /api/report is unreachable: <the browser's own error>`` | `apps/web/src/client.tsx:56-67` | **nothing here.** Open apps/web/dist/index.html directly from disk. This is the state a reader hits when they open the built page rather than an export. |
| The report document is empty <br> *edge* | `the fetched or embedded text trims to nothing` | `apps/web/src/bundle.ts:151-153` | **nothing here.** Replace the contents of the `orchescope-report` script block in any states/*.html with whitespace. |
| Not valid JSON, with the parser's own message <br> *ordinary* | `JSON.parse threw; the problem line appends the engine's message, which differs between browsers and can name a character offset` | `apps/web/src/bundle.ts:154-160` | **nothing here.** Truncate the JSON in the `orchescope-report` block of any states/*.html. |
| The report is not a JSON object <br> *edge* | `the parsed value is an array, a string or a number; a single problem line and nothing else` | `apps/web/src/bundle.ts:124-126` | **nothing here.** Replace the embedded block with `[]`. |
| Up to four identity problems at once <br> *ordinary* | `schemaVersion, reportId, projectName or generatedAt is missing, wrong typed or empty; each contributes its own line` | `apps/web/src/bundle.ts:103-116` | **nothing here.** Delete `reportId` and `projectName` from flask.json and render it. |
| Graph missing, and only one line says so <br> *edge* | `!isRecord(graph); checkGraph returns early, so the four inner checks never run and the reader sees one line rather than five` | `apps/web/src/bundle.ts:58-62` | **nothing here.** Delete the `graph` key from any bundle. |
| Up to four graph problems at once <br> *ordinary* | `graph is an object but components, edges, coverage or provenance is absent or the wrong shape` | `apps/web/src/bundle.ts:63-74` | **nothing here.** Delete `graph.coverage` and `graph.provenance` from flask.json. |
| Summary missing, and only one line says so <br> *edge* | `!isRecord(summary); checkSummary returns early, suppressing the nine inner checks` | `apps/web/src/bundle.ts:88-92` | **nothing here.** Delete the `summary` key from any bundle. |
| Up to nine summary problems at once <br> *ordinary* | `any of the eight SUMMARY_COUNTS is not a number, or findingCountBySeverity is not an object` | `apps/web/src/bundle.ts:93-100` | **nothing here.** Delete `summary.runCount` and `summary.findingCountBySeverity` from flask.json. |
| The longest the problem list can be <br> *edge* | `four identity plus four graph plus nine summary problems, all collected before the early return at bundle.ts:131` | `apps/web/src/bundle.ts:127-133, rendered at apps/web/src/app.tsx:114-118` | **nothing here.** Render `{"graph":{},"summary":{}}` as the embedded bundle. The list is an unbounded `ul.plain` inside a refusal panel, so seventeen lines of backticked field paths is the case the panel has to hold. |
| The report bundle could not be indexed <br> *edge* | `phase.status === 'ready' && (bundle === null \|\| index === null)` | `apps/web/src/app.tsx:266-268` | **nothing here.** Not reachable: `bundle` is non null whenever the phase is ready, and `index` is memoised from it. The branch exists as a type narrowing and its message will never be seen. |

## Failure page and Loading page

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| No chrome, so no theme control, no navigation, no shortcuts button and no skip link <br> *load bearing* | `phase.status !== 'ready'; Shell is never mounted, though the theme effect still stamps data-theme on the root and the global key handlers are still bound` | `apps/web/src/app.tsx:260-268 against 284-291` | **nothing here.** Any of the failure states above. Pressing `?` or Alt with a digit here changes state or the fragment with nothing on screen to show for it. |

## Any screen carrying the control

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Capability available: an enabled control with a hint <br> *load bearing* | `capabilityState(...).declared && .available; the button is enabled and its title is the hint, and no reason line is drawn` | `apps/web/src/ui/actions.tsx:53-63` | demo-populated (Create goal, Rerun relevant test, Compare with baseline, Open source location), and Create goal alone in anthropic-quickstarts, crewai, demonstration-system, langgraph, openai-agents-js, openai-agents-python, pydantic-ai, pydantic-ai-exercised, vercel-ai-chatbot, vercel-ai-chatbot-exercised |
| Capability declared but unavailable: a disabled control with the server's own reason under it <br> *load bearing* | `declared && !available; the button is disabled, its title is the reason, and a `.action-reason` paragraph repeats it with a visually hidden `Unavailable: ` prefix` | `apps/web/src/ui/actions.tsx:58-69` | axios, express, flask, langgraphjs, orchescope-discovery (Create goal disabled); every corpus bundle (Compare with baseline disabled); demonstration-system (Rerun relevant test disabled) |
| Control busy: label with a trailing ellipsis, disabled <br> *ordinary* | `busy === true while the request is outstanding; the label becomes `${label}…` and the button is disabled for the same reason an unavailable one is, with no reason line to distinguish them` | `apps/web/src/ui/actions.tsx:58, 62` | demo-populated, for the duration of any capability request |
| A result line under the control, announced politely <br> *load bearing* | `outcome !== null && outcome.ok; the message names what the server did, e.g. `Created goal gol_...`` | `apps/web/src/ui/actions.tsx:70, apps/web/src/ui/finding-card.tsx:191` | demo-populated |
| A failure line under the control, in one of four wordings <br> *load bearing* | `!outcome.ok: the server's own `error`/`message`/`detail` string, or `<path> answered <status> <statusText>.`, or `<path> answered with a body this page does not understand.`, or `<path> is unreachable: <detail>`` | `apps/web/src/client.tsx:96-113, surfaced at apps/web/src/ui/actions.tsx:70` | **nothing here.** Open states/demo-populated.html from disk and press Create goal: the capability says available, the origin is `file:`, and the fetch fails. |
| A result line that has outlived what produced it <br> *edge* | `outcome !== null and is never cleared: it survives a re-press until replaced and never returns to null, so a success line can sit under a control long after the report it describes was superseded` | `apps/web/src/ui/actions.tsx:28, 70` | demo-populated |
| An enabled control on a page that cannot reach a server <br> *load bearing* | `the bundle was produced with `served: true` and then exported to a single file; every capability still reports available, so four controls are enabled on a `file:` origin and fail when pressed` | `packages/usecases/src/capabilities.ts:92-97 against apps/cli/src/commands/audit.ts:70-80` | demo-populated (states/demo-populated.html) |

## Any screen that would carry the control

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Capability not mentioned at all: no control, and no gap where one was <br> *load bearing* | `!capabilityState(...).declared; the component returns null before any markup` | `apps/web/src/ui/actions.tsx:31-33, apps/web/src/ui/evidence-list.tsx:25-27, apps/web/src/capabilities.ts:52` | **nothing here.** Remove one entry from the `capabilities` array of demo-populated.json. Every bundle the pipeline writes answers about all nine, so absence only arises from an older writer or a repaired bundle. |

## Findings, a finding's actions

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| After creating a goal, a link to it appears inside the control <br> *ordinary* | `goalId !== null after a successful create_goal; a `link-button` reading `Open <goalId> in the goals section`, rendered as a child of the action and therefore surviving whatever the outcome line says next` | `apps/web/src/ui/finding-card.tsx:194-206` | demo-populated |

## Overview, How to read this

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Five of the nine capabilities have no control anywhere <br> *load bearing* | `run_benchmark, run_chaos, export_standalone, model_interpretation and cost_estimate are declared in every bundle and are referenced by no component; they exist only as rows in the reference table` | `apps/web/src/capabilities.ts:14-24 against the only four uses, apps/web/src/ui/finding-card.tsx:183, 211, 227 and apps/web/src/ui/evidence-list.tsx:16` | every fixture |
| What this report can do from here, as a nine row table <br> *load bearing* | `orderedCapabilities(index).length > 0; a disclosure carrying a count, with Action, Available and Reason columns, the reasons rendered as the server wrote them, lowercase and sentence fragmentary` | `apps/web/src/sections/overview.tsx:720-745` | every fixture |
| The capability disclosure is omitted entirely <br> *ordinary* | `orderedCapabilities(index).length === 0` | `apps/web/src/sections/overview.tsx:720` | **nothing here.** Empty the `capabilities` array of any bundle. |
| Five reason wordings no fixture produces <br> *edge* | `policy.allowProcessSpawn false (two distinct wordings), policy.allowedChaosEnvironments empty, prices configured with no tokens observed, and cost_estimate available` | `packages/usecases/src/capabilities.ts:30-38, 48-71` | **nothing here.** Set `policy.allowProcessSpawn` false, or empty `policy.allowedChaosEnvironments`, or add a `pricing` entry, in a workspace config and re-run the audit. The cost_estimate available wording is the only one that ever renders `true` for that row. |

## Overview, How to read this, and any disabled control

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A reason long enough to wrap several lines and carry a file path <br> *ordinary* | `the cost_estimate reason is 149 characters and names `.orchescope/config.json`, which is the widest string either the Reason column or an `.action-reason` line has to hold` | `packages/usecases/src/capabilities.ts:32` | every fixture |

## Findings and Goals

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A copy control with no result line <br> *ordinary* | `state === 'idle'; never gated by a capability because it needs no server` | `apps/web/src/ui/actions.tsx:104` | every fixture with a finding, and demo-populated for the goal prompt |
| Copied. <br> *ordinary* | `navigator.clipboard wrote, or the offscreen textarea selection copy succeeded` | `apps/web/src/ui/actions.tsx:106-107, apps/web/src/client.tsx:151-156` | every fixture with a finding |
| The clipboard is not available here, with instructions to copy by hand <br> *ordinary* | `navigator.clipboard is undefined or threw, and document.execCommand('copy') returned false` | `apps/web/src/ui/actions.tsx:108-110, apps/web/src/client.tsx:117-149` | **nothing here.** Open any states/*.html from disk in a browser that treats `file:` as insecure and blocks execCommand. This is the standalone export's own failure mode, and the fallback path exists precisely for it. |

## Goals

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A download control with no gate and no result line <br> *ordinary* | `always; DownloadButton has no capability, no busy state and no outcome, so it looks identical whether or not it worked` | `apps/web/src/ui/actions.tsx:115-133` | demo-populated |

## Chrome, controls

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Theme set to Match the system <br> *load bearing* | `no stored choice, or the stored value is not one of the three; readStoredTheme returns 'system' and resolveTheme reads the media query once` | `apps/web/src/app.tsx:63-73, 83-88, control at apps/web/src/ui/shell.tsx:201-216` | every fixture, on a first visit |
| Theme pinned to Light or Dark <br> *load bearing* | `state.theme === 'light' or 'dark'; data-theme is stamped on the document element and the choice is persisted` | `apps/web/src/app.tsx:187-190` | every fixture |
| The theme choice applies but is not remembered <br> *edge* | `window.localStorage throws on read or write, which a `file:` page or a hardened browser profile can do; the failure is swallowed and nothing on the page says the choice will not survive a reload` | `apps/web/src/app.tsx:69-71, 75-81` | **nothing here.** Open any states/*.html with site data blocked. No fixture distinguishes it, because nothing is rendered differently. |

## Live region

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Theme set to <value>. <br> *edge* | `the select changed; the announcement uses the raw value, so it says `Theme set to system.` rather than the label `Match the system`` | `apps/web/src/ui/shell.tsx:207-208` | every fixture |
| Nothing announced yet <br> *ordinary* | `state.announcement === ''; the polite region is present and empty from first render` | `apps/web/src/store.tsx:33, apps/web/src/ui/shell.tsx:248-250` | every fixture |
| One message, replacing whatever was there <br> *ordinary* | `any announce: a theme change, `Selected <componentId>.`, `Selection cleared.`, `<label> started.`, a copy result or a capability outcome. The region is aria-atomic, so a repeated identical message may not be re-announced` | `apps/web/src/app.tsx:227-254, apps/web/src/ui/shell.tsx:248` | every fixture |

## Page frame

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Skip to the report, offscreen <br> *ordinary* | `always, until focused; positioned at left: -9999px` | `apps/web/src/ui/shell.tsx:242-244, apps/web/src/styles.css:847-858` | every fixture |
| Skip to the report, visible at the top left <br> *ordinary* | `:focus; the first Tab press on the page reveals it over the chrome` | `apps/web/src/styles.css:860-863` | every fixture |

## Browser tab

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The tab title changes once the bundle is read <br> *edge* | `phase.status === 'ready' sets `<projectName>: Orchescope report`, replacing the static title, which is `Orchescope report` when served and `Orchescope report for <projectName>` in a standalone export` | `apps/web/src/app.tsx:221-225, scripts/build-web.mjs:31, packages/report/src/exports.ts:222` | every fixture |
| The tab keeps the build's title because no bundle loaded <br> *edge* | `phase.status !== 'ready', so the title effect never runs` | `apps/web/src/app.tsx:221-225` | **nothing here.** Any failure state. Two failed report tabs are indistinguishable in a tab strip. |

## What a designer needs to know beyond the list

FIXTURE COVERAGE. Of the 84 states above, 39 are reached by no fixture. They cluster in three places and that clustering is itself the finding. (1) The entire failure surface: 12 distinct problem wordings across four sources, none reachable from a bundle, all reachable by hand editing the `orchescope-report` script block of a states/*.html file. (2) The repair note: every bundle the pipeline writes carries all twelve OPTIONAL_ARRAYS and `metadata`, so `repaired` is always empty and the note has never been rendered against real data. (3) Provenance edges: git absent, ref absent, commit absent, and a timestamp that does not match the millisecond pattern. Everything except the timestamp is permitted by the schema.

THE TWO STATES THAT MATTER MOST AND ARE HARDEST TO SEE. First, `repaired-capabilities-removes-every-control`: the note says a field could not be read, and separately four buttons and one reference table disappear, with nothing joining the two. Second, `capability-available-with-no-server`: `audit --serve --export-html` bakes `available: true` into a file that has no server, so states/demo-populated.html shows four enabled controls that fail when pressed. That directly contradicts the AGENTS.md rule "a control the current configuration cannot perform is disabled with its reason shown, or absent. Never a button that fails when pressed." Capabilities are resolved once at audit time (packages/usecases/src/capabilities.ts:92-97) and the export path never re-resolves them (apps/cli/src/commands/audit.ts:70-80, apps/cli/src/commands/workspace-commands.ts:150).

THE SERVED SOURCE IS NOT THE FETCHED SOURCE. The report server substitutes the bundle into index.html (packages/report-server/src/server.ts:207-212), so a served report is read from the document, exactly as a standalone export is. `source === 'server'` and both of its failure messages therefore describe a path no shipped configuration takes. The difference a reader can actually observe between served and standalone is not the footer sentence but the capability set, the clipboard fallback, whether localStorage persists, and whether fonts arrive as files or data URIs.

ALT WITH A DIGIT IS INERT ON A MAC. `sectionForShortcut` reads `Number.parseInt(event.key, 10)` (apps/web/src/app.tsx:141-147). With Alt held on a US macOS layout the browser reports `event.key` as the composed character, `¡` for Alt+1 and so on, which parses to NaN, so the shortcut silently does nothing on the platform this workspace is developed on. The Playwright suite tests `?` and Escape (tests/ui/workspace.spec.ts:141) and never tests Alt with a digit, so nothing catches it. The help panel promises the shortcut in its first row.

NO ERROR BOUNDARY. `render(<App />, root)` has nothing above it (apps/web/src/main.tsx). A throw inside any section produces a blank white page and a console error, and the state space has no entry for it because no code draws it. The nearest thing to a designed catastrophe is the failure page, which only covers bundle loading.

FOCUS AND THE HELP PANEL. The panel takes focus when it opens (shell.tsx:72-76) but is not modal: there is no focus trap and no return of focus when it closes, so closing with Escape drops focus to the body and the next Tab starts at the skip link. It also mounts inside `main`, above the section, so opening it pushes the whole screen down rather than overlaying it. Escape is handled before the typing guard (app.tsx:197-199), so Escape while typing in a filter input closes the panel; `?` is handled after it, so `?` typed into an input does not open it.

THE SYSTEM THEME IS READ ONCE. `resolveTheme` calls `matchMedia(...).matches` inside an effect keyed on `state.theme` (app.tsx:83-88, 187-190) and nothing listens for a change. With the control on Match the system, an OS switching to dark while the page is open leaves the page in light until the reader touches the control or reloads.

NAVIGATION COUNTS AND SECTION TRUTH DIVERGE IN TWO PLACES. The System map count is `summary.componentCount`, every declared component, while the canvas only draws components a relation touches: 1 390 against 299 in openai-agents-python. The Performance count is `runs.length` only, so a bundle carrying component metrics or benchmarks with no run shows no count at all. Both are stated nowhere in the chrome.

THE CHROME IS SPATIAL, NOT SEQUENTIAL. Identity, navigation and the document level controls occupy three separate zones so a reader can tell what is true of the repository from what is true of this report from what they can change. The navigation sits on a row of its own and is centred on the page: measured, the eight labels with their counts are 797px, identity is 76px on the demonstration and 215px on `pydantic-ai-exercised`, and the controls are 331px, so three tracks on one line centre the navigation between zones of unequal width and put it 128px off the middle. Nothing in it is numbered, and the current section is marked by ink and a rule rather than by weight, because in a row a heavier label is a wider label and every other link would move each time a reader changed section.

WHERE TO LOOK AT THESE. states/index.html indexes one standalone page per bundle and is the fastest way to walk the reachable states. For the unreachable ones, edit the JSON inside the `orchescope-report` script block of a copy of a states/*.html file: the page validates that block on load, which is exactly the surface every failure state lives on."

