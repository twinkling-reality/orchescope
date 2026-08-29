# Orchescope against an agent

The objection under test: *why would I not just ask my coding agent to audit my agent system,
since it reads any framework, covers more ground, and renders it visually?*

This document settles that by measurement. Recommending abandonment or narrowing is an expected
outcome. There is no "both have their strengths" conclusion.

Tree at the start of this experiment: `5578c05`. Losing conditions committed at `dfd349e` before
any measurement. Product source was not changed.

## Repositories

Chosen before any measurement in this experiment.

| role | corpus entry | commit | why this one |
| --- | --- | --- | --- |
| expect Orchescope to do well | `openai-agents-js` | `52b2702fc034fb47f79ec50fad173f0e9b068ca6` | Has an adapter in this build, a keyless exercise driver under `corpus/runs/openai-agents-js/`, and was the end-to-end subject of the 0.9.4 scenario-requirement measurement. |
| chosen before knowing the outcome | `email-agent` | `67a176ef44f2ec9b7edfeec8b7da665beaf0a749` | Third-party application from the corpus list. Selected by name from the agent_system entries after skipping demo, exercised, and framework-source trees. Expected JSON and prior audit output for this entry are not read before Round 1. |

Neither is `apps/demo` / `demonstration-system`. Clones are copy-on-write copies of
`corpus/.cache/<name>` into a scratch directory; nothing under `corpus/.cache` is audited.

## Losing conditions (pre-registered, before any measurement)

Written and committed before the first audit, agent pass, or change to either clone.

### Round 1 — detection

**Prediction registered here:** the agent wins Round 1. It reads frameworks and application shapes
this build has no adapter for, and is free to invent checks beyond the rule set.

| result | meaning |
| --- | --- |
| Agent produces more true, checkable findings than Orchescope on the blind repository, and at least as many on the expected-strong repository | Expected. Not by itself a reason to abandon. |
| Agent produces more true, checkable findings on **both**, and Orchescope's extras are mostly false or uncheckable | **Narrow** the product to the join and the verification loop; stop competing on static breadth. |
| Orchescope produces more true, checkable findings on both, with fewer false claims | Surprising. Record why. Favours keeping detection. |
| Either side's majority of claims cannot be checked against the repository, or false claims outnumber true ones | That side loses Round 1 regardless of count. If that side is Orchescope on the expected-strong repository, **narrow** detection. If both sides fail checkability, Round 1 is inconclusive. |

### Round 2 — reproducibility

| result | meaning |
| --- | --- |
| Orchescope output is not byte-identical across three runs on an unchanged clone | **Defect.** Most important finding of the experiment. Fix before any product claim about measurement. Does not by itself decide abandon vs ship. |
| Agent answers move between runs on the same clone (different findings, different severity, different verdicts) while Orchescope does not | Orchescope wins Round 2. Necessary for a measurement product; not sufficient to ship the whole surface. |
| Agent answers are stable across three runs and Orchescope's are not | Orchescope loses the property it claims. **Narrow** to whatever subset is stable, or **abandon** if nothing is. |
| Both move | Inconclusive on reproducibility; do not claim either is a measurement instrument. |

### Round 3 — verdict on a change

Three changes, applied and measured separately, without telling either side what changed:
a real improvement a recorded measurement can see, a no-op, and a regression.

**The no-op is decisive.** A side that says the no-op improved things has failed.

| result | meaning |
| --- | --- |
| Orchescope distinguishes all three (improvement / no-op / regression) and the agent does not, especially on the no-op | This is the product's reason to exist. **Ship** the verification loop; Round 1 may still force narrowing of static breadth. |
| Agent distinguishes all three and Orchescope does not | The objection stands. **Abandon** the product as a verification instrument. |
| Orchescope's printed plan cannot be followed on a third-party clone that has findings | Finding against the loop. If the blockage is "no recorded run / no scenario" and composing or recording clears it on the expected-strong repository, record the cost. If the loop cannot close on either repository after a good-faith follow of the plan, **abandon** the loop claim. |
| Both distinguish all three | Prefer the side whose verdict cites checkable evidence. If Orchescope's verdicts are backed by the same-scenario comparison (ADR 0017) and the agent's are not, **narrow** to that loop. If neither cites checkable evidence, inconclusive. |
| Neither distinguishes the no-op from the improvement | **Abandon.** The question the product exists to answer is not answered by anyone measured here. |

