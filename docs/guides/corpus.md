# The corpus

Every adapter here was validated against a fixture written by whoever wrote the adapter, which is circular: the fixture
encodes what the author already believed. The corpus is the other half. It pins real repositories at real commits, records
what a scan produces against each one, and fails when a number moves.

That is worth more than another adapter, because it says which adapters matter, it catches a framework moving in the field,
and it turns "does it work" into a gate.

## Running it

```
pnpm corpus:offline    # the two local entries, with no network
pnpm corpus:required   # the local entries plus the bounded archive selection required by CI
pnpm corpus            # every entry, cloning what the cache is missing
pnpm corpus:exercise    # the same, and also runs the entries that can produce spans
node scripts/corpus.mjs --check langgraph flask     # named entries only
node scripts/corpus.mjs --check --exercise openai-agents-js-filesystem-mcp
```

The first full run clones the pinned repositories into `corpus/.cache`, which git ignores. Later runs reuse the clone and
check out the pinned commit again, so a formatter pointed at the cache cannot change what is measured.

The required run obtains four selected full-commit source archives. Each entry pins the normalized digest of every path,
executable bit and file byte plus the digest of its licence notice. The archive reader bounds the download, expanded data,
entry count and file size and accepts no link or second root. Generated root names, timestamps and gzip bytes are not part
of the digest because GitHub guarantees the extracted contents of a commit archive while allowing compression to change.

Nothing is vendored. This repository is Apache-2.0 and the corpus is not, so clones and expanded archives stay in the
ignored cache and outside the package.

## Reading a run

```
langgraphjs  agent system, 750 components, 708 relations
  parse rate    1165/1165 files in a language this build reads (100%), 1381 discovered
  adapters      effects 334c/221r, langgraph 1240c/1014r, prompts 144c/2r
  found nothing ai is imported here and its adapter found nothing; openai is imported here and its adapter found nothing
  findings      6 across 2 rule(s), 0 strength(s)
  expectation   matched
```

Three of those lines are the measurement. **Parse rate** is how much of the source this build claims to read it actually
read, which is not how much of the tree it walked: a repository of a thousand test fixtures and six hundred Python files
is fully read at six hundred, and dividing by the tree would call that a third. **Adapters** is what each one
contributed, in components and relations, which is the only honest answer to which adapter is worth maintaining. **Blind
spots** are the frameworks a repository imports that the adapter claiming them read nothing from, and they stay printed
until an adapter earns their removal.

## Reading a difference

A check that differs prints the path that moved:

```
langgraphjs  no agent system, 119 components, 126 relations
  adapters      effects 334c/221r
  found nothing @langchain/langgraph, langgraph, @langchain/core is imported here and its adapter found nothing
  expectation   19 difference(s)
    adapters.adapter:langgraph.componentsFound: expected 1240, observed 0
    adapters.adapter:langgraph.edgesFound: expected 1014, observed 0
    components.total: expected 750, observed 119
    agentSystemDetected: expected true (corpus.yaml says agent_system), observed false
```

That is an adapter that went quiet, named. It is what a framework moving underneath a reader looks like, and it is what
this file exists to catch.

**A difference is not automatically an error.** A rule that got sharper, an adapter that learned a new form, a pin that
moved to a newer commit: all of those move numbers in the right direction. Deciding which direction is a person's job, and
nothing in the harness does it. `--check` never writes an expectation.

## Recording a change

```
node scripts/corpus.mjs --record langgraphjs
git diff corpus/expected/langgraphjs.json
```

Read that diff before committing it, entry by entry, and say in the commit message what moved and why. An expectation
rewritten without being read is worth nothing: the whole value of the file is that somebody looked.

## Adding an entry

Append to `corpus/corpus.yaml`:

```yaml
  - name: some-repository
    source: git
    url: https://github.com/owner/repository.git
    commit: 0000000000000000000000000000000000000000
    kind: agent_system
    why: >-
      What this entry is here to catch, in enough detail that removing it is a decision.
```

The commit has to be a full forty character revision: a branch is not a pin. `kind` is the claim, and the check holds the
scan to it, so a repository pinned as `not_agent_system` fails the moment a reader starts finding agents in it.

