# System map: every state

142 states across 37 blocks. 24 of them are reached by no report in `corpus/.cache/bundles`, so `pnpm states` will not show them to you and the fourth column says what would.

Source: `The System map screen (apps/web/src/sections/map.tsx and everything it renders: the filter bar, the map census, the WebGL canvas with its legend, the components treegrid, and the component details panel)`.

## Thresholds

| Constant | Value | Where | What it switches | Why that number |
| --- | --- | --- | --- | --- |
| `nameEvery` / `nameSome` | computed per drawing, not a constant | `apps/web/src/map-names.ts:148` | The two scales, in pixels per layout unit, that decide the three readings of the names. At or beyond `nameEvery` every drawn component carries its name and every label is forced past Sigma's collision grid. Between the two, the names that fit are drawn busiest first and the rest are left out, and which ones those are is decided here rather than by the grid. Below `nameSome` no name is drawn except the selection and its neighbours, and the note says this is the shape of the system rather than an index of it. The live scale comes from `renderer.graphToViewport`, so it follows the camera and the canvas rather than being modelled. | Measured from the drawing rather than derived from a shape. Two names collide while they are closer than a line of type across the drawing and their own widths still meet along it; the scale at which the last colliding pair comes apart is `nameEvery`, and the same computation with 16 pixels in place of the name's width is `nameSome`. This replaced a constant of 120 derived from a ring's circumference, which was the wrong quantity twice over: it said nothing about a lattice, and it over-promised on the ring, where 26 components already printed two names on top of each other. |
| `LINE_PX` / `STEM_PX` / `CHAR_PX` / `NODE_RADIUS_PX` | 14 / 16 / 6.6 / 6 | `apps/web/src/map-names.ts:39, 45, 35, 56` | The four measurements the rule above is made of: a line of 11px type, the first characters of a name, the advance of 11px JetBrains Mono at 0.6em, and a node's own radius. The last one is why a dense drawing names far fewer than the labels alone would allow: labels are drawn over the nodes, so a name with a node in the middle of it has a hole where two characters were, and in the dark theme the hole is the same near white the name is set in. | Measured. 6.6 is the face's advance; 16 is the one part of the ring's old derivation that was right; 6 is `BASE_NODE_SIZE`; 14 is the line box of 11px type. |
| `VIRTUALISE_THRESHOLD` | 200 rows | `apps/web/src/window.ts:9, used at ui/treegrid-view.tsx:272` | Below or at it the whole table renders inline and grows the page with no note. Above it the table becomes a 420px scroller rendering only a window of rows with two spacer rows holding the height open, and a mono line reads 'Showing rows X to Y of N'. The count is rows, which is groups plus the components of expanded groups, so collapsing kinds can cross it in either direction | Taste, undocumented as a number; the module's comment argues only that a page rendering thousands of rows is a page nobody scrolls |
| `ROW_HEIGHT / VIEWPORT_HEIGHT` | 28px / 420px | `apps/web/src/ui/treegrid-view.tsx:35` | How many rows the window holds (15 plus 8 of overscan either side) and how far a keyboard move scrolls; also the height of the spacers, so a wrong row height desynchronises the scrollbar from the list | Taste, undocumented |
| `MAX_RINGED_NODES` | 4000 | `packages/report/src/layout.ts:70` | Below it the connected components are laid out on concentric rings. Above it they are dropped into a deterministic square grid of 216-unit cells and LayoutResult.fallback is set true. Nothing in the browser reads that flag, so the map would silently show a grid and call it a topology | Taste, undocumented. The largest connected count in the corpus is 920, so this has never fired |
| `LAYOUT_EDGE_KINDS` | 16 relation kinds, 'contains' deliberately excluded | `packages/report/src/layout-relations.ts:18` | Whether a component gets a coordinate at all, and therefore whether the map draws it, whether the census counts it as drawn, and whether its relations are counted as dangling. Shared by all three arrangements, so every one of them positions exactly the same components and the census does not move when a reader switches. A component joined to the system only by containment is undrawn while the table shows it with relations | Stated: containment does not shape the reading order of the diagram. The consequence for the census wording is not stated |
| `PITCH / RING_GAP` | 130 / 200 layout units | `packages/report/src/layout-relations.ts:112, packages/report/src/layout.ts:67` | Ring capacity, and therefore how square the drawing is and how much tangential room a label has; RING_GAP > PITCH so the centre node's own name does not run across its first ring. PITCH is shared with the directional arrangements, so the room a name has does not depend on which one is showing | Derived: a name is about 90 units wide at the sizes this workspace uses, so a pitch under that guarantees neighbours overwrite each other |
| `RANK_GAP` / `PHASES` | 2 x PITCH / 4 | `packages/report/src/layered-layout.ts:71, 74` | How a directional arrangement is drawn. RANK_GAP is the distance between one rank and the next, twice the gap inside a rank so a rank boundary is the widest gap in the drawing and reads as one. PHASES is how many lines the half pitch offset cycles over before repeating, which is what stops two neighbours in a line sharing a horizontal line of type | Measured over connected slices of every corpus repository. At a rank gap of 1.5 a boundary is not distinguishable from a wrap; at 3 the drawing grows enough to cost a fifth of the names it could otherwise place. Two phases stops naming every node of a drawing of 35 and six collapses at the same size for the opposite reason, its offset being under a line of type; four is the only one of the three that still names every node of most drawings of 50 |
| `BASE_NODE_SIZE / MIN_NODE_SIZE / MAX_NODE_SIZE` | 6 / 3 / 14 | `apps/web/src/ui/graph-canvas.tsx:94, apps/web/src/overlay.ts:38` | With no overlay every node is 6. Turning an overlay on shrinks an unmeasured node to 3 and puts a measured one between 3 and 14, so switching overlay on shrinks most of the map | Taste, undocumented |
| `SELECTED_SIZE_BOOST` | +5 | `apps/web/src/ui/graph-canvas.tsx:95` | The selected node's radius, added on top of whatever the overlay gave it, so a selected unmeasured node (3+5) reads larger than an unselected node at the overlay's maximum minus a little | Taste, undocumented |
| `overlay legend steps` | 5, plus a sixth 'no measurement' stop | `apps/web/src/ui/graph-canvas.tsx:546, apps/web/src/overlay.ts:122` | How many swatches the legend prints, evenly spaced across the measured range. When min equals max all five print the same number in five different tones | Taste, undocumented; the floor of 2 in overlayLegend is the only guard |
| `normaliseValue degenerate range` | max <= min returns 0.5 | `apps/web/src/overlay.ts:73` | A set of identical measurements is drawn uniformly at the ramp's midpoint and mid radius rather than all at one extreme. It is the state most corpus bundles are in, because the architecture overlay is all zeros wherever there is no run | Stated in the comment: identical measurements should not all land at one extreme |
| `labelDensity / labelGridCellSize` | 1 / 159px | `apps/web/src/ui/graph-canvas.tsx:486, 125` | How many labels Sigma keeps at a given camera ratio. It no longer decides anything a reader sees: every name the canvas draws is forced past this grid, because which names are drawn is worked out from the drawing instead. It is the last guard if that ever fails | Measured: 159px is the mean drawn name over the 2994 positioned components in the pinned corpus, 22.7 characters of 11px mono. It was 120, from an estimate of 18 characters, and a cell narrower than a name is not a collision check |
| `MAP_LAYOUT_KEYS` | 3 arrangements | `packages/report/src/layouts.ts:40, apps/web/src/layout.ts:34` | Which arrangements the CLI bakes and the browser offers, and where each one's coordinates live in a component's metadata. A bundle carrying only `layoutX` and `layoutY` was written before the others existed: it draws, and the picker is absent rather than broken. `pnpm states` loads both sides and refuses to render if the two lists have drifted apart | Measured. Two directional arrangements cost 90 bytes for each component they position, between 0.5 and 2.2 percent of a bundle; at `pydantic-ai` that is 63 KB on 4.9 MB. Only positioned components pay |
| `camera ratio clamps and zoom factor` | 0.05 to 12, factor 1.3 per press | `apps/web/src/ui/graph-canvas.tsx:373, 468` | When Zoom in or Zoom out stops doing anything. The buttons never disable or explain, they simply stop moving after about nine presses | Taste, undocumented |
| `LABEL_MARGIN_SHARE` | 0.06 of the drawing's spread, tripled on the right | `apps/web/src/ui/graph-canvas.tsx:98, 196` | How much room 'Zoom to fit' leaves around the outermost nodes, with extra on the right for the label that runs out of the rightmost node | Stated: a box drawn tight to the outermost node cuts that node's name in half |
| `canvas height` | 640px, 420px below the narrow breakpoint | `apps/web/src/styles.css:1310, 1660` | How much of the concentric drawing is visible at the fitted ratio, and therefore how many names fit before the density grid drops them | Stated: a concentric layout is square, so a shallow band wasted more than half the column |
| `node border share` | 0.18 of the radius | `apps/web/src/ui/graph-canvas.tsx:118` | How thick a ring reads at any zoom. At the overlay minimum radius of 3 the ring is under a pixel, which is where a measured zero and an unmeasured component become hard to tell apart | Stated: the border is a share of the radius so a ring reads the same at every zoom level |

