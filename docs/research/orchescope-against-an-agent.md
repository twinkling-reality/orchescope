# Orchescope against an agent

The objection under test: *why would I not just ask my coding agent to audit my agent system,
since it reads any framework, covers more ground, and renders it visually?*

This document settles that by measurement. Recommending abandonment or narrowing is an expected
outcome. There is no "both have their strengths" conclusion.

Tree at the start of this experiment: `5578c05`. Product source is not changed unless a defect
blocks the measurement.

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

*(filled in after the pre-registration commit; no numbers above this line were produced by running
either side)*

## Closing recommendation

*(one of: ship it as is / narrow it to … / abandon it — after the rounds)*