Then `node scripts/corpus.mjs --record some-repository` and commit both files.

An entry with `source: local` names a directory of this repository by `path` instead, and is copied from its tracked files
rather than cloned. Those are the offline subset and remain part of the required set, so they measure the working tree: an
uncommitted change to an adapter shows up immediately.

A static Git entry joins the required set only with a reviewed `requiredArchive` block. The block repeats the exact commit
through GitHub's archive API and records `treeSha256`, `licensePath` and `licenseSha256`. Measure acquisition size, audit
cost and distinct adapter or precision coverage before adding one. The required set is a bounded selection rather than a
second name for the full corpus.

Local Deep Researcher is a static required entry because an independent evaluation used it to expose conditional routing,
provider identity, configurable model and search, applicability, semantic identity, and claim-evidence defects together.
At its pinned revision the shallow clone occupies 1,016 KiB including 380 KiB of Git data. Its commit archive is 188,306
compressed bytes and 634,880 expanded archive bytes; the normalized source is 606,447 bytes across 18 files, with a
542,192-byte largest file. The archive and its MIT licence remain inside the existing bounds.

The target's local-model and live-search exercise is not a corpus exercise. It takes about seven minutes, depends on a
separately running local model and changing network results, and is retained as an external original-target release
measurement. No `exercise` block or repository path points to that evaluation from this corpus.

## An entry that runs

Most entries are read and never executed. Exercises cover both languages, provider and hermetic paths, and the one
federated system whose protocol crossing is part of the acceptance evidence. Each execution is explicit because it
installs packages and runs third-party code.

| Entry | Environment | What it drives |
| --- | --- | --- |
| `pydantic-ai-exercised` | `pythonPackages`, installed into a virtual environment under the cache | the repository's own `bank_support` example with the library's own `TestModel` |
| `vercel-ai-chatbot-exercised` | `nodePackages`, installed into a `node_modules` at the root of the cache | the application's own mock model and its own `getWeather` tool, through `@ai-sdk/otel` |

An exercise block declares exactly one of the two package lists, and the script extension has to match. The Node tree
sits at the root of the cache rather than inside the checkout, one directory above it, which is where Node looks next
when a bare import inside a checkout finds nothing closer. Installing into the checkout would edit a pinned third party
repository, and a scan afterwards would measure something other than the commit the corpus names.

Each is a second entry for a repository already in the corpus, at the same commit, because a stored run adds components
and relations to the graph and one expectation cannot describe a repository both with and without its own run. Without
`--exercise` they are skipped and the skip is printed.

Nothing pays for a provider. The Python driver uses the library's own offline model, forces a placeholder API key so a
real one in the environment cannot be picked up, and sets `ALLOW_MODEL_REQUESTS` to false so any attempt to reach a
provider raises instead of sending a request. The Node driver uses the application's own mock model and calls its tool
with no arguments, which is the branch of that tool's own code that answers without contacting a weather service. Both
install and execute third party code, which is why neither happens unless it is asked for.

The expectation records the join by identity: which components joined, which arrived without a counterpart, and which
joins rest on a name alone. That last one is the weak rule, and it is the difference between a join that is
established and a join that is a name meaning one thing in one repository.

A `multiRepositorySystems` exercise is recorded separately as
`corpus/expected/<system>.federation.json`. Its repository list repeats the exact pins and locates the checkouts. The
expectation records only what the run qualifies: eligible coordinates, code-location component joins, accepted
cross-repository relations, services, source coverage and refusals. The OpenAI Agents filesystem MCP system scans the
client and server separately, carries W3C parent context through a real stdio `tools/call`, and refuses the additional
client instrumentation span that has no source identity.

## Both polarities

A repository that is not an agent system is a precision test, and the corpus keeps at least three. A 924 file TypeScript
monorepo once reported 286 components, 258 of which were string literals matched on ordinary English. The number in a
`not_agent_system` expectation is a ceiling, and it is the guard that catches a reader being loosened again.

## Updating a pin

Pins are moved deliberately, not on a schedule. Change the commit, run `--record` for that entry, and read the diff: an
adapter contributing less than it did against a newer commit of the same framework is exactly the drift this corpus is
for, and it deserves a fix rather than a recorded expectation.