## System map, whole screen

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| No components at all: the whole screen is one refusal panel <br> *load bearing* | `bundle.graph.components.length === 0` | `apps/web/src/sections/map.tsx:85` | orchescope-discovery |
| The normal screen: Filters, The system (census + canvas + table), Details <br> *load bearing* | `bundle.graph.components.length > 0` | `apps/web/src/sections/map.tsx:103` | every fixture except orchescope-discovery |

## Filters block, search field

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Search status reads a plural count of matches <br> *load bearing* | `filterComponents(components, {query, kinds}).length !== 1` | `apps/web/src/ui/filters.tsx:95, apps/web/src/format.ts:173` | every fixture |
| Search status switches to the singular noun at exactly one match <br> *ordinary* | `filterComponents(...).length === 1` | `apps/web/src/ui/filters.tsx:95` | any fixture, by typing a query that matches one component (flask has 4) |
| Search matches nothing: '0 components shown', and every block below it empties at once <br> *load bearing* | `filterComponents(...).length === 0` | `apps/web/src/ui/filters.tsx:95, treegrid-view.tsx:406` | any fixture, by typing a query nothing matches |

## Filters block, Component kind

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Component-kind tokens: two of them <br> *edge* | `index.componentKinds.length === 2` | `apps/web/src/sections/map.tsx:117` | express |
| Component-kind tokens: twelve of them, wrapping over several rows <br> *load bearing* | `index.componentKinds.length === 12` | `apps/web/src/sections/map.tsx:117` | demonstration-system, demo-populated |
| A kind's count keeps counting components the search query has already excluded <br> *ordinary* | `query !== '' and bundle.graph.components.filter(c => c.kind === k).length > the number of matching rows` | `apps/web/src/sections/map.tsx:124` | any fixture, by typing a query |

## Filters block, Relation kind

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The Relation kind fieldset is not rendered at all <br> *ordinary* | `index.edgeKinds.length === 0, i.e. bundle.graph.edges.length === 0` | `apps/web/src/ui/filters.tsx:23` | **nothing here.** Take flask and delete both entries from graph.edges; every component then also becomes isolated |
| A single relation-kind token, which can only ever narrow to all or nothing <br> *edge* | `index.edgeKinds.length === 1` | `apps/web/src/sections/map.tsx:130` | express |
| Thirteen relation-kind tokens <br> *ordinary* | `index.edgeKinds.length === 13` | `apps/web/src/sections/map.tsx:130` | demonstration-system |

## Filters block, Overlay

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| No overlay control: a note stands where the select would be <br> *edge* | `bundle.overlays.length === 0` | `apps/web/src/sections/map.tsx:141` | **nothing here.** Empty the overlays array of any bundle by hand; the pipeline always emits the architecture overlay (packages/report/src/overlays.ts:206) so no generated report reaches this |
| Overlay select with one real choice besides 'No overlay' <br> *edge* | `bundle.overlays.length === 1` | `apps/web/src/sections/map.tsx:144` | orchescope-discovery only, which refuses before the control renders |
| Overlay select with the two static overlays (Declared and observed, Write permissions) <br> *load bearing* | `bundle.overlays.length === 2` | `apps/web/src/sections/map.tsx:144` | flask, express, axios, demonstration-system, vercel-ai-chatbot, anthropic-quickstarts, langgraphjs, openai-agents-js, langgraph, crewai, openai-agents-python, pydantic-ai |
| Overlay select with eight choices once a run is folded in <br> *load bearing* | `bundle.overlays.length === 8 (architecture, runtime_frequency, latency, tokens, errors, retries, permissions, scenario_coverage)` | `apps/web/src/sections/map.tsx:144` | vercel-ai-chatbot-exercised, pydantic-ai-exercised |
| Overlay select with nine choices, the ninth being resilience from a chaos run <br> *ordinary* | `bundle.overlays.length === 9, chaos outcomes matched a component by display name` | `packages/report/src/overlays.ts:158` | demo-populated |
| A tenth overlay, Cost, with the longest caveat in the system <br> *ordinary* | `bundle.componentMetrics.some(m => m.costUsd !== undefined)` | `packages/report/src/overlays.ts:116` | **nothing here.** Give one componentMetrics row in demo-populated a costUsd; no corpus run has a configured price |

