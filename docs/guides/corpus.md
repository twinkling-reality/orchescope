# The corpus

Every adapter here was validated against a fixture written by whoever wrote the adapter, which is circular: the fixture
encodes what the author already believed. The corpus is the other half. It pins real repositories at real commits, records
what a scan produces against each one, and fails when a number moves.

That is worth more than another adapter, because it says which adapters matter, it catches a framework moving in the field,
and it turns "does it work" into a gate.

## Running it

```
pnpm corpus:offline    # the entries that need no network, which is what CI requires
pnpm corpus            # every entry, cloning what the cache is missing
node scripts/corpus.mjs --check langgraph flask     # named entries only
```

The first full run clones thirteen repositories into `corpus/.cache`, which git ignores. Later runs reuse the clone and
check out the pinned commit again, so a formatter pointed at the cache cannot change what is measured.

Nothing is vendored. This repository is Apache-2.0 and the corpus is not, so the corpus stays outside it.

## Reading a run

```
langgraphjs  agent system, 750 components, 708 relations
  parse rate    1165/1381 files (84%)
  adapters      effects 334c/221r, langgraph 1240c/1014r, prompts 144c/2r
  blind spots   ai used in source, read by adapter:vercel-ai-sdk; openai used in source, read by adapter:model-sdk
  findings      6 across 2 rule(s), 0 strength(s)
  expectation   matched
```

Three of those lines are the measurement. **Parse rate** is how much of the repository the readers actually saw: a reader
that parsed a third of a tree knows a third of it, and 33% is a real number in this corpus. **Adapters** is what each one
contributed, in components and relations, which is the only honest answer to which adapter is worth maintaining. **Blind
spots** are the frameworks a repository imports that the adapter claiming them read nothing from, and they stay printed
until an adapter earns their removal.

## Reading a difference

A check that differs prints the path that moved:

```
langgraphjs  no agent system, 119 components, 126 relations
  adapters      effects 334c/221r
  blind spots   @langchain/langgraph, langgraph, @langchain/core used in source, read by adapter:langgraph
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
rather than cloned. Those are the offline subset the required gate runs, so they measure the working tree: an uncommitted
change to an adapter shows up immediately.

## Both polarities

A repository that is not an agent system is a precision test, and the corpus keeps at least three. A 924 file TypeScript
monorepo once reported 286 components, 258 of which were string literals matched on ordinary English. The number in a
`not_agent_system` expectation is a ceiling, and it is the guard that catches a reader being loosened again.

## Updating a pin

Pins are moved deliberately, not on a schedule. Change the commit, run `--record` for that entry, and read the diff: an
adapter contributing less than it did against a newer commit of the same framework is exactly the drift this corpus is
for, and it deserves a fix rather than a recorded expectation.
