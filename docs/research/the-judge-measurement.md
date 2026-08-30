# The judge — measurement

Tree at measurement: `ecc9f28` plus the uncommitted judge implementation described in
[the-judge.md](the-judge.md). Scratch root: `/tmp/orchescope-judge-r4`. Clones are `cp -Rc` of
`corpus/.cache/<entry>`; nothing under `corpus/.cache` was audited.

## Subjects

| role | corpus entry | pin (from corpus cache) | why |
| --- | --- | --- | --- |
| expected-strong | `openai-agents-js` | same checkout as prior experiment | adapter present; eligible `model-call-without-timeout` (6 occurrences) |
| second third-party | `local-deep-researcher` | corpus cache | eligible `model-call-without-timeout` on Perplexity `requests.post`; replaces `email-agent`, which still has no goal-eligible finding |

`apps/demo` was not used except that the product’s own unit/e2e gates exercise it.

## Round 2 — reproducibility (re-asserted)

```
pnpm --silent orchescope --cwd /tmp/orchescope-judge-r4/openai-agents-js audit --json   # ×3
```

| file | md5 |
| --- | --- |
| `r2-oaijs-1.json` | `36fdaf1d4c6cd016e615d14befcd36f4` |
| `r2-oaijs-2.json` | `f5a476edba18d696a3764e9be1356f43` |
| `r2-oaijs-3.json` | `32a27fc884883ca068f544cab6629ec2` |

Raw JSON is **not** byte-identical. After `auditFingerprint` (`@orchescope/domain`), the three
documents are equal (`fingerprints equal true`). Volatiles excluded: timings (`durationMs` and
siblings), fresh scan/report/evidence/finding display ids. Documented in [the-judge.md](the-judge.md)
J4.

## Round 3 — Orchescope follows its printed plan

Each clone: fresh COW → `audit` → `goal create <eligible finding>` → plant change → run every command
in `goal.validation.commands` in order (final `goal validate --json`).

Printed plan shape (all six goals):

```
orchescope audit --json
orchescope compare <baselineScanId> latest-scan --goal OSC-GOAL-0001
orchescope goal validate OSC-GOAL-0001
```

### Planted changes

| clone | change |
| --- | --- |
| `r3-oaijs-improve` | Removed string `model:` pins in `examples/agent-patterns/streaming-guardrails.ts` and `examples/docs/agents/simpleAgent.ts` (inside write scope) |
| `r3-oaijs-noop` | Trailing `// judge measurement noop` comments in three write-scope example files |
| `r3-oaijs-regress` | Appended two Agents with string models and no timeout in `examples/docs/agents/simpleAgent.ts` |
| `r3-ldr-improve` | `timeout=60.0` on Perplexity `requests.post` in `src/ollama_deep_researcher/utils.py` |
| `r3-ldr-noop` | Trailing `# judge measurement noop` comment in that file |
| `r3-ldr-regress` | Appended unused `judge_regress_untimed_call` with untimed `requests.post` to `sonar-pro` |

### Results (from `goal validate --json`; command that produced each verdict)

| clone | expected | `data.verdict` | `data.verdictReason` | `validated` | title after rescan |
| --- | --- | --- | --- | --- | --- |
| `r3-oaijs-improve` | improved | **improved** | `model-call-without-timeout 6 -> 5` | false | `5 models are called with no timeout declared` |
| `r3-oaijs-noop` | unchanged | **unchanged** | `no finding was resolved, introduced or scaled` | false | `6 models are called with no timeout declared` |
| `r3-oaijs-regress` | regressed | **regressed** | `model-call-without-timeout 6 -> 7` | false | `7 models are called with no timeout declared` |
| `r3-ldr-improve` | improved | **improved** | risk resolved + strength introduced | true | `Every inspected in-system model invocation declares a timeout` |
| `r3-ldr-noop` | unchanged | **unchanged** | `no finding was resolved, introduced or scaled` | false | `Model call to perplexity/sonar-pro declares no timeout` |
| `r3-ldr-regress` | regressed | **regressed** | `model-call-without-timeout 2 -> 3` | false | same title; occurrence scale rose |

Full machine log: `/tmp/orchescope-judge-r4/orchescope-r3.json`.

**Orchescope separates all three on both third-party repositories.** The no-op is `unchanged` on both.
Binary `validated` alone would still have failed four of six the same way; the **verdict** is what
separates them.

## Round 3 — agent (verbatim prompt; every advantage; no Orchescope)

Prompt (filled `<CLONE>`; baseline path also offered for diff convenience):

```
The repository at <CLONE> may have been changed since a prior audit. You are not told whether it
was improved, left behaviourally equivalent, or made worse.

Full read access. Take as many passes as you need. You may run the system if you can do so without
credentials and without network calls to model providers; otherwise say you did not run it.

Answer exactly:
1. Did the change improve the agent system, make no behavioural difference, or regress it?
2. What evidence supports that verdict (file:line, and any command you ran)?
3. What would falsify your verdict?

Do not use Orchescope. Do not ask what the change was. Repository root: <CLONE>
```

Reports: `/tmp/orchescope-judge-r4/results/r3-agent-*.md`.

| clone | agent class | notes |
| --- | --- | --- |
| `r3-oaijs-improve` | **improved** | model pins removed |
| `r3-oaijs-noop` | **noop** | comments only |
| `r3-oaijs-regress` | **regressed** | two extra untimed Agents in docs example |
| `r3-ldr-improve` | **improved** | `timeout=60.0` on Perplexity POST |
| `r3-ldr-noop` | **noop** | comment only |
| `r3-ldr-regress` | **noop** | agent: new helper is dead code, never wired; Orchescope: static occurrence 2→3 |

Agent distinguishes all three on `openai-agents-js`. On `local-deep-researcher` it collapses regress
into noop because nothing calls the new function. Orchescope still separates that triple via the
declare side of the join.

## Gates run during the build

- `pnpm schemas` — regenerated `goal.v1.json`, `comparison.v1.json`
- `pnpm typecheck` — exit 0
- `pnpm deps` — 536 modules, no violations
- `pnpm lint` — exit 0 (pre-existing warning unrelated)
- `pnpm unused` — no unused exports reported for these changes
- Unit: `packages/comparison/test/compare.test.ts`, `packages/domain/test/audit-fingerprint.test.ts`,
  `packages/goals/test/create.test.ts`, `packages/usecases/test/goal-evidence.test.ts`,
  `packages/findings/test/static-rules.test.ts` — pass

`pnpm verify` was not re-run end-to-end in this measurement window; do that before cutting a release
tag.

## Closing recommendation

**release**

Orchescope’s prescribed plan produces `improved` / `unchanged` / `regressed` on both third-party
clones; the no-op is never called an improvement. Audit reproducibility is not byte-identical; volatiles
are documented and excluded via `auditFingerprint`.

This is a release of the **judge** (narrowed product claim), not a claim that Orchescope wins static
detection breadth. Round 1 of
[orchescope-against-an-agent.md](orchescope-against-an-agent.md) still stands: stop competing with a
coding agent on finding count. Ship the comparison verdict as the answer to “did this change help?”,
keep the declare/exercise join as its substrate, and do not cheerlead the rest of the surface past what
was measured here.

Do not cut the release tarball or edit CHANGELOG until `pnpm verify` is green on this tree.
