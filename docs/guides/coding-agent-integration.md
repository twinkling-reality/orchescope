# Coding agent integration

Orchescope is designed to be used by an agent as much as by a person. The same operations are available three ways: as
commands with stable JSON output, as Model Context Protocol tools, and as a goal document written to be handed over as a
task.

## Register the server

```
orchescope mcp install --list
orchescope mcp install --client claude-code
```

Four clients are supported, and `--list` shows exactly which file each one writes:

| Client | File | Scope |
| --- | --- | --- |
| `claude-code` | `.mcp.json` | project, shared with anyone who checks out the repository |
| `vscode` | `.vscode/mcp.json` | workspace |
| `cursor` | `.cursor/mcp.json` | project |
| `claude-desktop` | the platform configuration path | user |

An existing entry is left alone unless you pass `--overwrite`. To run the server by hand:

```
orchescope mcp serve
```

It speaks the protocol on stdio and writes nothing to standard output that is not protocol traffic.

## The tools

Fifteen, and the read only ones are annotated as such so a client can decide what to allow without asking:

**Reading, no execution:**

| Tool | Returns |
| --- | --- |
| `get_system_map` | A page of components and adjacent relations, filterable by kind, unexercised or undeclared |
| `get_reconciliation_delta` | The four deltas and the coverage rates |
| `get_findings` | A page of findings, filterable by severity, category, polarity, component, or goal eligibility |
| `get_finding` | One finding with its evidence records |
| `get_improvement_goal` | One goal and its implementer prompt |
| `list_scenarios` | The scenarios in the repository, with what each needs |
| `export_report` | Writes a report to a path and returns the path, so a large document never fills the conversation |

**Analysing, no execution of your system:**

| Tool | Returns |
| --- | --- |
| `scan_agent_system` | Component counts by kind, edge count and the coverage block |
| `audit_agent_system` | The summary, the delta and a bounded page of findings |
| `create_improvement_goal` | A goal and the prompt to implement it |
| `compare_runs` | A verdict with per metric directions and sample sizes |
| `validate_improvement_goal` | Per criterion outcomes, each satisfied, refused or undecided |

**Executing your system**, which requires `policy.allowProcessSpawn`:

| Tool | Returns |
| --- | --- |
| `run_scenario` | Pass or fail, run identifiers, reliability, evaluator outcomes |
| `benchmark_variants` | Per variant results with withheld quantiles named |
| `inject_faults` | Per fault outcomes and anything that could not be applied |

Every tool validates its arguments against the schema it advertises, refuses an unknown field rather than ignoring it, and
bounds its output. Nothing returns a whole graph or a whole report: they return counts, a page, and identifiers to follow up
on.

## The workflow that works

The loop is designed so an agent never has to guess whether its change helped.

**1. Establish a baseline.** The agent runs `run_scenario` on the scenario the goal will name, or you do it first. Without a
baseline there is nothing to compare against, and the comparison will say so rather than inventing one.

**2. Find something worth changing.** `audit_agent_system`, then `get_findings` with `goalEligibleOnly: true`. Eligibility is
the filter that matters: a finding needing a design decision is marked as not eligible with the reason, so the agent does not
start work that cannot be verified.

**3. Get the task.** `create_improvement_goal` with the finding identifier returns the goal and the prompt. The prompt states
the problem, the evidence, the paths that may be written, what must not change, the acceptance criteria and the exact
validation command.

**4. Make the change**, within the write scope. The scope is not advisory: it exists because a change that touched twenty
files cannot be attributed to a measured outcome.

**5. Verify.** Rerun the scenario, `compare_runs` against the baseline, then `validate_improvement_goal` with the comparison
identifier. Each criterion comes back satisfied, refused or undecided with a reason.

**6. Report honestly.** An undecided criterion is not a pass. If the comparison says `indeterminate` because there were two
runs, the answer is to run more repetitions, not to claim an improvement.

## Doing the same thing from a shell

Everything above works with `--json`, which produces exactly one document on standard output, including on failure:

```bash
orchescope audit --json > audit.json
finding=$(python3 -c "
import json
findings = json.load(open('audit.json'))['data']['findings']
print(next(f['id'] for f in findings if f['goalReadiness']['eligible']))
")
orchescope goal create "$finding" --json > goal.json
orchescope goal show "$(python3 -c "import json;print(json.load(open('goal.json'))['data']['goal']['id'])")" --prompt
```

Exit codes are part of the interface: `0` success, `1` findings at or above a `--fail-on` threshold, `2` a caller mistake,
`3` refused by policy, `4` the audited system failed, `5` the environment is missing something, `130` interrupted.

A refusal carries `error.detail.setting` when policy denied it, so a script can name the setting to change without parsing
prose.

## What the agent should not do

- **Do not edit the goal.** Its `prohibitedChanges` name this explicitly. A validation the implementer can redefine is not a
  validation.
- **Do not edit a stored baseline**, benchmark or comparison.
- **Do not weaken an evaluator** or delete an assertion to make a scenario pass.
- **Do not turn off a policy setting, a permission check or redaction** to get something to run.
- **Do not report an undecided criterion as satisfied.** Say what could not be judged and why.

## Cost and permission

Read only tools touch nothing. The three executing tools respect `policy.allowProcessSpawn` and are refused with the setting
named when it is off, which lets you give an agent the analysis without giving it the ability to run your system.

Model based analysis is off by default and needs four settings plus a credential. An agent cannot enable it by calling a
tool.