## Filters block, Arrangement

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The picker with all three arrangements: Concentric, Top down, Left to right <br> *load bearing* | `index.layout.kinds.length === 3` | `apps/web/src/sections/map.tsx:169` | every fixture except orchescope-discovery |
| No picker at all, because the bundle carries one arrangement <br> *load bearing* | `index.layout.kinds.length < 2`, which is a bundle written before the directional arrangements existed | `apps/web/src/sections/map.tsx:169` | **nothing here.** Delete every `layoutDownX`, `layoutDownY`, `layoutRightX` and `layoutRightY` from a bundle by hand; `pnpm states` still renders it, because one arrangement is not staleness |
| A directional arrangement selected: the same components, redrawn, and the camera reframed <br> *load bearing* | `layout !== 'concentric'` | `apps/web/src/sections/map.tsx:67, apps/web/src/ui/graph-canvas.tsx:616` | every fixture except orchescope-discovery, by choosing one |
| The choice is not in the address, so a map arranged one way is not linkable while a selection arriving from another screen is <br> *ordinary* | `always` | `apps/web/src/sections/map.tsx:67` | every fixture |

## Filters block, match count line

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The polite live line: 'N of M components and X of Y relations match.' <br> *load bearing* | `always, once components exist` | `apps/web/src/sections/map.tsx:168` | every fixture except orchescope-discovery |
| The same sentence with counts of one, still worded plural ('1 of 4 components and 0 of 2 relations match') <br> *edge* | `visibleComponents.length === 1 \|\| visibleEdges.length === 1 \|\| bundle.graph.edges.length === 1` | `apps/web/src/sections/map.tsx:169` | any fixture, by narrowing to one component |
| '0 of N components and 0 of M relations match.' while the canvas and table are both empty <br> *ordinary* | `visibleComponents.length === 0` | `apps/web/src/sections/map.tsx:168` | any fixture, by selecting a kind and a query that disagree |

## The system, census lede

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Census says the map drew everything: one sentence, no per-kind line <br> *load bearing* | `buildMapCensus(...).omitted.length === 0` | `apps/web/src/sections/map.tsx:31` | flask, express, axios |
| Census says how much was left out, then names it per kind <br> *load bearing* | `census.omitted.length > 0` | `apps/web/src/sections/map.tsx:38` | demonstration-system, demo-populated, vercel-ai-chatbot, vercel-ai-chatbot-exercised, anthropic-quickstarts, langgraphjs, openai-agents-js, langgraph, crewai, openai-agents-python, pydantic-ai, pydantic-ai-exercised |
| Every component isolated: '0 of N components are on the map' with a row for every kind <br> *load bearing* | `index.layout.positions.size === 0 && bundle.graph.components.length > 0` | `apps/web/src/sections/map.tsx:41, packages/report/src/layout.ts:189` | **nothing here.** Delete graph.edges from flask, or keep only 'contains' edges; the layout then positions nothing and the canvas is a blank bordered box |
| The census keeps stating whole-repository counts while every count under it is filtered <br> *ordinary* | `kinds.length > 0 \|\| query !== ''` | `apps/web/src/sections/map.tsx:30` | any fixture, by using a filter |
| 'Every one of the N components this repository declares' counts components that were only ever observed <br> *edge* | `census.omitted.length === 0 && index.runtimeOnly.size > 0` | `apps/web/src/sections/map.tsx:34` | **nothing here.** Give vercel-ai-chatbot-exercised's six unwired prompts a relation so nothing is omitted; it has two runtime-only components |
| A one-component repository: 'Every one of the 1 components this repository declares is on the map.' <br> *edge* | `bundle.graph.components.length === 1` | `apps/web/src/sections/map.tsx:34` | **nothing here.** Cut flask down to one component and no edges |

## The system, census meta line

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Exactly one per-kind row under the sentence <br> *ordinary* | `census.omitted.length === 1` | `apps/web/src/sections/map.tsx:49` | demonstration-system (Prompt 0 of 7), anthropic-quickstarts (Prompt 0 of 36), vercel-ai-chatbot (Prompt 1 of 7) |
| Four per-kind rows, middle-dot separated, worst-missing first <br> *load bearing* | `census.omitted.length === 4` | `apps/web/src/sections/map.tsx:49, apps/web/src/map-census.ts:48` | openai-agents-python (Agent 140 of 620, Prompt 2 of 370, Tool 89 of 318, Mcp server 6 of 21), openai-agents-js |
| A kind with nothing drawn at all: 'Prompt 0 of 36' <br> *load bearing* | `census.omitted.some(r => r.drawn === 0)` | `apps/web/src/map-census.ts:46` | anthropic-quickstarts, demonstration-system, crewai (Agent group 0 of 90), langgraph, langgraphjs |
| A kind missing exactly one member: 'Agent 6 of 7' <br> *edge* | `census.omitted.some(r => r.declared - r.drawn === 1)` | `apps/web/src/map-census.ts:46` | vercel-ai-chatbot-exercised (Agent 6 of 7, Model 2 of 3) |

## The system, census lede vs the Relations column

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The census claims the undrawn 'take part in no relation' while the table shows them with relations <br> *load bearing* | `a component is touched only by edges whose kind is outside LAYOUT_EDGE_KINDS (in practice 'contains')` | `apps/web/src/sections/map.tsx:45, packages/report/src/layout.ts:82` | crewai (144 such components), langgraph (259), langgraphjs (249) |
| A component whose only relation points at itself is counted as having none <br> *edge* | `a component's only incident edge has edge.from === edge.to` | `packages/report/src/layout.ts:140, apps/web/src/graph-index.ts:221` | openai-agents-python (1 component), langgraph |

