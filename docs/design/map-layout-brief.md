# The map: a hover label nobody can read, and one layout where there should be a choice

Paste the block below into a new chat. Everything it references is in this repository.

---

I want two things done to the system map in `apps/web`: one defect fixed, and one capability designed and
built. Work in `/Users/glendonchin/dev/Technology/orchescope`.

**Read first:** `AGENTS.md` for the hard rules, `docs/design/report-system.md` for what the workspace is
built from and why, especially the section on the map, and `docs/design/states/README.md` plus
`docs/design/states/system-map.md`, which list the 133 states this screen can be in and the 15 constants
that switch between them. Then `pnpm build:web && pnpm states && open states/index.html` and look at the
real thing across sixteen real reports before changing anything. The map is the screen those reports
differ on most: 4 drawn in `flask`, 26 in `demo-populated`, 150 in `crewai`, 417 in `openai-agents-js`,
679 in `pydantic-ai-exercised`.

## One: the hover label is unreadable in the dark theme

Hover a node on any report and the name appears in a white box. In the dark theme the label text is
`--ink`, which is `#e9ecf2`, so it is near-white text on a white box. `apps/web/src/styles.css:99`.

The cause is not our code. `drawDiscNodeHover` in sigma 3.0.3 hardcodes its own colours:

```js
context.fillStyle = "#FFF";      // dist/index-fad77a13.esm.js:666
context.shadowColor = "#000";
context.shadowBlur = 8;
```

`apps/web/src/ui/graph-canvas.tsx` already reads the palette out of the stylesheet with `readPalette`,
already passes `labelColor` from it, and already re-reads it when the theme attribute changes, so the
text colour is right and only the box is wrong. Sigma exposes `defaultDrawNodeHover` and
`defaultDrawNodeLabel` as settings, so the fix is a renderer of ours that uses the palette we already
have. Fix the drop shadow in the same change: nothing else in this design system casts one, and the
palette has `--sheet` for a surface that has to separate from the page and `--rule` for the hairline
around it.

While you are in there, check the same question for every other thing sigma draws with a colour it chose
rather than one we gave it, and check both themes. `readPalette` is the seam; anything that does not go
through it is a candidate.

## Two: one layout where there should be a choice

The map has exactly one layout, a concentric ring. I want the reader to be able to choose, including a
left to right and a top down arrangement, because a ring does not show direction of flow and those do.

Before you build it, read the evidence against it, because part of this was already decided with
measurements and I do not want it relitigated blindly.

Phase 20 in `PLANS.md` removed `@dagrejs/dagre` and replaced a layered layout with the ring, and the
reason was measured rather than aesthetic. Every agent system in the pinned corpus is hub and spoke, with
a median degree of one or two and a busiest degree of 18, 24 and 98 in the three reference repositories. A
layered layout puts every leaf of a hub in a single rank, so the drawing grows in one direction only:

| repository | connected | layered | concentric |
| --- | --- | --- | --- |
| demonstration | 26 | 1152 x 1783 | 795 x 798 |
| openai-agents-python | 298 | 848 x 19050 | 2997 x 3000 |
| langgraphjs | 329 | 1456 x 20066 | 3199 x 3200 |

A ribbon of aspect 0.045 rendered into a canvas of aspect 2.3 is what a reader saw as a column of dots. I
watched the same failure again this week from a different cause, so I know exactly what it looks like and
I do not want it back as a menu item.

So the interesting question is not "add layered back". It is: **where is a directional layout actually
better, and can the map offer it only there?** My own guess, which you should test rather than accept, is
that the measurement above is about whole corpus graphs and that the answer changes for a small graph and
for a filtered subgraph, which is most of what a reader actually looks at. A reader who has filtered to
`Agent` and `Calls tool` is looking at a handful of nodes where direction is the whole point. Gather that
evidence the way phase 20 gathered its evidence: lay the corpus graphs out both ways at several filter
settings, report the aspect ratios and what they do to the canvas, and let the numbers pick the rule.

### The constraints this has to live inside

