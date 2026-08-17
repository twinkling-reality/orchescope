# Changelog

Notable changes per released version. Nothing here is generated; a release is a person writing down what moved and why.

## 0.3.0

This answers the field report against 0.2.0, from the same TypeScript monorepo the 0.1.0 report came from, roughly
eighteen hundred analysed files.

Its central finding is that three separately filed defects were one defect. An external effect is attributed to the
function that performs it, and nothing joined a declared component to the effect one frame away, so the writes were
present and correctly classified and nothing could reach them. The rules built on that graph were not wrong about their
own logic; they were reading the wrong node, and one of them was structurally unable to fire on any input it had ever
been given.

### The join that was missing

**A tool now reaches what its handler runs.** A tool is declared by a registration call and implemented by the handler
that call is given, and only the first was recorded. Every tool was a leaf, so `side-effect-approval-boundary`, which
asks whether an agent, a tool or an MCP server reaches a consequential operation, answered no every time. It was
suppressing on every input rather than reporting, which is worse than the false positives it replaced, because nothing in
the output distinguishes a rule that checked from a rule that could not.

The declaring adapter now records the source range that implements the component, because only that adapter knows which
argument is the body, and an adapter running after it joins that range to what the calls inside it resolve to. The join is by line
containment: an inline handler is anonymous, so the nearest named scope of a call inside it is whatever encloses the
registration, which at module scope is nothing at all. Five adapters record spans, and any other one inherits the join
by recording a span of its own.

**A retry now names the operation it repeats.** A retry relation ends where its author wrote it, which is usually a
helper rather than the request the helper makes. Discovery mints an entry point for that helper to hold the effect,
nobody classifies a minted entry point, and the guard that refuses to judge an unclassified component therefore refused
every time while the write one hop further was classified all along. The guard is unchanged. What changed is that the
graph can be asked what a component performs, reading through the frames discovery invented and stopping at the
components a repository declared, so a reader is told about the POST that repeats rather than about the function around
it.

**A retry around a request written in place is now visible.** Retry discovery resolved a callee through the binding
registry, which answers for a name someone declared and answers nothing for `fetch(...)` written inline, even though that
request had already been discovered and classified at that exact line.

**A rule outcome carries the size of what it looked at.** `clear` is a claim that something was checked and was fine, and
over an empty population that claim is not weaker than it should be, it is false: one build reported that every
discovered retry had an attempt ceiling in a repository where it had discovered no retry at all, and a build that had
genuinely checked a hundred said the same sentence. Nothing examined is now `not_applicable`, and either way the count
travels.

**`connect` no longer mints a SQLite database.** The name was matched bare, so `server.connect(new
StdioServerTransport())` reported a database in a repository that has none. Across the pinned corpus this was an HTTP/2
session in `axios`, Redis clients in `express` and one chatbot, and MCP transports throughout the OpenAI Agents SDK.
Python's `sqlite3.connect` is still read.

### Retries read what the code states

**A client assigned to a name is still that client.** `const fetchImpl = opts.fetchImpl ?? fetch` is how a module is
written so its network client can be replaced in a test, and every adapter matched on the callee path, so the module
written to be testable was the one that could not be seen. On the reporting repository seven modules were invisible,
including the one whose entire reason for existing separately is that it holds the retry policy: no service, no method,
no retry, nothing. The evidence records the name the source wrote and what it resolves to, because the alias is a fact
about the repository rather than something to normalise away.

**A `while` head that compares a counter against a bound states a ceiling.** Every `while` was read as unbounded, which
told the author of `while (attempt < maxAttempts)` that no attempt limit could be established from their source. A
condition testing a flag still states none, because a flag says nothing about how many passes there are.

**The wait between attempts is recorded rather than only required.** A discovered retry now declares whether it waits the
same amount each pass, waits longer, or does not wait at all. Exponential is claimed only where the syntax exponentiates.
The last of the three is the dangerous one, since it re-attempts as fast as its dependency can fail, and it used to be
reported as `unknown`, which reads as a gap in the reading rather than as a fact about the code.

### The contract a traced command exposes

Three changes that a pipeline reads, and the reason this command was hard to adopt in continuous integration.

**A traced command exits with the status it exited with.** Every failing status became a single 4, so a step could tell
that the target had failed and not how, and a suite that distinguishes its failure modes by exit code lost that
distinction by being measured. This is what `timeout`, `env` and `nice` do.

**The run report moved to standard error**, beside the privileges notice, because the report is a diagnostic and the
traced program's output is the payload. On standard output it interleaved with the target's own bytes, so
`orchescope trace -- generate > out.json` wrote a file with a run summary in the middle of it.