## Canvas

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Every name clear: every drawn node carries its name, none may be dropped, no note <br> *load bearing* | `scale >= room.nameEvery` | `apps/web/src/ui/graph-canvas.tsx:318, 532` | flask (4), express (5), axios (8), anthropic-quickstarts (17) on any arrangement; demonstration-system (25), demo-populated (26) and both vercel-ai-chatbot reports (35) on either directional arrangement but not on the concentric one |
| Some names clear: the busiest keep theirs, the rest are left out, and the note says how many of how many <br> *load bearing* | `room.nameSome <= scale < room.nameEvery` | `apps/web/src/ui/graph-canvas.tsx:319, 790` | concentric: demonstration-system 24 of 25, demo-populated 25 of 26, vercel-ai-chatbot 30 of 35, crewai 77 of 150. Directional only: langgraph 35 and 53 of 288, openai-agents-python 19 and 32 of 298, langgraphjs 30 and 41 of 329, openai-agents-js 20 and 23 of 417, where the concentric arrangement names nothing at all |
| No name at all: the shape of the system, and the magnification that would name it <br> *load bearing* | `scale < room.nameSome` | `apps/web/src/ui/graph-canvas.tsx:317, 796` | pydantic-ai and pydantic-ai-exercised (679) on every arrangement; langgraph, openai-agents-python, langgraphjs and openai-agents-js on the concentric one; every report over 150 drawn at the narrow breakpoint |
| A name a node is drawn through is not counted as drawn, which is most of what a dense drawing loses <br> *load bearing* | `another node falls inside a name's own box at this scale` | `apps/web/src/map-names.ts:56, 219` | crewai (77 names rather than the 96 the labels alone would allow), pydantic-ai (14 rather than 86) |
| A drawing that can never name everything, because two components share a coordinate: no magnification is offered <br> *edge* | `room.nameEvery === Infinity` | `apps/web/src/map-names.ts:250` | **nothing here.** No layout in this build puts two components at one point |
| The renderer threw: a refusal note above an empty bordered box, table declared primary <br> *load bearing* | `the Sigma constructor, a theme repaint or a refresh throws; failure !== null` | `apps/web/src/ui/graph-canvas.tsx:421, 504` | **nothing here.** Any bundle in a browser with WebGL off. The message is the raw library or browser string, unbounded and untranslated |
| Nothing to draw: an empty 640px box with a working toolbar and a full table beside it <br> *load bearing* | `index.layout.positions.size === 0` | `apps/web/src/ui/graph-canvas.tsx:136, 184` | **nothing here.** Delete graph.edges from flask; the same edit that reaches census-nothing-drawn |
| Every node hidden by a filter: the drawing is blank but the camera never reframes unless Zoom to fit is pressed <br> *ordinary* | `visibleComponents.length === 0` | `apps/web/src/ui/graph-canvas.tsx:380, 184` | any fixture, by combining a kind token and a query |
| A node selected: enlarged by five, forced label, its neighbours named, its edges inked and doubled <br> *load bearing* | `app.state.selected !== null && index.layout.positions.has(selected)` | `apps/web/src/ui/graph-canvas.tsx:384, 393, 404` | every fixture with a drawn component |
| The note offers a name for whatever you select, but selecting an undrawn component names nothing <br> *ordinary* | `!naming.every && !index.layout.placedIds.has(selected)` | `apps/web/src/ui/graph-canvas.tsx:790 with 533` | crewai, openai-agents-python, langgraph, langgraphjs, pydantic-ai |
| A self relation and two relations between the same pair are drawn on top of each other with no curvature <br> *edge* | `edge.from === edge.to, or two edges share a from/to pair` | `apps/web/src/ui/graph-canvas.tsx:161` | openai-agents-python and langgraph (self loops), demonstration-system and demo-populated (parallel pairs) |

## Canvas toolbar

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| After a failure the hint still says N components are drawn, and the zoom buttons stay enabled and inert <br> *ordinary* | `failure !== null && drawnCount > 0` | `apps/web/src/ui/graph-canvas.tsx:462, 480, 495` | **nothing here.** Same as canvas-failed |
| The hint counts relations as drawn that the canvas dropped, and the note below contradicts it <br> *load bearing* | `visibleEdges.length > the number of edges with both endpoints in index.layout.positions` | `apps/web/src/ui/graph-canvas.tsx:495 vs 534` | crewai (says 243 of 243 drawn, 104 not drawn), langgraph (450), langgraphjs (415) |
| Zoom in or out reaches its clamp and the button keeps looking available while nothing changes <br> *ordinary* | `camera ratio has reached 0.05 or 12` | `apps/web/src/ui/graph-canvas.tsx:468` | every fixture, by pressing Zoom in about nine times |

## Canvas, below the legend

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| 'N relations name a component that is not in this graph and are not drawn.' <br> *load bearing* | `built.danglingEdges.length > 0, i.e. an edge whose endpoint has no stored position` | `apps/web/src/ui/graph-canvas.tsx:534` | crewai (104), langgraph (450), langgraphjs (415), openai-agents-python (1) |
| The same note at a count of one: '1 relations name a component...' <br> *edge* | `built.danglingEdges.length === 1` | `apps/web/src/ui/graph-canvas.tsx:536` | openai-agents-python |

## Canvas key

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| No overlay and no run: every node filled, one key line saying nothing is drawn as unexercised <br> *load bearing* | `overlay === null && index.hasRuntimeEvidence === false` | `apps/web/src/ui/graph-canvas.tsx:229, 524` | flask, express, axios, demonstration-system, anthropic-quickstarts, vercel-ai-chatbot, langgraphjs, openai-agents-js, langgraph, crewai, openai-agents-python, pydantic-ai |
| No overlay and a run: filled discs and hollow rings, two key lines <br> *load bearing* | `overlay === null && index.hasRuntimeEvidence === true` | `apps/web/src/ui/graph-canvas.tsx:229, 513` | demo-populated, vercel-ai-chatbot-exercised, pydantic-ai-exercised |
| A run exists but no drawn component was reached, so the map is all rings under a two-line key <br> *edge* | `index.hasRuntimeEvidence && exercisedIds(index) contains no positioned component` | `apps/web/src/ui/graph-canvas.tsx:260` | pydantic-ai-exercised is close (3 runtime components of 1953) |

## Canvas with an overlay on

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A measured component: tone and radius both carry the value <br> *load bearing* | `overlay.values.has(componentId)` | `apps/web/src/overlay.ts:159, graph-canvas.tsx:227` | every fixture, on the architecture overlay |
| A component with no value for this overlay: a hollow ring at the smallest radius <br> *load bearing* | `!overlay.values.has(componentId)` | `apps/web/src/overlay.ts:156, graph-canvas.tsx:221` | every fixture, on the permissions overlay |
| An overlay that measured almost nothing: the map goes to a field of small rings around two or three discs <br> *load bearing* | `overlay.values.size / bundle.graph.components.length is tiny` | `apps/web/src/overlay.ts:156` | anthropic-quickstarts (permissions, 2 of 53), pydantic-ai-exercised (latency, 3 of 1953), crewai (permissions, 10 of 987) |
| A measured zero and an unmeasured component are drawn a filled and a hollow 3px dot of the same grey <br> *load bearing* | `overlay.min === 0 && some value === 0, alongside components absent from overlay.values` | `apps/web/src/overlay.ts:159 with graph-canvas.tsx:221` | demo-populated (latency: 3 zeros; tokens: 14 zeros; errors: 14 zeros), pydantic-ai-exercised, crewai (permissions has one zero) |
| Every measured value identical: all measured nodes take the ramp's midpoint and the legend prints the same number five times <br> *load bearing* | `overlay.max <= overlay.min` | `apps/web/src/overlay.ts:73, 132` | flask, express, axios, demonstration-system, anthropic-quickstarts, langgraphjs, langgraph, crewai, openai-agents-python, pydantic-ai, vercel-ai-chatbot (architecture, all zero); pydantic-ai-exercised and vercel-ai-chatbot-exercised (errors and retries, all zero; scenario_coverage, all one) |
| An overlay carrying no values: min and max forced to zero, every node a ring, legend five zeros <br> *edge* | `overlay.values.length === 0` | `apps/web/src/overlay.ts:53` | orchescope-discovery's architecture overlay, which the screen refuses before showing |

