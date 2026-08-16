# Finding schema

Machine readable: [`schemas/finding.v1.json`](../../schemas/finding.v1.json). Generated from
`packages/schema/src/finding.ts`.

Current version: **1**. The compatibility rules are the same as for
[the system graph](system-graph-schema.md#compatibility-rules).

## A real finding

This is the output of `orchescope audit --json` against the demonstration system, unedited:

```json
{
  "id": "OSC-REL-0004",
  "ruleId": "retry-around-non-idempotent-operation",
  "category": "reliability",
  "polarity": "risk",
  "severity": "high",
  "confidence": 0.85,
  "basis": "discovered",
  "title": "issue_refund is retried and nothing makes it safe to repeat",
  "explanation": "orchestrator retries issue_refund, whose effect class is financial, and no idempotency key was found on the operation. Retrying an operation that is not idempotent produces the effect twice whenever the first attempt fails after the effect has already happened, which is exactly the case a timeout cannot distinguish.",
  "impact": "Under a transient failure the external effect happens more than once. Nothing downstream can collapse the duplicates without a key.",
  "components": ["tool:issue_refund", "agent:orchestrator"],
  "edges": ["calls_tool:f43780661bcb7088"],
  "sourceLocations": [
    { "file": "src/tools/refund.ts", "startLine": 1 },
    { "file": "src/agents/orchestrator.ts", "startLine": 1 }
  ],
  "evidence": ["ev_70ef810a2078eaf4", "ev_52ca4cd8ac52ca47"],
  "metrics": [],
  "recommendation": {
    "summary": "Attach an idempotency key to issue_refund, or remove the retry.",
    "steps": [
      "Derive a key from the request fields that define the operation, not from a timestamp.",
      "Send the key on every attempt including the first.",
      "Run the chaos scenario that injects a tool timeout and confirm a single effect."
    ],
    "effort": "small",
    "risk": "medium"
  },
  "suggestedExperiment": {
    "description": "Inject a tool timeout on the first attempt and count the resulting effects.",
    "command": ["orchescope", "chaos", "--scenario", "scenarios/support-desk.yaml"],
    "expectedSignal": "one effect instead of two, with task success unchanged"
  },
  "goalReadiness": {
    "eligible": true,
    "reason": "The change is local to one call site and is verified by a deterministic chaos run.",
    "requiresRuntimeEvidence": false,
    "requiresHumanReview": false
  },
  "taxonomy": ["owasp-asi:ASI06"],
  "conflictsWith": [],
  "tags": ["retry", "idempotency"],
  "createdAt": "2026-07-25T06:29:08.774Z",
  "metadata": {}
}
```

## Fields

| Field | Notes |
| --- | --- |
| `id` | `OSC-<CATEGORY>-<NNNN>`, deterministic for a given scan |
| `ruleId` | Stable across versions. This is what a comparison keys on to decide whether a finding was resolved |
| `category` | One of eleven: `architecture`, `performance`, `cost`, `reliability`, `resilience`, `security`, `permissions`, `agent_complexity`, `maintainability`, `scenario_coverage`, `observability` |
| `polarity` | `risk` or `strength`. A strength is always `info` |
| `severity` | `critical`, `high`, `medium`, `low`, `info`, after capping |
| `confidence` | `0` to `1`, from the banded set |
| `basis` | How the claim was established. Bounds the severity |
| `title` | One line, names the component |
| `explanation` | Why this is a problem, and what makes it one here |
| `impact` | What happens if nothing changes |
| `components`, `edges` | What the finding is about. Never empty |
| `sourceLocations` | Where to look |
| `evidence` | Identifiers of supporting records. Never empty: a draft with none is dropped |
| `metrics` | Each with `name`, `value`, `unit`, `sampleSize`, `basis`, and optionally `comparisonValue` |
| `recommendation` | `summary`, ordered `steps`, `effort`, `risk` |
| `suggestedExperiment` | The command that would confirm it, and the signal to expect |
| `goalReadiness` | Whether this can become a bounded goal, and why or why not |
| `taxonomy` | `owasp-llm:`, `owasp-asi:`, `atlas:`, `cwe:` or `mast:` references, where one applies |
| `conflictsWith` | Findings that disagree with this one, recorded rather than resolved silently |
| `tags` | Includes `severity-capped` when capping happened, with the reason in `metadata` |

## Reading it correctly

**`basis` bounds what a severity can mean.** `observed` and `discovered` can reach `critical`; `simulated` and `inferred`
stop at `high`; `estimated` and `model_interpreted` stop at `medium`. A `medium` finding tagged `severity-capped` was
proposed higher and reduced, and `metadata.severityCapReason` says why.

**`metrics` without `sampleSize` do not exist.** Every metric carries one. A metric with a sample size of one is a single
observation, and a comparison built on it reports `indeterminate` rather than a direction.

**An absent finding is not an absence of risk.** The rules that evaluated are reported alongside the findings, each with a
status: `fired`, `clear`, `insufficient_evidence` or `not_applicable`. A rule that lacked evidence tells you something a
clear rule does not.

## In SARIF

`orchescope export --format sarif` maps each finding to a SARIF result: `ruleId` becomes the rule identifier, `severity`
becomes a level, `sourceLocations` become physical locations, and the explanation and recommendation become the message.
Findings without a source location appear without one rather than being dropped. This is the form a code scanning tool
reads; the JSON bundle is the form to read for evidence, because SARIF has no place to put it.
