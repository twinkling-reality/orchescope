# Data handling

What Orchescope reads, what it keeps, where it keeps it, and what leaves the machine. The short answer to the last one is
nothing, unless you export it.

## What it reads

| Input | When |
| --- | --- |
| Source files in supported languages | Every audit |
| `package.json`, `pyproject.toml`, requirements files | Every audit, for the declared dependency set |
| `mcp.json`, `.mcp.json`, `.vscode/mcp.json`, `crew.jsonc`, `agents.yaml` | Every audit, when present |
| `.orchescope/manifest.yaml` | Every audit, when present |
| `scenarios/*.yaml` | When a scenario is loaded |
| OpenTelemetry spans | While a traced or scenario run is in progress, from loopback only |
| A target's result file | After a scenario run, from a path Orchescope chose |
| Environment variable names | To decide whether a configured credential exists. Names, not values, except where a value is redacted for a report |
| Git commit, reference and dirty state | To pin a scan to a revision |

It does not read your shell history, your global configuration, your credential store, or anything outside the repository
you point it at.

## What it keeps, and where

Everything lives under `.orchescope/` in the audited repository.

```
.orchescope/
  config.json          settings; meant to be committed
  manifest.yaml        your declarations; meant to be committed
  .gitignore           written whenever the directory is, so state never needs a rule of yours
  state/               not committed
    orchescope.db      SQLite: scans, runs, spans, side effects, findings, goals, scenarios, comparisons
    artifacts/         content addressed: graphs, trace bundles, report bundles
    reports/           exports you asked for
  cache/               parsed file facts, keyed by content hash
```

The database holds the columns worth querying; large documents live in the artifact store and are referenced by digest, so
the same graph stored twice occupies one file.

**Permissions.** Directories are created `0700` and files `0600`, so the store is readable by your account and no other.
They are not encrypted: a local user with your account can read them, and so can a backup process that runs as you.

**Retention.** Nothing is deleted on your behalf. `report.retainReports` is carried in the configuration and read by no
code in this build, so report bundles accumulate the way runs and scans do rather than being bounded by it. Runs and scans
accumulate by design, because a comparison against last week's baseline needs last week's runs. Removing
`.orchescope/state/` is always safe: the next command rebuilds what it needs, and nothing outside that directory depends
on it.

**Size.** Traces dominate. A run of the demonstration system stores a few hundred spans; ten runs plus their reports come to
roughly eighteen megabytes. A large system traced repeatedly grows faster, and `runtime.maxSpansPerRun` is the ceiling per
run.

## What leaves the machine

Nothing, unless you take it.

- No account, no sign in, no license check, no update check, no telemetry, no crash reporting, no usage counting.
- No outbound request of any kind, and nothing calls a model: analysis is deterministic. The one remaining outbound
  path is a fault proxy forwarding to a non local upstream, which a scenario has to declare and `policy.allowOutboundNetwork`
  has to grant.
- Every listening socket binds to `127.0.0.1` on a port the operating system chooses, and closes when the command ends.
- Exports are written to a path you name, and nothing sends them anywhere.

## Redaction

Every string that leaves the process passes through the redactor before it does: report bundles, exports, log lines, error
messages, progress output, and evidence stored in the database.

**What it recognises.** Documented credential prefixes where one exists (OpenAI, Anthropic, Google, AWS, GitHub, Slack,
Stripe), private key blocks, JSON Web Tokens, credentials embedded in a URL, and bearer tokens in a header value. Where no
prefix exists, values whose *name* looks sensitive are masked regardless of shape: anything containing `key`, `secret`,
`token`, `password`, `credential`, `auth`, `private`, `session` or `cookie`.

**What it produces.** The kind and the length, never the value:

```
authorization: [redacted:openai-api-key:32]
postgres://[redacted:url-credentials]@db.internal:5432/orders
DEMO_API_KEY=[redacted:environment:5]
```

The shape is preserved on purpose. A reader who sees an empty field cannot tell redaction from a rendering bug.

**What it does not do.** It does not prove that no secret remains. A credential in a shape nothing recognises survives it,
and the report never claims otherwise. Two consequences follow: review an export before you share it, and add your own
organisation's patterns to `redaction.extraPatterns`.

## Prompts specifically

A prompt is often the most sensitive text in an agent system. Orchescope records the SHA-256 of a prompt's text, its
approximate token count, whether it interpolates, and where it was found. **It does not store the prompt text.** A graph can
be shared without shipping the repository's prompts.

Where an excerpt is genuinely needed for evidence, it is bounded, redacted, and marked as an excerpt.

## Reports and exports

- **`--format json`** is the full bundle, redacted.
- **`--format sarif`** carries findings only, for a code scanning tool.
- **`--format mermaid`** is a diagram of the graph, for a document.

There is no HTML export and no served report. Both existed and were removed with the browser workspace; the three formats
above are the whole of what leaves the process.

Nothing an export contains was not already in the store, and everything in it went through redaction.

## Removing it all

```
rm -rf .orchescope/state .orchescope/cache
```

That is the whole footprint apart from the configuration and manifest you chose to commit, and the global installation
itself (`npm uninstall -g orchescope`).
