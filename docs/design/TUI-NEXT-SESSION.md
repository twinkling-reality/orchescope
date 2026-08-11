# Brief for the next session on the Orchescope terminal output

Copy this whole file into a new chat. It carries what is already settled so you do not re-litigate it,
and what has already failed so you do not repeat it. **Read the failures section before you design
anything.**

Work in `/Users/glendonchin/dev/Technology/orchescope`.

---

## What I want

The terminal output is not designed. It is a pile of sections that grew one at a time. Three specific
faults, in my words:

1. **The loader is in the wrong place.** The spinner sits inline at the front of a line of body text,
   in the same column as everything else, and then that line stays in the scrollback. A progress
   indicator is not a paragraph. It should live in its own region, at the side, and it should not
   leave sediment in the document once the work is done.
2. **There is too much of it.** 59 lines for `apps/demo`, 45 for `crewai`.
3. **Nothing is organised.** Sections repeat each other, the order is arbitrary, and there is no
   visual system holding them together.

Do not design this by guessing. Use a team of agents, working independently and then reconciled. At
minimum:

- one that inventories every section of the current output, measures it, and finds every place two
  sections state the same fact;
- one that studies the reference implementation named below and writes down its rules as rules;
- one that designs the composition against the real regimes, not against the demo;
- one that adversarially reviews the design against `AGENTS.md` and the constraints below and tries to
  find the rule it breaks;
- one that implements, and one that reviews the implementation against the design.

I would rather see three designed options with the trade named than one that gets iterated seven
times. Design it properly, present it whole, and be ready to defend it. Do not ask me which direction
to go.

## Read first, in this order

1. `AGENTS.md`
2. `docs/product/vision.md`
3. `docs/product/non-goals.md`
4. `docs/design/NEXT-SESSION.md`, which is the browser report brief. **The six failures it records are
   about the browser report and every one of them applies here.**
5. `docs/design/report-system.md`, for the vocabulary the browser workspace settled on.

## The reference implementation, and it is mine

`/Users/glendonchin/dev/Technology/workmap` is a terminal UI I wrote and like. Read
`workmap/tui/widgets.py`, `workmap/tui/text.py` and `workmap/tui/app.py`. Its rules, which the
Orchescope output has only partly adopted:

- Rounded frames, `╭ ╮ ╰ ╯ ─ │`, with an inline title on the left of the top rule and an optional tail
  on the right.
- **Borders recede, chips pop.** Border is grey 240. A chip is a solid ground, 238, with near white
  ink, 231, and bold. One amber, 208, spent only on something that genuinely needs attention.
- Every function returns a string of an exact display width, so a caller composes without measuring
  again. Widths are display columns, never `length`.
- Panels printed together are padded to a common bottom edge, because uneven edges read as a layout
  bug rather than as design.
- A command strip sheds items rather than truncating one, and the way out is pinned so a strip can
  never fail to tell you how to leave.
- A rail down the left, `▏` off and `▊` on.

## What is already settled. Do not re-open these.

**The product is a five step loop, and the audit is step one of five.** Audit finds a problem, a goal
states what to change and what would prove it, a person or coding agent makes the change, the same
scenario reruns with the same seed, and a comparison says whether it helped. The whole reason the tool
exists is step five. This is settled and the output is already built around it.

**Steps two to five have never run on a real repository.** Measured across the sixteen bundles in
`corpus/.cache/bundles`: 13 of 16 have no runs at all; only `demo-populated`, which is the project's
own fixture, has a benchmark, a chaos run, a comparison or a goal. Two real repositories have exactly
one run each, covering 15.8 per cent and 0.3 per cent of their components.

**There is no score out of 100, and there never will be.** Tracing can only add findings, so any
"percent good" falls every time somebody measures their system properly. Proven on the corpus:
`vercel-ai-chatbot` goes 4 findings to 7 and `pydantic-ai` goes 6 to 8 once a single run exists. The
honest fraction is **coverage of the check suite**, which fills as you measure. `crewai` reads
`7 of 18 checks ran`. `not_applicable` rules are excluded from both halves, because a rule with
nothing to say about a repository is not a check anybody is missing.

**Colour carries nothing.** Every state has a symbol and a word. The output must read identically in a
pipe, in a log and under `NO_COLOR`. Verify with `NO_COLOR=1` and by piping, every time.

## What has already been tried here, and rejected

- **Rewording.** Two full passes over the browser report rewriting every string into plain English.
  Verdict: *"no rewording or anything helps me understand it or its value at all"*. Wording was never
  the fault.