### Closing recommendation rule

After all three rounds, pick exactly one:

1. **Ship it as is** — only if Round 3 is an Orchescope win on distinguishing the three changes, Round 2 shows Orchescope stable (byte-identical), and Round 1 does not show Orchescope's detection to be mostly false on the expected-strong repository.
2. **Narrow it to \<this\>** — if Round 3 is an Orchescope win but Round 1 is an agent win on breadth, or if only a subset of the surface (the declare/exercise join, the goal validation loop) survives the losing conditions above.
3. **Abandon it** — if Round 3 is an agent win or a mutual failure on the no-op, or if the Orchescope loop cannot be followed to a verdict on either third-party repository.

## Agent-side prompts (verbatim, registered before use)

The agent side receives full repository access, its own tooling, as many passes as it wants, and
these prompts. No Orchescope CLI, MCP tool, or package is available to it. Scratch clone paths are
filled in at run time; the prompt text is otherwise fixed.

### Round 1 — detection

```
You are auditing an agentic software system in this repository. Full read access. Use any analysis
you want: read source, configs, prompts, tool definitions, graphs, tests. Take as many passes as
you need.

Produce a structured audit report with:
1. What agents, tools, models, handoffs, and external effects you found (with file:line).
2. A list of findings / risks / weaknesses. For each: title, severity, the claim in one sentence,
   and evidence a reader can open and check (file:line and the fact observed there). Do not claim
   anything you cannot point at.
3. Which claims are observations from the tree vs inferences.

Do not use Orchescope, any orchescope binary, or any package under a path containing "orchescope"
except this repository under audit itself. Do not invent runtime behaviour you did not execute.
Repository root: <CLONE>
```

### Round 2 — reproducibility

Same prompt as Round 1, run three times on the identical unchanged clone, in separate agent
sessions with no memory of prior answers. Diff the three reports.

### Round 3 — verdict on a change

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

## Measurement log

Pre-registration commit: `dfd349e`. Scratch root:
`/tmp/orchescope-vs-agent-16308`. Product source was not changed.

Smoke (demo only): `pnpm --silent orchescope --cwd apps/demo audit --json` → `ok: true`,
12 findings.

### Rounds Orchescope lost (reported first)

#### Round 3 — lost. Agent distinguished all three changes; Orchescope's prescribed verdict did not

This is the round that decides the question. Orchescope lost it.

**`email-agent`.** After `pnpm --silent orchescope --cwd <clone> audit --json`, the only finding
was `observability-coverage` (`OSC-NETJE-3376`). `goal create OSC-NETJE-3376` refused:
"This is a next step for the operator rather than a code change." No improvement loop can be cut
on this repository from a static audit. The agent side still distinguished the three changes
(below). Orchescope produced no goal verdict on this repository at all.

**`openai-agents-js`.** The only goal-eligible finding was `model-call-without-timeout`
(`OSC-MIQMZ-5859`). `goal create` printed plan:

```
orchescope audit --json
orchescope goal validate OSC-GOAL-0001
```

with "no baseline run recorded, so this goal is decided by the rescan alone."

Three fresh COW clones each ran audit → goal create → change → that plan.

| change | what was done | `goal validate` | finding title after rescan |
| --- | --- | --- | --- |
| real improvement attempt | Within the goal's write paths: removed string `model:` pins on Agents and added `timeout: 60_000` on `new OpenAI()` where present (22 files) | **not validated** — AC-01 failed: finding still fires | `4 models are called with no timeout declared` |
| no-op | Comment-only edits in three example files | **not validated** — same AC-01 failure text | `6 models are called with no timeout declared` |
| regression | Added two extra Agents with string models and no timeout in `examples/docs/agents/simpleAgent.ts` | **not validated** — same AC-01 failure text | `7 models are called with no timeout declared` |

Commands (improvement clone; noop and regress identical shape):