## Canvas overlay legend

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Legend headed with a unit in parentheses and every stop suffixed by it <br> *load bearing* | `overlay.unit !== undefined` | `apps/web/src/ui/graph-canvas.tsx:545, 550` | every fixture (permissions, count); demo-populated (ms, tokens, runs, count) |
| Legend with no unit at all: bare numbers <br> *load bearing* | `overlay.unit === undefined` | `apps/web/src/ui/graph-canvas.tsx:545` | every fixture (architecture), demo-populated (resilience) |
| A caveat line under the legend, up to four lines long <br> *load bearing* | `overlay.caveat !== undefined` | `apps/web/src/ui/graph-canvas.tsx:573` | every fixture (architecture, permissions), demo-populated (latency, resilience) |
| No caveat line, so the legend ends at the meta row <br> *ordinary* | `overlay.caveat === undefined` | `apps/web/src/ui/graph-canvas.tsx:573` | demo-populated and the exercised bundles (runtime_frequency, tokens, errors, retries, scenario_coverage) |
| Interpolated stops land on fractions, so a count overlay prints 3.25 of a thing that cannot be fractional <br> *ordinary* | `(overlay.max - overlay.min) is not divisible by 4` | `apps/web/src/overlay.ts:133, ui/graph-canvas.tsx:560` | demo-populated (runtime_frequency 10 to 40; tokens 0 to 14 055), pydantic-ai-exercised (latency 0 to 34) |
| A stop whose value is a five-figure number, group-spaced, and a millisecond overlay printed as raw ms rather than seconds <br> *edge* | `overlay.max is large; unit === 'ms' uses formatNumber, not formatDuration` | `apps/web/src/ui/graph-canvas.tsx:560` | demo-populated (tokens up to 14 055) |

## Details block

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Nothing selected: a lede telling the reader what selecting would give them <br> *load bearing* | `app.state.selected === null` | `apps/web/src/sections/map.tsx:202` | every fixture on first load |
| The selected identifier is not in the report: a refusal panel with the raw identifier in mono <br> *load bearing* | `index.componentsById.get(selected) === undefined` | `apps/web/src/ui/component-details.tsx:311` | **nothing here.** Open any report at #/map?component=does-not-exist, or add a component id to a finding's components array that the graph does not carry |

## Canvas and details

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The selected component has no position, so the canvas shows no selection while the details panel is full <br> *load bearing* | `selected !== null && !index.layout.positions.has(selected)` | `apps/web/src/ui/graph-canvas.tsx:140 with sections/map.tsx:208` | anthropic-quickstarts (any of 36 prompts), crewai, openai-agents-python, langgraphjs, demonstration-system |

## Canvas, table and details

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The selection survives a filter that hides it: absent from the canvas, absent from the table, still expanded in Details <br> *ordinary* | `selected !== null && !visibleIds.has(selected)` | `apps/web/src/ui/graph-canvas.tsx:380, treegrid.ts:288, sections/map.tsx:208` | any fixture, by selecting a component then deselecting its kind |

## Components table

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Every kind open on arrival, one row per component under a group row <br> *load bearing* | `initial state expands all groups` | `apps/web/src/treegrid.ts:122` | every fixture with components |
| No component matches: header row alone, a muted sentence, and no row holding a tab stop <br> *load bearing* | `visibleRows(groups, expanded).length === 0` | `apps/web/src/ui/treegrid-view.tsx:406, 250` | any fixture, by filtering to nothing |
| Under two hundred rows: the whole table renders inline and grows the page, no windowing note <br> *load bearing* | `groups.length + expanded component count <= 200` | `apps/web/src/window.ts:21, ui/treegrid-view.tsx:272` | flask (7), express (7), axios (11), demonstration-system (44), demo-populated (45), vercel-ai-chatbot (48), vercel-ai-chatbot-exercised (50), anthropic-quickstarts (61) |
| Over two hundred rows: a 420px scroller and a 'Showing rows X to Y of N' line <br> *load bearing* | `rows.length > 200` | `apps/web/src/ui/treegrid-view.tsx:401` | langgraphjs (716), openai-agents-js (777), langgraph (860), crewai (996), openai-agents-python (1 400), pydantic-ai (1 735), pydantic-ai-exercised (1 963) |
| Exactly at and one over the windowing threshold, where the table changes height and gains a note <br> *edge* | `rows.length === 200 versus 201` | `apps/web/src/window.ts:9` | **nothing here** |
| All kinds collapsed: the table becomes a short list of kinds and drops out of virtualisation <br> *ordinary* | `state.expanded === []` | `apps/web/src/treegrid.ts:106` | any fixture, by pressing left arrow on each group |
| A single kind: one group row over everything <br> *ordinary* | `index.componentKinds.length === 1, or a kind filter leaving one` | `apps/web/src/ui/treegrid-view.tsx:222` | any fixture, by selecting one kind token |
| A group row reading '750 components' over 750 sibling rows <br> *load bearing* | `max group size, e.g. prompt in pydantic-ai` | `apps/web/src/ui/treegrid-view.tsx:120` | pydantic-ai, pydantic-ai-exercised (750 prompts), crewai (521), openai-agents-python (620 agents) |

## Components table, group row

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A group row: name, 'N components' in the Kind column, three genuinely empty cells for Depth, Evidence class and Confidence, and summed Relations and Findings <br> *load bearing* | `row.type === 'group'` | `apps/web/src/ui/treegrid-view.tsx:128` | every fixture with components |
| Depth is empty on a group row rather than summed, because a kind has no one depth <br> *load bearing* | `row.type === 'group'` | `apps/web/src/ui/treegrid-view.tsx:147` | every fixture with components |
| A group with no metrics anywhere in it says 'not measured' rather than nought executions <br> *load bearing* | `no componentId in the group has a metrics row` | `apps/web/src/ui/treegrid-view.tsx:125` | every fixture with no runs; and in demo-populated every kind whose members were never measured |
| A group with at least one measured member sums the executions of the measured ones only <br> *ordinary* | `some componentId in the group has a metrics row` | `apps/web/src/ui/treegrid-view.tsx:110` | demo-populated, vercel-ai-chatbot-exercised, pydantic-ai-exercised |
| The group's Relations total counts a relation twice when both of its ends are the same kind <br> *ordinary* | `an edge joins two components of one kind` | `apps/web/src/ui/treegrid-view.tsx:116 with graph-index.ts:221` | langgraphjs, langgraph, crewai, demo-populated |