- **Determinism has to survive.** `AGENTS.md` and `report-system.md` both state it: coordinates are
  computed in the CLI and baked into the bundle so the same graph gives the same map on every machine.
  `packages/report/src/layout.ts` computes them, `withLayout` in `packages/report/src/bundle.ts` bakes
  them into `component.metadata.layoutX` and `layoutY` plus `graph.metadata.layoutWidth`,
  `layoutHeight` and `layoutFallback`, and `apps/web/src/layout.ts` reads them back with
  `resolveLayout`. That last function is the seam a picker extends.
- **`apps/web` may import only `@orchescope/schema`, and only for types.** `pnpm deps` fails otherwise.
  So the layout algorithm cannot simply be called from the browser. Either bake every offered layout in
  the CLI under its own metadata key and let the browser switch between precomputed sets, or move the
  algorithm somewhere both can reach and argue for why. Baking is the option that costs no determinism
  and no boundary; say what it costs the bundle, per component per layout, at 1953 components.
- **Adding a layout invalidates the naming rule's derivation.** `apps/web/src/map-names.ts` decides
  whether the canvas names anything from `drawn * cameraRatio <= 120`, and that 120 comes from the
  circumference of a ring: the outermost ring of a drawing fitted into a canvas of height H has radius at
  most H/2, so neighbours have about `2200 / k` pixels between them. A layered drawing has a completely
  different relationship between node count and neighbour spacing. Either generalise the rule to take the
  layout's own reported extent, or state per layout what the room actually is. Do not leave a rule derived
  from a circle deciding a rectangle.
- **`pnpm states` refuses a bundle it cannot trust** by recomputing the layout and comparing against the
  baked coordinates, which is how a stale bundle stopped being rendered as a broken map. If a bundle can
  carry more than one layout, that check has to know which one it is comparing, or it will start refusing
  everything.
- **The picker is a control, so it follows the control rules.** A layout the bundle does not carry is
  either absent or disabled with its reason shown, never a control that fails when pressed. See
  `apps/web/src/capabilities.ts` and `apps/web/src/ui/actions.tsx` for how the existing ones do it. The
  overlay select at the top of the map screen is the closest precedent for the control itself.
- **Assemble it from the existing primitives.** `apps/web/src/ui/primitives.tsx` holds ten of them and
  `report-system.md` says a style that is not in that set is a signal to stop and argue for it. A layout
  picker should need no new vocabulary.
- **Whatever the canvas can say, the table has to say too.** The canvas is hidden from assistive
  technology and `apps/web/src/ui/treegrid-view.tsx` is the primary representation. A layout that is only
  a picture is unreachable by keyboard. If a directional layout reveals something real, work out what the
  table's equivalent of it is.

### What must still pass

`pnpm verify`, at 723 unit and integration tests and 92 end to end, `pnpm test:ui` at 13 browser
tests, and `pnpm package`. `packages/report/test/layout.test.ts` holds nine properties of the ring: a star
of 8, 40, 200 or 600 leaves stays within an aspect of 0.7 to 1.4, the drawing grows with the square root
of the count rather than the count, nothing depends on the order components arrive in, and every
positioned node sits inside the reported extent. A second layout needs its own equivalent set, and the
properties will not be the same ones, which is itself worth writing down. `tests/ui/workspace.spec.ts`
holds that the map's table carries the same components as the canvas, that filters narrow both, and that
nothing scrolls sideways at 390px.

Run `pnpm states` after every change and look at more than one report. This screen has been broken twice
in a week in ways the demonstration could not show, because at 26 components it sits under every ceiling
the canvas has.

### How to work

1. Fix the hover label first. It is small, it is unambiguous, and it ships today.
2. Then gather the layout evidence and show it to me before building the picker. Numbers, not
   screenshots of your preference.
3. Then design the control and the rule for when each layout is offered, and say which reports the
   evidence says each one is for.
4. Then build it, and say what moved in `report-system.md`, in `docs/design/states/system-map.md` and in
   the states catalogue's threshold table, because all three describe a single layout.