**`--json` no longer discards the target's output.** It was dropped entirely rather than relocated, so an agent that
traced a build to read its output got a document about the run and none of what the run said. Standard output carries the
document and the target's own output moves to standard error.

### Detection and wording

- **A host written before the first substitution is read.** `` `https://api.stripe.com/v1/charges/${id}` `` says which
  service it reaches, and reading only plain strings made every such request a component named for the function that
  built it. The authority has to be complete before the substitution: `` `https://api.${region}.example.com/x` `` states
  no host, and reading one out of `https://api.` would be a confident answer to a question the source did not settle. The
  address recorded this way is marked as a prefix rather than reported as the request.
- **The adapter says how many addresses it could not resolve.** A base address held in a constant is the common cause and
  following one is not something this build does, so the count and the reason are reported rather than left to be
  inferred from a list of components named after functions.
- **A rule agrees with its own count.** `3 consequential operations was left unreported` and `2 runs was recorded` both
  reached readers. A tool that reasons about grammar less carefully than it reasons about evidence invites a reader to
  weigh the rest of its output the same way.
- **A model reached by a plain request is told to set a deadline, not to configure a client.** There is no client at that
  call site, so the goal cut from that finding asked an agent to change something absent from the only scope it was
  allowed to touch.
- **The MCP audit payload names the build that produced it.** A server is started once and serves every call in a
  session, so an upgrade installed while it runs changes nothing a caller can see, and an agent comparing today's audit
  against a finding it recorded last week could not tell a change in the repository from a change in the reader.

### The repository decides what is part of it

**Traversal reads `.gitignore`.** The fixed list of directory names it used instead is a guess at what those
files say, and it loses to every project that puts its build output somewhere else. Nested ignore files,
negations and anchored patterns are all read, and every file excluded this way is named in coverage with the
rule that excluded it, so a reader who disagrees can see exactly what happened.

**A file the repository tracks is kept whatever the rules say.** An ignore rule states an intention and the
index states the outcome, and git honours the index. One pinned repository ignores `*_*.md` and has
committed twenty one documentation files matching it, so a build that read the rules and stopped there would
have deleted real source from its own view of that repository. Reading the rules without reading the index
is the version of this feature that removes what it was meant to preserve.

The effect is nothing at all across the pinned corpus, where the rules and the index agree everywhere. It
shows up on a working checkout: on the reporting repository it sets aside sixteen files, among them
`.DS_Store`, a `.env`, a `.dev.vars`, three generated `worker-configuration.d.ts` and a deprovisioned
deployment manifest.

**A provider host is asked what the request is for, not only which host it is.** `POST
https://api.openai.com/v1/realtime/client_secrets` mints an ephemeral token, and recognising it by host
alone reported it as a model invocation and then cut a goal telling an agent to put a request timeout on an
authentication call. The test is stated as the operations that run a model rather than as the endpoints that
do not, because a list of exclusions loses to whatever a provider ships next, and it lives in the table both
sides of the join already share, so a run and a call site describing the same request cannot disagree about
what it is. The request stays in the graph as a request: dropping a discovered outbound call would trade a
wrong answer for a missing one.

### Upgrading

**A traced command's exit code is now the target's.** If you gate on `orchescope trace` exiting 4, that gate no longer
fires; read the status the target actually returned, or read `data.exitCode` from `--json`, which names the target's
status and nothing else. Orchescope's own codes still apply on every path that ends before a target runs.

**Anything parsing the run report from standard output has to read standard error instead.** Standard output now carries
the traced program's output, or the JSON document, and nothing else.

**A repository with untracked build output will report fewer components.** Traversal now reads the
repository's ignore files, so anything excluded there and not tracked is no longer analysed. Coverage names
every such file and the rule that excluded it.

**Finding counts will move, in both directions.** `side-effect-approval-boundary` can now reach operations behind a tool
handler and will report them where it previously reported nothing. Retry findings name the operation rather than the
enclosing function, and retries around an injected client or an inline request appear for the first time. Against the
reporting repository the retry count rose by one and seven previously invisible modules entered the graph. A `while` loop
that states its own ceiling is no longer reported as unbounded.

**No schema changed.** The candidate counts travel in a rule's detail, the unresolved address count in the adapter's
existing note, and the version on the MCP payload is an additive field rather than a persisted document. Configuration
stays at `schemaVersion` 3.

### Known limits, stated rather than left to be discovered

- **A retry that neither waits nor counts is still invisible.** Making the wait optional rather than required would need
  a new evidence form for an infinite loop around a `try`, and on the reporting repository all sixteen such loops are
  streaming, paging or scanning, several inside a `try` and several returning from the body. Claiming that shape would
  report a file tailer as an unsafe retry.
