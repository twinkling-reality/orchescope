# System graph schema

Machine readable: [`schemas/system-graph.v1.json`](../../schemas/system-graph.v1.json). Generated from
`packages/schema/src/graph.ts`; a drift check in `pnpm check` fails if the emitted file and the source disagree.

Current version: **1**. A reader that understands version 1 can read any version 1 document.

## Compatibility rules

- **`schemaVersion` is present on every document.** A document with a higher version than a build understands is refused
  rather than partially read.
- **Adding an optional field is compatible.** Adding a required field, removing a field, or changing the meaning of one is
  not, and requires a new version.
- **Adding a value to an enumeration is a version change**, because a consumer that switches on the enumeration cannot
  handle an unknown member safely.
- Identifiers, fingerprints and canonical serialisation are stable across versions: an identifier minted by version 1 means
  the same thing later.

## The document

```json
{
  "schemaVersion": 1,
  "graphId": "graph_d6a93e084bc661f5",
  "components": [ ... ],
  "edges": [ ... ],
  "coverage": { ... },
  "provenance": { ... },
  "metadata": {}
}
```

## Component

```json
{
  "id": "tool:issue_refund",
  "identity": { "kind": "tool", "namespace": "src/tools/refund", "localName": "issue_refund" },
  "fingerprint": "9f2c...",
  "kind": "tool",
  "displayName": "issue_refund",
  "description": "Refund a charge through the payment gateway.",
  "presence": { "static": true, "runtime": true, "manifest": true },
  "basis": "observed",
  "confidence": 0.85,
  "discoveredBy": ["adapter:openai-agents", "adapter:manifest"],
  "sourceLocations": [{ "file": "src/tools/refund.ts", "startLine": 24 }],
  "configLocations": [{ "file": ".orchescope/manifest.yaml", "pointer": "/components/7" }],
  "evidence": ["ev_source_1a2b3c4d", "ev_span_5e6f7a8b"],
  "details": { "for": "tool", "idempotentHint": false },
  "sideEffect": { "class": "financial", "idempotency": "absent" },
  "permissions": [{ "kind": "network", "scope": "https://payments.example", "mode": "write" }],
  "tags": ["declared"],
  "metadata": { "runtimeName": "issue_refund" }
}
```

| Field | Notes |
| --- | --- |
| `id` | `kind:slug`, with a deterministic `~xxxxxx` suffix when two identities collide |
| `identity` | The tuple that defines the component. Never contains a line number |
| `fingerprint` | SHA-256 of the canonical identity, for matching across machines |
| `kind` | One of the nineteen fixed kinds |
| `presence` | Three independent booleans; the combination is the point |
| `basis` | `observed`, `discovered`, `inferred`, `estimated`, `simulated`, `model_interpreted` |
| `confidence` | From the banded set, so values are comparable across producers |
| `discoveredBy` | Every adapter that contributed |
| `sourceLocations`, `configLocations` | Evidence, never identity. Paths are repository relative |
| `evidence` | Identifiers resolved against the evidence store. At least one |
| `details` | Discriminated by `for`, matching `kind` |
| `sideEffect` | `class` from the seven effect classes; `idempotency` is `declared`, `absent` or `unknown` |
| `permissions` | What the component reaches, as declared |

`unknown` idempotency is a first class answer, not a gap to be filled with a guess.

## Edge

```json
{
  "id": "calls_tool:8c1d2e3f4a5b6c7d",
  "kind": "calls_tool",
  "from": "agent:orchestrator",
  "to": "tool:issue_refund",
  "presence": { "static": true, "runtime": true, "manifest": true },
  "basis": "discovered",
  "confidence": 0.85,
  "discoveredBy": ["adapter:openai-agents"],
  "policy": {
    "retry": { "maxAttempts": 3, "bounded": true, "backoff": "exponential", "idempotency": "unknown" },
    "timeoutMs": 30000
  },
  "observation": {
    "executionCount": 12,
    "errorCount": 2,
    "retryCount": 3,
    "parallelCount": 0,
    "totalDurationMs": 1480,
    "durationsMs": [110, 132, 96],
    "inputTokens": 0,
    "outputTokens": 0,
    "evidence": ["ev_span_5e6f7a8b"]
  },
  "sourceLocations": [{ "file": "src/agents/orchestrator.ts", "startLine": 88 }],
  "evidence": ["ev_source_9a8b7c6d"],
  "runtimeOnly": false,
  "metadata": {}
}
```

`observation` is present only when a run exercised the relation, and carries the raw durations rather than only a summary,
so a consumer can compute its own statistics. `observed_after` is the one kind with no design meaning: it records sequence.

## Coverage

```json
{
  "filesDiscovered": 34,
  "filesParsed": 22,
  "bytesParsed": 96512,
  "durationMs": 412,
  "truncated": false,
  "languages": [{ "language": "typescript", "files": 18 }, { "language": "python", "files": 4 }],
  "skipped": [{ "file": "assets/model.bin", "reason": "too_large", "detail": "9 MB exceeds the 512 KB limit" }],
  "adapters": [{ "adapterId": "adapter:langgraph", "status": "not_applicable", "componentsFound": 0, "edgesFound": 0 }],
  "unsupported": [{ "area": "go", "reason": "no adapter parses Go" }]
}
```

Read this block before drawing a conclusion from a graph. A small graph with three skipped directories is not a small
system.

## Provenance

```json
{
  "orchescopeVersion": "0.1.0",
  "scanId": "scan_c0a73b3e48dfa164",
  "projectId": "prj_1f2e3d4c5b6a7988",
  "projectName": "demo",
  "projectPathHash": "4b7d...",
  "generatedAt": "2026-07-25T04:37:55.000Z",
  "git": { "commit": "b908159a015efdd2", "ref": "main", "dirty": true },
  "runIds": ["run_57103f56def013db"]
}
```

The project path is hashed rather than recorded, so a shared graph does not disclose a directory layout. `git.dirty` matters:
a reconciliation against a dirty tree cannot be reproduced exactly, and the report says so.

## Reading one

```
orchescope export --format json --out graph.json
```

The bundle contains the graph under `graph`, with findings, runs and evidence alongside it. Over the Model Context
Protocol, `get_system_map` returns a paged view rather than the whole document, because an agent should not have to receive
a megabyte to ask which tools exist.