```
pnpm --silent orchescope --cwd /tmp/orchescope-vs-agent-16308/r3-improve audit --json
pnpm --silent orchescope --cwd /tmp/orchescope-vs-agent-16308/r3-improve goal validate OSC-GOAL-0001
pnpm --silent orchescope --cwd /tmp/orchescope-vs-agent-16308/r3-improve goal validate OSC-GOAL-0001 --json
```

The printed validation verdict is the same binary failure for all three. The plan does not ask the
operator to read the title count; `goal validate` is what decides "did it work?". On that verdict,
Orchescope does not distinguish improvement, no-op, and regression.

Further: a good-faith change inside the allowed write paths moved the count 6→4 and still could not
satisfy AC-01. The openai-agents adapter's `invokes_model` edges carry retry policy from `maxTurns`
only (`packages/discovery/src/adapters/openai-agents.ts` `retryPolicyFor` / `addAgentRelations`);
they never set `timeoutMs` or `timeoutDeclaredAt`, which is what `declaresDeadline` requires
(`packages/findings/src/rules/static-policy.ts`). The remediation text ("Set an explicit request
timeout on the model client or the call site") cannot clear Agent-string model edges through the
spellings the adapter reads. That is a plan that can be typed but not closed on this repository.

**Agent Round 3** (verbatim prompt from pre-registration; separate sessions; no Orchescope; not told
the label). On `email-agent` clones:

| clone | agent class | evidence it cited |
| --- | --- | --- |
| `r3-ea-improve` | **improved** | exact-match confirmation replacing substring/`"y"`; bulk trash `max_results=10` matching preview (`agent/graph.py`) |
| `r3-ea-noop` | **noop** | comment-only; AST identical to HEAD |
| `r3-ea-regress` | **regressed** | send path auto-calls `send_email` while `awaiting_confirm` with no yes/no check |

On `openai-agents-js` clones the agent also labelled **improved** / **noop** / **regressed**
correctly (removed model pins vs comment-only vs added untimed agents). Reports:
`results/r3-agent-ea-*.md`, `results/r3-agent-oaijs-*.md` under the scratch root.

Per the pre-registered rule: *Agent distinguishes all three and Orchescope does not → abandon the
product as a verification instrument.*

#### Round 1 — lost on detection breadth (prediction held)

**Prediction was: agent wins.** It did.

| repository | Orchescope | Agent |
| --- | --- | --- |
| `openai-agents-js` | `pnpm --silent orchescope --cwd <clone> audit --json` → 4 findings: `model-call-without-timeout` (medium), `prompt-injection-boundary` (medium), `topology-shape` (low), `observability-coverage` (info). Graph: 855 components, 587 edges. | 20 findings (0 critical / 6 high / 9 medium / 3 low / 2 info). 65 `file:line` citations in the report. |
| `email-agent` | same command → **1 finding**, info only (`observability-coverage`). Graph: 11 components, 16 edges (langgraph adapter). **Zero risk findings.** | 19 findings (2 critical / 4 high / 6 medium / 4 low / 3 info). 85 `file:line` citations. |

Orchescope commands:

```
pnpm --silent orchescope --cwd /tmp/orchescope-vs-agent-16308/openai-agents-js audit --json
pnpm --silent orchescope --cwd /tmp/orchescope-vs-agent-16308/email-agent audit --json
```

Agent prompt: Round 1 text from the pre-registration section, with `<CLONE>` filled. Reports:
`results/r1-agent-openai-agents-js.md`, `results/r1-agent-email-agent.md`.

Checkability sample (opened in the clones):

- Agent `email-agent` F1 (substring `"y"` confirmation) — true at `agent/graph.py` confirmation
  blocks. F2 (preview max 10 vs trash default 50) — true at `agent/graph.py` vs
  `gmail/tools.py` `trash_emails_by_query(..., max_results: int = 50)`.
- Orchescope `openai-agents-js` risk findings carry evidence ids and source locations that resolve
  into the tree (goal show listed real example paths). No false Orchescope risk finding was found
  in this sample; the loss is **count and application-level coverage**, not fabrication.
- On the blind repository Orchescope reported no risk at all while the agent reported nineteen
  checkable issues. That is the objection's detection half, measured.

Round 1 verdict: **agent wins**, as predicted. Orchescope's extras on the expected-strong repo were
not mostly false, so the pre-registered "narrow detection" clause from false extras does not fire;
the breadth loss on the blind repo still stands.

#### Round 2 — Orchescope not byte-identical (pre-registered defect); finding content stable; agent moves

Three Orchescope audits per unchanged clone:

```
pnpm --silent orchescope --cwd <clone> audit --json   # ×3
```

MD5s:

| file | md5 |
| --- | --- |
| `r2-orchescope-oaijs-1.json` | `7837bc70a3fe95f89ac6499503406546` |
| `r2-orchescope-oaijs-2.json` | `0cd05a8871f40dabf2089752f3c7766d` |
| `r2-orchescope-oaijs-3.json` | `91e301b5a4d7efe276117e8a2f21ff31` |
| `r2-orchescope-email-1.json` | `b20a176753504c7a7434a04c4433a1ee` |
| `r2-orchescope-email-2.json` | `7624214977381fdcc1a21b23330a9553` |
| `r2-orchescope-email-3.json` | `673596e1888e6224cd5ea58b77fef7be` |

Raw JSON is **not** byte-identical. First differing path on `openai-agents-js`:
`data.coverage.adapters[0].durationMs` (46 vs 34). After stripping `durationMs` / scan and report
ids / evidence id strings, the three documents are equal and the finding fingerprints are equal
(same rule ids, severities, titles, evidence counts).

Per the pre-registration: *not byte-identical → defect; most important finding of the experiment;
does not by itself decide abandon vs ship.* Recorded here as that defect. The stable core is the
findings list; the volatile surface is timings and fresh ids.

Agent, three independent sessions, same Round 1 prompt:

| repo | pass counts | exact-title ∩ across 3 | notes |
| --- | --- | --- | --- |
| `email-agent` | 22 / 18 / 18 | 1 of 55 union titles | Stable themes: confirmation, bulk delete, attachments, pickle, OAuth, labels. Severity of the same issue moves (e.g. pickle high→medium). |
| `openai-agents-js` | 15 / 14 / 14 | 0 of 43 union titles | Stable themes: seat approval, SDK `needsApproval` defaults, handoffs, guardrails, MCP approval. Wording and severity reshuffle every pass. |

Orchescope wins Round 2 on **finding-content** stability. It loses the stricter pre-registered
byte-identity bar. The agent is not a reproducible instrument.

### What was not measured

- A Round 3 Orchescope goal whose criteria are same-scenario metric comparisons with recorded runs
  (ADR 0017). The only eligible goal on `openai-agents-js` was static `finding_resolved`. Closing
  a runtime comparison loop on a third-party clone was not achieved in this experiment.
- Visual rendering (the objection mentions it). Not compared.
- Blind evaluation of agent findings for a full false-positive rate; samples above were opened in
  source, not exhaustively graded.

## Closing recommendation

**Abandon it.**

Round 3 is the deciding round. On two third-party repositories, a coding agent distinguished a real
improvement, a no-op, and a regression. Orchescope either could not cut a goal at all
(`email-agent`) or produced the same failed `goal validate` on all three changes while its own plan
could not be driven to a satisfied criterion inside the write scope it named (`openai-agents-js`).
Round 1 matched the registered prediction: the agent covers more ground with checkable claims.
Round 2 found that Orchescope's JSON is not byte-identical across identical audits (timings/ids),
even though the findings list is stable.

The objection stands for the product as a verification instrument over "just ask the coding agent."

### What would change this mind

1. On at least one third-party corpus entry, Orchescope's printed plan is followed to a **satisfied**
   goal validate for a real improvement, an **unsatisfied** validate for a no-op, and a distinct
   **regressed** (or equivalently distinct) outcome for a regression — without the operator reading
   side channels the plan does not name.
2. That distinction rests on the same-scenario comparison ADR 0017 describes, with recorded runs,
   not only on a static rescan the write scope cannot clear.
3. Audit JSON identity is either byte-stable or the product documents and excludes the volatile
   fields from any claim of reproducibility.

Until those are measured in favour of Orchescope, shipping or narrowing is a hope; abandonment is
what this run supports.