- **An address assembled from a constant is still unresolved.** Reading `${API_BASE}${path}` needs constant propagation,
  which is a feature rather than a patch. On the reporting repository this is a hundred and four call sites, and the
  coverage block now says so.

### Verification

`pnpm verify` green at 834 unit and 107 end to end tests, from 782 and 103. `pnpm corpus` matches across thirteen pinned
repositories, with every expectation that moved read against the cited source: the removed databases are an HTTP/2
session, two Redis clients and a set of MCP transports; the added services are `axios` reaching its own fetch adapter
through `let _fetch = envFetch || fetch`, two injectable clients in the LangGraph SDK, and three hosts recovered from
template literals. Each fix carries a test that fails without it.

## 0.2.0

Released 2026-08-16 from npm as `orchescope@0.2.0`.

This release answers a field report from two sessions against real systems: one deep run through the full loop against a
private TypeScript monorepo, one sweep of `audit --json` across thirty six repositories. Its finding was that the tool
systematically treated *absence of measurement* as *measurement of absence*, and that its pattern matching rules were
being fed generated code. Across those thirty six repositories the retry rules produced no true positive at all, and both
findings marked goal eligible in the deep run were false.

Almost everything below exists because of that report.

### A traced run now produces evidence

Before this release, `orchescope trace` set three OpenTelemetry environment variables and nothing else. They are inert
unless the target process already loads an OpenTelemetry SDK, and essentially no Node project does, so every traced run
in the field report collected zero spans and every audit stayed inventory.

Orchescope now loads its own instrumentation into a traced Node process through `NODE_OPTIONS=--import`. It records
outbound requests and names each one by what it did: a call to a published model endpoint becomes a model call with the
provider, the model and the token counts; a JSON-RPC document becomes a protocol call naming the tool it executed,
including a tool call a target makes to a server it started over standard input; anything else is a request to a service.

The shim is deliberately small and deliberately inert. It refuses any endpoint that is not loopback, stands down
entirely if the target already runs OpenTelemetry, registers no signal handler, never writes to the target's output, and
swallows its own failures. It also reports what it declined to patch, so a run that collected nothing can say why rather
than looking like a target that made no calls.

**This puts Orchescope code inside a process you own.** It is on by default because that is the difference between what
the product claims and what it delivers, and it is a setting, `runtime.autoInstrument`, because you may not want it.

### Findings that were confidently wrong

**Nothing derived from a run that measured nothing.** A recorded run is evidence that a command executed, not that
anything was observed. Runs are now split into those that produced at least one span and those that produced none, and
the vocabulary lives in the domain layer so every rule inherits it rather than remembering it. An empty run no longer
reaches reconciliation, no claim can carry `basis: observed` with nothing observed, and an acceptance criterion facing
absent data reports `undecided` instead of banking a zero it never earned.

**A loop is a retry only when something in it says so.** A loop containing a `try` and an `await` is also the shape of
per item iteration with per item error isolation, and of a one shot helper whose only `try` guards a parse. A re-attempt
now has to be stated by the code: a wait before the next pass, or a header that counts attempts.

**A rule does not assert an absence it never checked.** Before reporting a missing idempotency key or attempt ceiling,
discovery follows the call one frame into the sink and looks for a deduplicating statement, a key derivation or a
declared bound. What it saw is recorded and the rules decline rather than accuse, and they say how many they left alone.

**Generated code is set aside by what it is, not where it lives.** A name based exclusion list will always lose the race
against `.docs-out`, `packages/extension/media/assets` and whatever the next bundler writes. Detection is by content, and
its thresholds were measured against this repository's own source, its pinned corpus and six published minified bundles.

**A consequential operation is a finding only where a model can reach it.** The risk this rule names is a model deciding
on its own to invoke something consequential. Firing on every consequential operation instead raised four React
components issuing `DELETE` behind a user's click, a continuous integration script posting to GitHub, and a sandbox event
sink. Operations it declines are counted and named rather than dropped silently.

### Detection accuracy

- **A coding agent's configuration is not your system.** A `.mcp.json` listing one server was enough to report a two
  hundred and twenty component Cloudflare Workers application as a detected agent system holding no agent, no tool and no
  model, and then to raise a finding against that repository because nothing in it could reach the server. Servers are
  now recorded as implemented, consumed, or developer tooling, and the last of those is neither evidence of an agent
  system nor part of its topology. It still appears in the graph, because it is a true fact about the repository.
- **A model call is recognised by the host it is sent to.** A system that calls a provider through `fetch` rather than
  through its published package has no import to find, and one project in the sweep ran thirteen MCP servers and reached
  OpenAI by posting to `api.openai.com` with no `openai` entry in its manifest. The audit described a fifty seven
  component agent system containing no model. The host table is now shared between static discovery and the runtime shim,
  so a repository is recognised the same way whether the evidence comes from its source or from its traffic.
