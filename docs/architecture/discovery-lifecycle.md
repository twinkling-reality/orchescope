# Discovery lifecycle

How a repository becomes a system graph. Every step is deterministic, and no step executes the repository's code.

```
repository
   │  traverse with limits
   ▼
file set ─────────────────────► skipped files, with a reason each
   │  parse per language
   ▼
module facts ─────────────────► languages parsed, bytes, cache hits
   │  one adapter at a time
   ▼
component and edge drafts ────► what each adapter found, or why it did not apply
   │  build
   ▼
system graph ─────────────────► invariants asserted, identifiers minted once
```

## 1. Read what the repository declares about itself

Before any source is parsed, three inputs are read:

- **Manifests.** `package.json`, `pyproject.toml` and requirements files, for the declared dependency set. This is how an
  adapter knows whether a framework is present at all, which is stronger evidence than an import in one file.
- **Configuration documents.** `mcp.json`, `.mcp.json`, `.vscode/mcp.json`, `crew.jsonc`, `agents.yaml` and the Orchescope
  manifest. JSONC comments are stripped by an explicit state machine, because a comment marker inside a string is not a
  comment.
- **The Orchescope manifest**, `.orchescope/manifest.yaml`, which is a first class input rather than a fallback: what it
  declares is `manifest` presence, and its `runtimeName` values are what let a reconciliation match a component whose
  runtime name differs from its source name. Version 3 source citations are snapshotted under the traversal's path, file
  count and byte ceilings. Only requested lines and the scanned byte digest reach the manifest adapter.

## 2. Traverse

Directory entries are read in sorted order so a scan is reproducible. A file is skipped, with the reason recorded, when it
is too large, unreadable, not a regular file, a broken symbolic link, or past the file ceiling. Excluded directories come
from configuration and default to the usual dependency and build directories.

Every extension seen is counted, whether or not it can be parsed, because the count of files in a language nothing here
understands is what the coverage report needs in order to say what was not inspected.

## 3. Extract facts, per language

Parsing produces language neutral facts, so an adapter does not care which parser produced them:

- **imports**: specifier, imported names, whether the import is type only;
- **calls**: callee path, arguments as structured facts, the enclosing function, whether the call was awaited, and the
  location;
- **definitions**: functions, classes, methods and variables, with their initialiser call path when they have one;
- **texts**: string and template literals above a length threshold, with an approximate token count and whether they
  interpolate;
- **control flow**: try/catch, loops, promise grouping and sequential awaits;
- **environment reads**: which variables the module looks at.

Two distinctions in the fact model matter more than they look:

**The enclosing function is not the nearest variable.** A call belongs to the function it sits in. A text belongs to the
declaration that holds it, however deeply nested, which is how the strings inside `const POLICY_DOCUMENTS = [...]` are all
that constant rather than each becoming an anonymous fragment.

**A call records its own arguments.** `openai('gpt-4o-mini')` carries the model identifier in the argument, and an adapter
that could not see it would have to invent a name.

JavaScript and TypeScript are parsed by `oxc-parser` in a single traversal. Python is parsed by tree-sitter through
WebAssembly, with keyword arguments folded into a synthetic object argument so that both languages present the same shape
to an adapter. Facts are cached by content hash, so an unchanged file is not reparsed.

## 4. Run the adapters, in order

Order is deliberate. Configuration adapters run first, because a declaration is stronger evidence than an inference; then
framework adapters; then the cross cutting adapters that attach effects and prompts to whatever the earlier ones found.

```
mcp → manifest → workers-bindings → openai-agents → langchain-v1-create-agent → langgraph → crewai → pydantic-ai → vercel-ai-sdk
  → model-sdk → langchain-legacy-agent → search-index → effects → prompts
  → implementation-reach
```

Each adapter declares `appliesTo`, which is checked before it runs, and returns what it found. An adapter that does not
apply is recorded as `not_applicable` rather than omitted, so the coverage block can say which frameworks were looked for.

A **binding registry** carries names across adapters: when the OpenAI adapter records `issueRefund` as `tool:issue_refund`,
a later adapter resolving the identifier `issueRefund` in another module finds the same component. That is how an edge from
an agent in one file to a tool in another gets drawn without guessing.

Confidence is banded rather than invented per call site: `0.98` for something read deterministically, `0.85` for a strong
structural match, `0.75` for a structural one, `0.6` for a heuristic, `0.4` for weak. A reader can compare two findings
because the numbers mean the same thing everywhere.

## 5. Build

The builder collects drafts by identity, merges repeated discoveries of the same component (union of adapters, strongest
basis, highest confidence, all evidence), mints identifiers once at the end, resolves collisions deterministically, and
asserts every invariant before returning a graph.

Nothing is written to disk until this succeeds.

## What discovery deliberately does not do

- **It does not run your code.** Not an import, not a module top level, nothing. Every conclusion comes from syntax,
  configuration or a manifest.
- **It does not resolve values across module boundaries beyond named bindings.** A tool name assembled at runtime from a
  variable is recorded as unresolved rather than guessed.
- **It does not infer intent from a name.** A function called `retry` is not a retry; a loop containing a try containing a
  call is, and it is recorded with `bounded: false` because nothing in the syntax states a limit.
- **It does not treat an absence as a negative.** A tool with no timeout in the source is reported as "no timeout was
  declared here", not "this tool has no timeout".

## Where to look

- `packages/source-analysis/src/file-set.ts`: traversal and skip reasons.
- `packages/source-analysis/src/javascript/analyze.ts`, `python/analyze.ts`: fact extraction.
- `packages/discovery/src/adapters/`: one file per ecosystem.
- `packages/graph/src/graph-builder.ts`: merging, identifier minting, invariants.