- **Leading with the join.** `7 of 21 things never ran` as the hero. It is a fact about the quality of
  our own measurement, not about the reader's system.
- **Inventing a picture out of counts.** A count is not a shape. Only three quantities in the entire
  corpus have a spread worth drawing: the coverage fraction, the severity mix, and self time, and self
  time has n=130 in exactly one bundle.
- **Adding density.** Percent, bar, supporting counts and a button on every tile. *"I see a million
  things at once but nothing rings out."*
- **Deleting everything.** The opposite over-correction. One flat rectangle with nothing on it. The
  sections were never the fault. What they held was.
- **An empty frame in place of a refusal.** Killed in adversarial review: a blank framed region is
  indistinguishable from a failed render, and `AGENTS.md` requires a missing measurement to stay
  visibly unavailable **with a reason and the command that would produce it**.

## Where it stands now

Built and passing. Run these two, in a real terminal, before you change anything:

```
pnpm --silent orchescope --cwd apps/demo audit
pnpm --silent orchescope --cwd corpus/.cache/crewai audit
NO_COLOR=1 pnpm --silent orchescope --cwd corpus/.cache/crewai audit
```

`apps/demo` is the small rich case, the only one where all five steps have data. `corpus/.cache/crewai`
is the large no-run case, 987 components, which is the regime 13 of 16 reports open in. Both matter and
the second one matters more.

The files that hold the output this produced:

| file | what it is |
| --- | --- |
| `packages/report/src/loop-progress.ts` | pure module: the five steps from bundle facts |
| `apps/cli/src/terminal/display-width.ts` | display columns, cutting, and sanitising a cell |
| `apps/cli/src/terminal/document-grid.ts` | the three anchors, the two tiers, the four row kinds |
| `apps/cli/src/terminal/source-headline.ts` | line one, the refusal, the adapter roster |
| `apps/cli/src/terminal/loop-rows.ts` | the five step rows and which supporting line survives |
| `apps/cli/src/terminal/join-rows.ts` | the fraction and the four deltas |
| `apps/cli/src/terminal/finding-rows.ts` | the heading, the ceiling, the rows, the caveat |
| `apps/cli/src/terminal/gap-rows.ts` | what could not be looked at |
| `apps/cli/src/terminal/run-rows.ts` | what to run, and what to write in a file |
| `apps/cli/src/terminal/audit-document.ts` | region order and the blank line rule |
| `apps/cli/src/terminal/progress-line.ts` | the transient row and the durable verbose row |
| `apps/cli/src/terminal/progress-renderer.ts` | when it is drawn, when it is erased |
| `apps/cli/src/terminal/panel.ts` | the rounded frame, now reached only by `report-ready.ts` |

Output on `apps/demo` after this pass, 25 lines on standard output and none on standard error,
produced by `pnpm --silent orchescope --cwd apps/demo audit`:

```
demo            33 components, 32 relations, 23 of 23 files read

1 audit         + done       21 of 22 checks ran
2 goal          + done       2 jobs written up
3 rerun         + done       1 of 3 scenarios has been run
4 measure       + done       10 runs recorded
                             8 faults injected, 1 broke the task
5 did it help   ! undecided  unchanged: no metric moved enough to call

join            15 of 22 parts a run could reach
join            7 declared components never exercised
join            1 exercised component never declared
join            0 contradicted declarations
join            1 duplicated external effect

findings        19 risks: 3 high, 6 medium, 10 low; 2 strengths
OSC-RES-0003    ! high       tool_timeout on issue_refund: a side…   1 simulated
OSC-REL-0005    ! high       Retry around issue_refund can repeat…  2 discovered
OSC-REL-0002    ! high       refund happened 2 times in one run      11 observed
OSC-REL-0003    ! medium     Model call to demo-small declares no…  4 discovered
OSC-SEC-0001    ! medium     2 consequential operations have no a…  6 discovered
OSC-ARCH-0001   ! medium     metering_record_usage runs without b…    5 observed
findings        13 more risks, in the report

run             orchescope test --scenario support-desk --repeat 5
```

### The diagnosis I would start from, and you should test rather than accept

**The output answers `what do I do` in three places and `what did you find` in three places.** That is
the same root fault the browser report had, reproduced in a terminal:

- what to do: the `what to run next` panel, the `next:` line at the very bottom, and the command inside
  every blocked step of the loop frame.
- what was found: `19 problems found` inside the loop frame, the `Findings` severity block, and the
  `Top findings` list.