## Components table, component row

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A Depth of nought, a component nothing calls, which is where a directional arrangement starts <br> *load bearing* | `index.layout.ranks.get(id) === 0` | `apps/web/src/ui/treegrid-view.tsx:116` | every fixture with a drawn component |
| Depth reads 'not drawn', because the component has no place in the flow either <br> *load bearing* | `index.layout.ranks.get(id) === undefined && ranks.size > 0` | `apps/web/src/ui/treegrid-view.tsx:101` | anthropic-quickstarts (36), openai-agents-python (1 091), crewai (693) |
| The Depth column is there and every cell in it is empty, because the bundle carries one arrangement <br> *edge* | `index.layout.ranks.size === 0` | `apps/web/src/ui/treegrid-view.tsx:97` | **nothing here.** Delete every `layoutRank` from a bundle by hand |
| A nought in Relations, which is how a reader finds what the map left out <br> *load bearing* | `index.degreeByComponent.get(id) === undefined` | `apps/web/src/ui/treegrid-view.tsx:92` | anthropic-quickstarts (36), openai-agents-python (1 091), crewai (693), demonstration-system (7) |
| A three-figure Relations cell on the hub the whole repository hangs off <br> *ordinary* | `max(index.degreeByComponent)` | `apps/web/src/ui/treegrid-view.tsx:92` | langgraph (119), pydantic-ai-exercised (117), langgraphjs (98) |
| Executions reads 'not measured', never nought <br> *load bearing* | `index.metricsByComponent.get(id) === undefined` | `apps/web/src/ui/treegrid-view.tsx:96` | every fixture with no runs, and 1 950 of 1 953 rows in pydantic-ai-exercised |
| Executions reads a count and a self time in one cell <br> *load bearing* | `index.metricsByComponent.get(id) !== undefined` | `apps/web/src/ui/treegrid-view.tsx:98` | demo-populated (15 rows), vercel-ai-chatbot-exercised (3), pydantic-ai-exercised (3) |
| A Findings cell above nought, up to twelve findings on one component <br> *ordinary* | `index.findingsByComponent.get(id).length > 0` | `apps/web/src/ui/treegrid-view.tsx:99` | demo-populated, demonstration-system, openai-agents-python, crewai |
| A row for an identifier the graph does not carry: raw id, 'unknown' in four cells, a dashed 'referenced but absent from the graph' note <br> *edge* | `index.componentsById.get(row.componentId) === undefined` | `apps/web/src/ui/treegrid-view.tsx:67` | **nothing here.** Unreachable as wired: TreeGridView is only ever given components taken from the same bundle (sections/map.tsx:195). It would need the table to be fed finding-referenced identifiers |
| The selected row, tinted, aria-selected, and revealed by expanding its kind when the selection came from elsewhere <br> *load bearing* | `row.componentId === app.state.selected` | `apps/web/src/ui/treegrid-view.tsx:192, treegrid.ts:283` | every fixture, after a selection |

## Components table and details header

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| Presence mark: dashed square, 'NO RUN TO COMPARE' <br> *load bearing* | `index.hasRuntimeEvidence === false` | `apps/web/src/ui/presence.tsx:39` | flask, express, axios, demonstration-system, anthropic-quickstarts, vercel-ai-chatbot, langgraphjs, openai-agents-js, langgraph, crewai, openai-agents-python, pydantic-ai |
| Presence mark: filled square, 'EXERCISED' <br> *load bearing* | `hasRuntimeEvidence && presence.runtime && !neverExercised.has(id)` | `apps/web/src/ui/presence.tsx:48` | demo-populated (14), vercel-ai-chatbot-exercised (1), pydantic-ai-exercised (2) |
| Presence mark: hollow square, 'NEVER EXERCISED' <br> *load bearing* | `hasRuntimeEvidence && (neverExercised.has(id) \|\| !presence.runtime)` | `apps/web/src/ui/presence.tsx:45` | demo-populated (18), vercel-ai-chatbot-exercised (40), pydantic-ai-exercised (1 950) |
| Presence mark: filled square, 'RAN, NEVER DECLARED', the delta this product exists to find <br> *load bearing* | `presence.runtime && !presence.static && !presence.manifest` | `apps/web/src/ui/presence.tsx:42` | demo-populated (1), vercel-ai-chatbot-exercised (2), pydantic-ai-exercised (1) |

## Details panel

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A fully populated component: description, identity list, configuration fields, locations, both relation lists, scenarios, metrics, permissions, findings <br> *load bearing* | `description, details, sourceLocations, edges, metrics, permissions and findings all non-empty` | `apps/web/src/ui/component-details.tsx:321` | demo-populated |
| Both relation lists empty at once: the panel for a component the map cannot draw <br> *load bearing* | `outgoing.length === 0 && incoming.length === 0` | `apps/web/src/ui/component-details.tsx:390, 411` | anthropic-quickstarts (36 prompts), openai-agents-python (1 091), crewai (693) |

## Details panel, header

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| No description paragraph at all <br> *load bearing* | `component.description === undefined` | `apps/web/src/ui/component-details.tsx:334` | anthropic-quickstarts (all 53), openai-agents-python (1 239 of 1 390), crewai (772), flask (all 4) |

## Details panel, identity list

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| 'Declared in' as a joined phrase: one, two or three sources <br> *ordinary* | `any combination of component.presence.static, .manifest, .runtime` | `apps/web/src/ui/component-details.tsx:345` | flask (source only), demonstration-system and demo-populated (18 with a manifest), demo-populated and the exercised bundles (runtime combinations) |
| 'Declared in: not recorded', a component that claims no origin <br> *edge* | `!presence.static && !presence.manifest && !presence.runtime` | `apps/web/src/ui/component-details.tsx:353` | **nothing here.** Set all three presence flags false on one flask component |
| 'Side effect class: not classified' <br> *load bearing* | `component.sideEffect === undefined` | `apps/web/src/ui/component-details.tsx:356` | openai-agents-python (1 387 of 1 390), anthropic-quickstarts (52 of 53), crewai (981 of 987) |
| The Tags row appears or is dropped entirely <br> *ordinary* | `component.tags.length === 0 versus > 0` | `apps/web/src/ui/component-details.tsx:363` | present in nearly every fixture; absent in openai-agents-js (6 components) and openai-agents-python (14) |
| The Aliases row, listing merged identities and the reason each was merged <br> *ordinary* | `component.aliases.length > 0` | `apps/web/src/ui/component-details.tsx:366` | **nothing here.** No corpus bundle carries an alias. Add one alias entry to a demo-populated component |

