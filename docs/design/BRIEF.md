# Report workspace redesign: brief for the implementing session

Paste the block below into a new chat. Everything it references is in this repository.

---

I want to redesign the browser report workspace in `apps/web` end to end: research the current state, plan
it, then implement it. Work in `/Users/glendonchin/dev/Technology/orchescope`.

**Read first:** `AGENTS.md` for the hard rules, `PLANS.md` for where the product is, and
`docs/design/report-direction.mock.html`. Open that mock in a browser before writing anything. It is a
static mock of the Overview screen plus a component sheet, using real numbers from `apps/demo`. It is the
agreed direction, not a file to ship.

## What is wrong today

Every panel is the same bordered box and every number is the same tile, so the inventory count and the
declared-against-exercised delta carry identical visual weight. The delta is the product's entire thesis
and it is the third panel down. The section tabs are numbered 1 to 8, which implies a sequence that does
not exist. Detail that belongs behind a click is on the page at all times.

## The direction, already decided

**One idea: fill means evidence.** A filled shape was measured in a run. A hollow outline was only
declared. That rule holds on the delta bar, the map nodes, the components table and every badge. It is the
visual form of the rule `AGENTS.md` already states, that an inference is never presented as an
observation. Evidence is carried by form, never by hue, so it survives greyscale and colour blindness.

**Type.** Manrope for prose, JetBrains Mono for every number, both SIL OFL and both self hosted. Weight is
a function of size: 200 only at 24px and above, 400 for body at 14px, 500 for headings, mono 300 and 400
for data with tabular figures. Thin below 24px stops reading, especially light on dark.

**Palette.** Six greys and two alert hues. The alert hues are used only for severity. Nothing else on the
page has a colour.

**Layout.** A left rail with section names and counts, no numbering. The delta is the hero: one bar, one
cell per declared component, filled where a run reached it, with the component that ran but was never
declared placed past a dashed boundary rather than tinted a third colour. Supporting numbers are one ruled
row, not five boxes. Findings are one line each and expand to evidence, fix and effort.

**Components.** Build a real primitive set and assemble every screen from it: eyebrow, display, figure,
data, basis chip, severity marker, bar cell, ruled stat, disclosure row, refusal panel. The mock's bottom
section is that sheet. No screen gets a bespoke style that is not in the set.

Keep it restrained. Do not add decoration, filler copy or styles that no screen needs.

## Hard constraints, all currently enforced

- CSP is `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self';
  connect-src 'self'` in `packages/report-server/src/security.ts`. No `unsafe-inline`, no remote assets.
- `apps/web` may import only `@orchescope/schema`, and only for types. `pnpm deps` fails the build otherwise.
- The workspace renders untrusted text as text. No `innerHTML`, no inline styles with dynamic content.
- A control the configuration cannot perform is disabled with its reason shown, or absent. See
  `apps/web/src/capabilities.ts`.
- Every displayed number carries its basis: observed, discovered, inferred, estimated or simulated.
- No `TODO`, no placeholder implementations, no em dash characters anywhere.

## One decision to make early

The fonts must be vendored into `apps/web` as woff2. That satisfies `font-src 'self'` for the served
report. It does not satisfy the single file export: `renderStandaloneHtml` in `packages/report` inlines
everything, and a `data:` URI font is blocked by `font-src 'self'`. Either add `data:` to that directive
for the standalone case, or let the standalone export fall back to system fonts. Decide it, say which you
chose and why, and make the fallback stack good either way.

## The stack you are working in

Preact 10.29.7, sigma 3.0.3 and graphology 0.26.0 for the map, esbuild via `scripts/build-web.mjs`, plain
CSS in `apps/web/src/styles.css` (1527 lines, 479 custom properties). Eight sections under
`apps/web/src/sections/`, roughly twelve components under `apps/web/src/ui/`. Keep Preact. This is a design
pass, not a migration.

## How to work

1. Research the current state before changing it. Read the sections and the UI components, run
   `pnpm build:web` then `pnpm orchescope --cwd apps/demo audit --open`, and look at the real page. Run
   `pnpm tour` for the full loop if you want runtime data in it.
2. Plan the token system and the primitive set first, and show it to me before you write the sections.
3. Implement section by section. The delta and findings first, since they carry the thesis.
4. Every screen has an empty and a refusal state. Design them, do not leave gaps.

## What must still pass

`pnpm verify` and `pnpm test:ui`. The ten Playwright tests in `tests/ui/workspace.spec.ts` assert real
behaviour: every section reachable and self naming, the map's keyboard navigable table carrying the same
components as the canvas, filters narrowing both, a finding showing its basis and evidence, an
unavailable action explaining itself, no request to another origin, the shortcut panel opening by
keyboard, the theme control following the document, and navigation by landmarks and headings. If a test
needs to change because the markup changed, change it deliberately and say so. Do not weaken what it
asserts. Keyboard focus stays visible, reduced motion is respected, and the page stays responsive to
mobile.