- how much ran: `21 of 22 checks ran` in the frame, and the whole `Declared against exercised` block,
  which is step 4 of the loop restated as a section.

`Top findings` alone is 22 of the 59 lines and it is the least structured thing on the screen.

## The three faults, restated as questions for the team

1. **Where does progress live?** A spinner inline at the front of a body line, which then persists as
   four `+ Phase: summary` lines nobody rereads. What is the region model? Does progress get its own
   area, a right hand column, a status line, a frame that is torn down on completion? What survives
   after the work finishes, and why? Note that `+ Reconciling runtime evidence: 10 run(s) reconciled,
   130 component metric(s) attributed, 1 undeclared component(s), 0 contradiction(s)` is 118 characters
   of transient log presented as a result.
2. **What earns a line?** 59 lines and 45 lines are both too many. Decide what the default output is,
   what moves behind a flag or a second command, and say what a reader loses.
3. **What is the organising system?** Right now there are three different visual idioms on one screen:
   framed panels, `Heading` plus two space indented symbol lines, and a bare `next:` line. Pick one
   system and apply it, or state deliberately why a section is outside it.

## Constraints, all currently enforced. An agent that breaks one has produced work that cannot ship.

- **Evidence or silence.** Every displayed number carries its basis. A metric without a sample size is
  not reported. Never claim statistical significance.
- **Never fake completeness.** A missing measurement stays visibly unavailable with a reason and the
  command that would produce it. An empty region is not allowed to stand in for a refusal.
- **Not a fixer.** No auto-fix, no dismiss, no acknowledge. The tool produces a bounded goal.
- **Animate only while work runs.** A determinate count only when the total is known. Never invent a
  percentage. Respect `NO_COLOR`, and never animate when the output is not a terminal or under CI.
- **Bounded output always.** No unbounded list. Every ceiling is derived and the derivation is in a
  comment beside it.
- `packages/report` is core: it may not import from `usecases`, `workspace` or any app. `apps/cli`
  reaches storage through `workspace` and `usecases`, never directly. `pnpm deps` enforces this.
- Presentation modules select, sort, group and bound facts already in the bundle. **They never analyse
  again.** A verdict must come from `packages/comparison` or `packages/benchmark`, never from a
  renderer.
- One concept per file. No `utils`, `helpers`, `common`, `shared`. Split around 400 lines.
- Every new pure decision module needs tests, including the empty and refusal paths.
- **No em dash characters anywhere in the repository.**

## What must pass

```
pnpm verify
pnpm test:ui
pnpm package
```

`pnpm verify` runs `check`, `test` and `test:e2e`. If a markup or output change forces a test change,
change it deliberately, say so, and do not weaken what it asserts.

**Two known environment issues, neither yours:**

- `pnpm lint` currently aborts because a git worktree at `_rename-worktrees/orchescope` carries a
  nested `biome.json` root config. Either remove that worktree or run the other gates individually.
- `pnpm unused` fails at baseline on `knip.json` entry pattern hints, unrelated to any of this.

## Known and unfixed, carry these forward

- The `(s)` grammar slips are gone and the decision behind them was made. `formatCount` lives in
  `packages/domain/src/counting.ts`, because counting is a domain concern, `packages/domain` imports
  only `packages/schema` and `node:crypto`, and every layer above it may import it. There is one
  definition and `packages/usecases/src/audit.ts` uses it, so `10 runs reconciled` and
  `130 component metrics attributed` are what the progress line now says.
- The progress line under `--verbose` is cut at the stream width, so
  `reconciling runtime evidence: skipped, no run with trace data is stored` loses its last two words at
  eighty columns. Bounded output won over a complete log line and the bound is what is asserted. A
  second durable line, or a shorter phase summary in `packages/usecases`, would close it.
- A failed adapter's detail wraps at the last space that fits rather than at a clause, so a longer
  validator message still loses its tail after two rows. The JSON pointer survives, which is the part a
  reader acts on.
- `docs/design/TODO.md` holds the deferred reconciliation correction and five more items, each with its
  cost and what would decide it.
- The browser report at `apps/web` still exists and is untouched by this work. Whether it survives at
  all is an open question, and `docs/design/NEXT-SESSION.md` is its brief.

## How to report back

Say what you ran and what it printed. Show the output at 80 and 120 columns, in colour and under
`NO_COLOR`, and piped, for both `apps/demo` and `corpus/.cache/crewai`. Give me the line count before
and after. Say what is still weak. Do not claim success because the tests pass.