## Details panel, configuration group

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| No '<Kind> configuration' group at all <br> *load bearing* | `component.details === undefined, or every key is 'for', null or undefined` | `apps/web/src/ui/component-details.tsx:123, 139` | express (all 5), crewai (197), pydantic-ai-exercised (250) |
| A configuration group of mono definition rows, arrays comma-joined and booleans said as yes or no <br> *load bearing* | `component.details has a key other than 'for' with a value` | `apps/web/src/ui/component-details.tsx:142, 109` | openai-agents-python (modelId, provider, streaming, temperature, transport, command, approvalRequired), vercel-ai-chatbot, crewai |
| A url row bound to a real anchor because the scheme is http or https <br> *ordinary* | `details.url parses to an http, https or file address` | `apps/web/src/ui/component-details.tsx:135, ui/safe-link.tsx:30` | openai-agents-js and openai-agents-python (https://mcp.deepwiki.com/mcp, http://localhost:3000) |
| A url row rendered as inert text because the repository supplied a scheme the page will not bind <br> *ordinary* | `safeHref(details.url) === null` | `apps/web/src/ui/safe-link.tsx:18` | **nothing here.** Set an mcp_server component's details.url in openai-agents-js to a javascript: or data: address |

## Details panel, Where it was found

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| No source and no configuration location: one note under the heading and an empty list <br> *load bearing* | `sourceLocations.length === 0 && configLocations.length === 0` | `apps/web/src/ui/component-details.tsx:155` | vercel-ai-chatbot-exercised (2 components), pydantic-ai-exercised (1) |
| A single source location, a file and a line <br> *load bearing* | `sourceLocations.length === 1 && configLocations.length === 0` | `apps/web/src/ui/component-details.tsx:159` | flask (every component) |
| Configuration locations, shown as a file and a JSON pointer with no line <br> *ordinary* | `configLocations.length > 0` | `apps/web/src/ui/component-details.tsx:172` | demonstration-system (18), demo-populated (18) |
| A list of 192 locations, each with its own action control, dominating the panel <br> *load bearing* | `sourceLocations.length is large` | `apps/web/src/ui/component-details.tsx:159` | pydantic-ai-exercised (192), langgraphjs (144), langgraph (131), openai-agents-python (120), crewai (111) |
| An enabled 'Open source location' button per location, and a result line after it is pressed <br> *load bearing* | `capability open_source_location declared && available` | `apps/web/src/ui/actions.tsx:53` | demo-populated |
| A disabled button with 'a standalone export cannot open a local editor' repeated under every location <br> *load bearing* | `capability declared && !available` | `apps/web/src/ui/actions.tsx:64` | flask, express, axios, demonstration-system, anthropic-quickstarts, vercel-ai-chatbot, vercel-ai-chatbot-exercised, langgraphjs, openai-agents-js, langgraph, crewai, openai-agents-python, pydantic-ai, pydantic-ai-exercised |
| No control at all beside a location <br> *ordinary* | `the bundle's capabilities array has no open_source_location entry` | `apps/web/src/ui/evidence-list.tsx:26` | **nothing here.** Delete the open_source_location entry from any bundle's capabilities array |

## Details panel, Outgoing relations

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| 'This component calls nothing that the report could see.' with a nought in the eyebrow <br> *load bearing* | `index.outgoing.get(id) === undefined` | `apps/web/src/ui/component-details.tsx:390` | every fixture; it is the majority case in openai-agents-python and crewai |
| A hub with 119 relation rows, each four lines deep, below the fold for the rest of the panel <br> *load bearing* | `outgoing.length is large` | `apps/web/src/ui/component-details.tsx:393` | langgraph (119), pydantic-ai (80), pydantic-ai-exercised (80 out, 117 in) |

## Details panel, Incoming relations

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| 'Nothing the report could see calls this component.' <br> *load bearing* | `index.incoming.get(id) === undefined` | `apps/web/src/ui/component-details.tsx:411` | every fixture |

## Details panel, a relation row

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| 'no reliability policy recorded' <br> *load bearing* | `edge.policy === undefined, or every field of it is undefined` | `apps/web/src/ui/component-details.tsx:37, 59` | flask, express, axios, anthropic-quickstarts, vercel-ai-chatbot, langgraphjs, langgraph, openai-agents-js, openai-agents-python and most rows everywhere |
| A policy that is only a retry clause, bounded or unbounded, with its backoff and idempotency <br> *ordinary* | `edge.policy.retry !== undefined && timeoutMs === undefined` | `apps/web/src/ui/component-details.tsx:48` | crewai, pydantic-ai, pydantic-ai-exercised, demonstration-system, demo-populated |
| 'retry no attempt ceiling', where a missing maxAttempts is said in words rather than left out <br> *ordinary* | `edge.policy.retry.maxAttempts === undefined` | `apps/web/src/ui/component-details.tsx:47` | pydantic-ai, pydantic-ai-exercised |
| A policy sentence carrying a timeout, a retry clause and an approval requirement <br> *ordinary* | `timeoutMs, retry and requiresApproval all present` | `apps/web/src/ui/component-details.tsx:41` | demonstration-system, demo-populated |
| A policy naming a concurrency limit <br> *edge* | `edge.policy.concurrency !== undefined` | `apps/web/src/ui/component-details.tsx:55` | **nothing here.** Add concurrency to one edge policy in demo-populated |
| 'Never observed in a run.' <br> *load bearing* | `edge.observation === undefined` | `apps/web/src/ui/component-details.tsx:91` | every fixture except demo-populated and pydantic-ai-exercised, and most rows in those |
| A counted line: executions, errors, retries and total duration <br> *load bearing* | `edge.observation !== undefined` | `apps/web/src/ui/component-details.tsx:94` | demo-populated (19 edges), pydantic-ai-exercised (2) |
| 'observed only, absent from the static model' in the meta line <br> *load bearing* | `edge.runtimeOnly === true` | `apps/web/src/ui/component-details.tsx:88` | demo-populated (7 edges), pydantic-ai-exercised (2) |
| The other end is named by raw identifier because the graph does not carry it, and pressing it lands on the details refusal <br> *ordinary* | `index.componentsById.get(edge.to) === undefined` | `apps/web/src/ui/component-details.tsx:83` | **nothing here.** Point one flask edge's `to` at an identifier the graph does not carry |

## Details panel, Scenarios it appeared in

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| 'No ingested run produced evidence naming this component.' under a nought, even when the report has runs <br> *load bearing* | `index.scenarioIdsByComponent.get(id) === undefined` | `apps/web/src/ui/component-details.tsx:288` | every fixture, including vercel-ai-chatbot-exercised and pydantic-ai-exercised whose runs carry no scenarioId |
| Scenario identifiers in mono with their names beside them <br> *load bearing* | `scenarioIdsByComponent.get(id).length > 0 && scenariosById has each` | `apps/web/src/ui/component-details.tsx:294` | demo-populated |
| A scenario identifier followed by 'not defined in this bundle' <br> *edge* | `scenariosById.get(id) === undefined for a derived scenario id` | `apps/web/src/ui/component-details.tsx:296` | **nothing here.** Set runs[0].scenarioId in vercel-ai-chatbot-exercised to an id that is not in bundle.scenarios |

## Details panel, Measured cost

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| 'This report contains no runs, so nothing about this component was measured.' <br> *load bearing* | `metrics undefined && !index.hasRuntimeEvidence` | `apps/web/src/ui/component-details.tsx:216` | flask, express, axios, demonstration-system, anthropic-quickstarts, vercel-ai-chatbot, langgraphjs, openai-agents-js, langgraph, crewai, openai-agents-python, pydantic-ai |
| 'produced no runtime measurements in the ingested runs. That is an absence of measurement rather than a measurement of nothing.' <br> *load bearing* | `metrics undefined && index.hasRuntimeEvidence` | `apps/web/src/ui/component-details.tsx:215` | pydantic-ai-exercised (1 950 of 1 953), vercel-ai-chatbot-exercised (40 of 43), demo-populated (18 of 33) |
| Nine measured rows, with p95 and Cost each able to read 'not measured' on their own <br> *load bearing* | `index.metricsByComponent.get(id) !== undefined` | `apps/web/src/ui/component-details.tsx:225` | demo-populated, vercel-ai-chatbot-exercised, pydantic-ai-exercised |
| A measured component whose Cost row still says 'not measured' because no price covered it <br> *load bearing* | `metrics.costUsd === undefined` | `apps/web/src/ui/component-details.tsx:238, ui/primitives.tsx:375` | demo-populated, vercel-ai-chatbot-exercised, pydantic-ai-exercised (every measured component in the corpus) |

## Details panel, Permissions

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| 'No permission was discovered for this component. That is not proof it has none.' <br> *load bearing* | `component.permissions.length === 0` | `apps/web/src/ui/component-details.tsx:188` | every fixture; only 2 to 21 components per bundle carry a permission |
| A permission list of kind, mono scope and mode, up to six entries <br> *ordinary* | `component.permissions.length > 0` | `apps/web/src/ui/component-details.tsx:193` | pydantic-ai and pydantic-ai-exercised (6), openai-agents-python (5), anthropic-quickstarts (1) |

## Details panel, Findings naming this component

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| 'No finding names this component.' <br> *load bearing* | `index.findingsByComponent.get(id) === undefined` | `apps/web/src/ui/component-details.tsx:256` | every fixture; the whole of flask, express and axios beyond one component |
| A list of findings, each a severity mark and a button that leaves the map for the Findings screen <br> *load bearing* | `findingsByComponent.get(id).length > 0` | `apps/web/src/ui/component-details.tsx:259` | demo-populated (up to 12 on one component), demonstration-system, openai-agents-python |

## Details panel, header meta and relation rows

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| The basis chip reads Discovered or Observed; the other four classes and the unknown fallback never appear on this screen <br> *ordinary* | `component.basis / edge.basis` | `apps/web/src/basis.ts:83` | every fixture (discovered); demo-populated, vercel-ai-chatbot-exercised, pydantic-ai-exercised (observed, 21 records across the corpus) |

## Details panel and Confidence column

| State | When | Where | Shown by |
| --- | --- | --- | --- |
| A confidence of exactly 1 prints as '1' where every other value prints to two places <br> *edge* | `Number.isInteger(component.confidence)` | `apps/web/src/format.ts:39` | **nothing here.** Set one flask component's confidence to 1 |

## What a designer needs to know beyond the list

FIXTURE CACHE IS STALE FOR THE LARGE REPOSITORIES, AND IT CHANGES WHICH STATES YOU CAN SEE TODAY. Layout coordinates are baked into the bundle by the CLI (packages/report/src/bundle.ts:87). The ring layout in packages/report/src/layout.ts is uncommitted working-tree work, and only demonstration-system.json and demo-populated.json in corpus/.cache/bundles have been regenerated with it. Every other cached bundle still carries a coordinate for EVERY component, so rendering it today gives you the census-complete sentence, no dangling note, and a canvas that draws 1953 nodes. Regenerate before designing against the census or the dangling note. The drawn column in the brief's table is also not what the current code draws: it counts components touched by any edge, while the layout positions only components touched by one of the 16 LAYOUT_EDGE_KINDS. Recomputed with the current code the drawn counts are crewai 150 (not 294), langgraph 288 (not 547), langgraphjs 329 (not 578), openai-agents-python 298 (not 299); the rest of the table matches.

THE CENSUS SENTENCE IS CONTRADICTED BY THE TABLE BESIDE IT. 'The rest take part in no relation, so there is no topology to draw them into' is false for 144 components in crewai, 259 in langgraph, 249 in langgraphjs and 1 in openai-agents-python. Those take part in a containment relation or a self relation, are not positioned, and show a non-zero Relations count in the very table the sentence points the reader at. Either the sentence needs a second clause about containment, or containment needs to shape the layout.

THE CANVAS HINT AND THE DANGLING NOTE DISAGREE BY CONSTRUCTION. The hint counts visibleEdges, which is filtered on visible components only, so it says '243 of 243 relations drawn' on crewai while the note under the legend says 104 are not drawn. The note's own wording, 'name a component that is not in this graph', is wrong: those components ARE in the graph, they are only unpositioned. No corpus bundle has an edge pointing outside its component set, so the sentence describes a case that has never occurred while being shown for one it does not describe.

ABSENCE VERSUS ZERO IS ARGUED CAREFULLY EVERYWHERE AND THEN COLLAPSES VISUALLY. The legend states 'an outlined node was not measured, which is not a value of zero'. In the drawing, an unmeasured node is a 3px ring in the outline grey and a node at the bottom of the ramp is a 3px disc in the same outline grey (overlay.ts:36 makes ramp.from the outline colour; graph-canvas.tsx:221 discards NEUTRAL_COLOR and uses sheet plus outline instead). At a 3px radius with an 18% border these are a sub-pixel apart. demo-populated's latency, tokens, errors and retries overlays all contain real zeros beside real absences, so this is the common case rather than a corner.

THE MOST COMMON OVERLAY STATE IN THE CORPUS IS THE DEGENERATE ONE. Twelve of the sixteen bundles have an architecture overlay whose every value is zero, so selecting the default overlay paints every node identically at the ramp's midpoint and prints '0' five times in the legend under five different swatches. Any design for the legend has to survive a flat range, not only a spread one.

TWO PATHS THROUGH THIS SCREEN ARE DEAD CODE. missingComponentCells in the treegrid (the 'referenced but absent from the graph' row) can never fire, because TreeGridView is only ever handed components from the same bundle. The 'This report carries no overlays' note can never fire either, because the pipeline always emits the architecture overlay. Both are worth keeping in the design record as intent, but neither will appear in a screenshot.

SCALE IS CARRIED BY THE DETAILS PANEL MORE THAN BY THE MAP. The worst case is not 1953 nodes, it is one component with 192 source locations, each rendering a disabled capability button and a repeated reason paragraph (pydantic-ai-exercised), or one hub with 119 relation rows four lines deep (langgraph). Neither has a ceiling, a window or a disclosure. The map has a ceiling at 120 and the table has one at 200 rows; the details panel has none anywhere.

THE MAP IS THE DESTINATION FOR FIVE OTHER SCREENS. Findings, Performance, Comparisons, Overview and Goals all call selectComponent(id, {goToMap: true}), which writes #/map?component=<id> and lands here. A selection can therefore arrive for a component that has no position, that the current filters hide, or that is not in the graph at all, and the details panel is the only block that always responds to it. Selecting on the canvas itself does not write the fragment, so a selection made here is not linkable while one arriving from elsewhere is.

PLURALS AND GRAMMAR ARE HANDLED IN ONE PLACE AND NOT THE OTHERS. The search field uses pluralise and gets it right. The match-count line, the canvas hint, the dangling note and the census sentence all interpolate raw counts into fixed plural wording, so a report with one relation reads '1 relations' and a one-component repository reads 'Every one of the 1 components'.

WHAT IS NOT DESIGNED YET, IN ORDER OF HOW OFTEN A READER WILL MEET IT: the above-ceiling canvas (7 of 16 fixtures, where the drawing has no names at all and the note is the only thing carrying meaning); the sparse overlay (a field of near-invisible rings around two discs, e.g. permissions on anthropic-quickstarts); the isolated-component details panel (the majority case in openai-agents-python and crewai, where five of the eight groups say some form of 'nothing here'); and the standalone export's repetition of a disabled action and its reason once per source location."