- **A host the source never writes down is named for its call site.** Every request whose address is built at run time
  used to be one component called `unresolved-host`: in one project, eleven call sites across nine files in three
  packages, merged into a single node carrying one effect class that could be right for at most one of them.
- **An adapter that read nothing says so.** The `adapter_blind_spot` kind is now `adapter_found_nothing`, because the
  reason beside it has always named two causes and declined to choose between them. The old name is still accepted for
  reading and is never written.

### The agent surface

- **`create_improvement_goal` returns the goal a finding already has.** Six calls with the same finding identifier
  produced six identical goals, which an agent exploring the response shape does without meaning to. The match is on the
  rule as well as the identifier, since a finding identifier is renumbered whenever the set of findings changes. Pass
  `createAnother` to cut a second goal deliberately.
- **Every answer now arrives in the text block as well as the structured payload.** `get_findings` used to return
  `2 of 2 findings.` and nothing else as its text content, so a client that renders text showed its reader nothing and a
  model that did not know to look reported that it had found two findings and nothing about them. The text mirrors the
  same bounded page, one line per record.

### Workspace and honesty about scope

- **State is excluded from git from the first run of any command.** The nested `.gitignore` used to be written only by
  `init`, and the quickstart tells you to run `audit` first. Across the sweep that left thirty of thirty three git
  repositories showing an untracked `.orchescope`, ninety seven megabytes in total.
- **`init` says when a rule in your repository will bury the configuration.** It prints that
  `.orchescope/config.json` is meant to be committed, and git does not consult a `.gitignore` inside a directory an
  ancestor rule already excluded. The fix it prints was measured against git rather than reasoned about, because the one
  that first suggests itself does not work: git will not re-include a file whose parent directory is excluded. `doctor`
  reports the same thing.
- **The command allow list is described as the guardrail it is.** It checks `argv[0]` only, so `orchescope trace --
  seorak` is refused while `orchescope trace -- npx seorak` runs, and `npm run`, `uv run` and `node -e` walk past it the
  same way. Checking further would close nothing, because a runner's argument is any command.
- **A traced command runs with your full ambient privileges.** It writes the files it always writes, binds the ports it
  always binds and reaches the network it always reaches. Orchescope adds environment variables and, for a Node target,
  loads its own instrumentation. It takes nothing away and it is not a sandbox. This is now said in the documentation and
  once in the terminal as the process starts.

### Upgrading

**Configuration moves to `schemaVersion` 3.** `allowProcessSpawn` and `allowedCommands` are now `execution.allowProcessSpawn`
and `execution.allowedCommands`. They decide whether Orchescope starts a process and which one, and they used to sit
beside the settings that constrain Orchescope itself, where a reader taking the block as a whole concluded that tracing
was sandboxed.

A file written before the split is read forward and `doctor` reports that it was, so nothing breaks on upgrade. A file
naming the same setting in **both** places is refused rather than resolved: picking a winner would discard one of the two
values you wrote, and the direction that gets discarded is the one that denies something.

**Two severity changes will move your finding counts.**

- `observability-coverage` on a repository with no run recorded drops from medium to info. It fired in twenty three of
  twenty three repositories that had a component, which is a finding carrying no information: it says you have not run
  the next step yet, and the loop already says that and routes to it. A run that was recorded and produced no spans stays
  at medium, because something was attempted and the instrumentation did not land. If you gate continuous integration on
  `audit --fail-on medium`, a repository nobody has traced will now pass where it used to fail.
- `side-effect-approval-boundary` fires only where an agent, a tool or an MCP server reaches the operation.

**Component counts will move.** A request whose address is built at run time is now one component per call site rather
than one per repository, and a call to a known model provider becomes a model and a provider rather than an anonymous
external service.

### Provenance

This version was published from a laptop with `npm publish --no-provenance`, so **it carries no attestation**.

What stands in its place is that the artifact is reproducible. `pnpm package` from this repository builds a tarball
byte identical to the one on the registry, which was checked by downloading the published one and comparing:

```
sha256  a65b91582690dd470942b95c4c2fdf124609d1007d72507ac9ea4f7f4da30b64
```

That is a weaker guarantee than a registry attestation and it is worth naming as such. It says the bytes match this
source; it does not say who published them.

### Verification

`pnpm verify` green at 782 unit and 103 end to end tests. `pnpm corpus` matched across thirteen pinned repositories, with
every expectation that moved traced to a call site read by hand. The published artifact was installed from the registry
into a clean prefix and audited a real TypeScript and Python project, which is the check that matters, because the
parsers resolve a native binding and a WebAssembly grammar relative to their own package directories.

## 0.1.0

First published release.
