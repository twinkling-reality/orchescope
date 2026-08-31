# Adapter development

Two ways to make Orchescope understand a framework it does not recognise. Start with the manifest; write an adapter when the
manifest becomes repetitive.

## The manifest, first

`.orchescope/manifest.yaml` is a first class input, not a fallback. Anything declared there is a real component with
`manifest` presence, participates in reconciliation, and can be the subject of a finding:

`orchescope init --manifest` writes a template with the accepted vocabulary in it. Filled in, it looks like this:

```yaml
schemaVersion: 3
components:
  - kind: agent
    name: orchestrator
    displayName: Support orchestrator
    runtimeName: orchestrator
    definedIn: src/orchestrator.rb
    definedAtLine: 12
    definedFileHash: efb19fd46138976d5831758880f6127b44fbb64ee49e9fb56e336eba71731655
  - kind: tool
    name: issue_refund
    runtimeName: issue_refund
    definedIn: src/tools/refund.rb
    definedAtLine: 8
    definedFileHash: 28c2165ed23587fc71cc0ec9f59de0b1189771d263b4c86c4ac877b106ce0a34
    sideEffect: financial
    permissions:
      - kind: network
        scope: https://payments.example
        mode: write
edges:
  - kind: calls_tool
    from: orchestrator
    to: issue_refund
    policy:
      retry:
        maxAttempts: 3
        bounded: true
        backoff: exponential
        idempotency: absent
```

An edge endpoint is a component `name`: one declared here, or one another adapter discovered from source, which is what lets
a manifest annotate code Orchescope already reads.

`details` carries the same kind-specific facts an adapter would produce. For an MCP server,
`details: { for: mcp_server, role: consumed }` says this repository connects to the server, while `role: implemented` says
the repository constructs it. A consumed server remains in the graph without making its consumer an agent system by itself.

Every version 3 citation is checked against the repository rather than taken. `definedIn`, `definedAtLine` and
`definedFileHash` are supplied together. The hash is the lowercase SHA-256 of the complete file bytes inspected when the
citation is written. The scan verifies that digest, verifies that the cited UTF-8 line contains the component name or its
`runtimeName`, and records its independently scanned digest on the source location. A stale digest, wrong line, missing
file, escaped path, binary input or file over the scan ceiling fails the adapter and the refuted location stays out of the
graph. The other valid declaration facts remain available.

A `runtimeName` carrying a placeholder is a name no run reports and is refused, and an edge endpoint has to name something
this document declares or another adapter found. Version 1 and version 2 keep their closed readers and their established
meaning. They do not accept `definedFileHash` and do not acquire version 3 verification silently.

This is the whole path for a language Orchescope cannot parse. Runtime evidence still works, because the receiver reads spans
regardless of what wrote them, and `runtimeName` is what joins a span to the declaration.

Two fields carry most of the value. `sideEffect: financial` states the effect class instead of leaving it unknown, and
`policy.retry.idempotency: absent` on the edge is what lets the retry rule fire.

## Writing an adapter

Write one when you would otherwise declare the same shape in every repository. An adapter is a pure function from facts to
drafts:

```ts
export type AgentSystemAdapter = {
  readonly id: string;
  readonly version: string;
  /** The packages this adapter claims to read. A convention reader claims none. */
  readonly packages: readonly string[];
  readonly appliesTo: (context: DiscoveryContext) => boolean;
  readonly discover: (context: DiscoveryContext, builder: SystemGraphBuilder) => AdapterFindings;
};
```

There is no `ecosystem` field, and there was never a use for one: the fact model is language neutral, so one adapter usually
covers a framework in both ecosystems and any answer it gave in advance would be wrong for half the repositories it runs on.
`packages` is the coverage claim instead. Discovery compares it against what the repository actually imports, so an adapter
that claims a framework the repository uses and then finds nothing is reported as a gap in Orchescope rather than left to
read as "no agent system here".

Four rules, and the tooling enforces the first three:

1. **No filesystem, no network, no process.** An adapter receives facts. It never reads a file and never runs anything.
2. **No severity decisions.** An adapter records what it found. Whether that is a problem is a rule's job.
3. **Evidence with everything.** Every draft carries at least one evidence record with a location.
4. **Report honestly.** Return the counts you actually added, a `note` when something could not be resolved, and a
   `problem` when an input the project wrote on purpose could not be used at all, which records the run as failed.

### Fixture first

Write the fixture before the adapter, and write it the way the framework's own documentation writes it rather than the way
you remember. The Python fixtures in this repository were written from each library's published examples and signatures,
and doing it in that order is what found three defects in adapters that were assumed to work: a node registration form
that was dropped, an MCP command nested one level deeper than the reader looked, and an approval flag under a different
case convention. A fixture that agrees with the adapter you already wrote proves nothing.

### What you get

```ts
type DiscoveryContext = {
  projectName: string;
  manifests: ManifestSet;          // declared dependencies, both ecosystems
  modules: readonly ModuleFacts[]; // imports, calls, definitions, texts, control flow
  configs: readonly ConfigDocument[];
  files: readonly { path: string; byteLength?: number }[]; // every path the traversal walked
  citations: readonly CitationSnapshot[]; // bounded line and digest facts for version 3 manifests
  symbols: SymbolIndex;            // exported names across the repository
  bindings: BindingRegistry;       // local name to the component it produced
  implementations: ImplementationSpanRegistry; // the body of a component someone else declared
  callSiteEffects: CallSiteEffects;            // the operation a call site performed, for calls no name stands for
  deadline: Deadline;
};
```

The fact model is language neutral, so one adapter usually covers a framework in both ecosystems: `new Agent({ name })` in
TypeScript and `Agent(name=...)` in Python reduce to the same call fact with the same object entries.

### A minimal adapter

```ts
import { findEntry, objectArgument, stringValue } from '@orchescope/source-analysis';
import type { AdapterFindings, AgentSystemAdapter } from '../adapter.ts';
import { createDrafts, sourceIdentity } from '../drafts.ts';
import { matchCalls, projectUses } from '../matching.ts';

const ADAPTER_ID = 'adapter:my-framework';
const PACKAGES = ['my-framework'];
const drafts = createDrafts(ADAPTER_ID);

export const myFrameworkAdapter: AgentSystemAdapter = {
  id: ADAPTER_ID,
  version: '1',
  packages: PACKAGES,
  appliesTo: (context) => projectUses(context, PACKAGES),
  discover: (context, builder): AdapterFindings => {
    let components = 0;
    const files = new Set<string>();

    for (const match of matchCalls(context.modules, { names: ['Worker'], packages: PACKAGES })) {
      const entries = objectArgument(match.call);
      const name = stringValue(findEntry(entries, 'name')?.value) ?? 'worker';
      const identity = sourceIdentity('agent', match.module.file, name);

      builder.addComponent(
        drafts.sourceComponent({
          kind: 'agent',
          file: match.module.file,
          name,
          location: match.call.location,
          symbol: 'Worker',
          confidence: match.confidence,
          details: { for: 'agent', framework: 'my-framework', role: 'worker' },
          metadata: { framework: 'my-framework', runtimeName: name },
          tags: ['my-framework'],
        }),
      );
      components += 1;
      files.add(match.module.file);
      context.bindings.register(match.module.file, name, identity);
    }

    return { componentsFound: components, edgesFound: 0, filesInspected: [...files] };
  },
};
```

Register it in `packages/discovery/src/registry.ts`. Order matters: configuration adapters first, then frameworks, then the
cross cutting effect and prompt adapters that attach to whatever the earlier ones found.

### The binding registry is how relations work

When you record a component, register the local name that produced it. A later adapter resolving that identifier finds your
component, which is what lets an edge cross a module boundary without guessing:

```ts
context.bindings.register(match.module.file, name, identity);
// elsewhere
const target = context.bindings.lookup(module.file, 'issueRefund');
```

### Confidence

Use the bands rather than inventing a number: `CONFIDENCE_BANDS.deterministic` (0.98) for something read directly,
`strongStructural` (0.85) for a resolved framework call, `structural` (0.75) for a structural match, `heuristic` (0.6) for a
guess from shape. A reader compares two findings on the assumption that the numbers mean the same thing.

**What a band is for.** It is an input to severity, and it is measurably nothing else. `MIN_CONFIDENCE_BY_SEVERITY` caps how
severe a finding may be given the confidence of the evidence under it, so a weak reading cannot produce a critical finding.

**What a band is not for.** It does not decide identity, it does not decide whether a repository is an agent system, and it
does not decide a reconciliation match. `agentSystemDetected` reads a component's kind and whether it belongs to the audited
system, and no threshold; `mergeConfidence` is `Math.max`, so a weak component merged with a strong one takes the strong
number. Every one of the four confidently wrong answers this build has recorded was an identity or a provenance error, and
none is in the range a scalar can express.

So "emit it at `heuristic`" is not a weaker claim than "emit it". It is the same claim with a decoration. A reader who
believes a low band will keep a doubtful component out of the answer is wrong about this build, and an author who reaches
for one instead of naming the provenance that keeps a reading precise has not made the reading safer.
[ADR 0004](../architecture/adr/0004-provenance-not-confidence.md) is the record and the measurement.

## Testing an adapter

Support is only claimed for what a test exercises, so an adapter needs a fixture. `packages/discovery/test/adapters.test.ts`
has one per ecosystem; add yours the same way:

```ts
describe('my framework', () => {
  const build = (workspace: ReturnType<typeof createTempWorkspace>): void => {
    writeNodeProject(workspace, { dependencies: { 'my-framework': '^1.0.0' } });
    workspace.write('src/app.ts', `import { Worker } from 'my-framework';
export const w = new Worker({ name: 'billing' });
`);
  };

  it('discovers the worker', async () => {
    const { ids, adapters } = await scan(build);
    assert.ok(adapters.some((a) => a.adapterId === 'adapter:my-framework' && a.status === 'completed'));
    assert.ok(ids.includes('agent:billing'));
  });
});
```

Assert the identifiers, the relations and the evidence, not the count. A count passes for the wrong reasons.

Then add the framework to the table in [ecosystem support](ecosystem-support.md), because that table is a claim and this
test is what makes it true.

## Then a corpus entry

A fixture agrees with its author: it encodes what you already believed the framework looks like. Pin a real repository
that uses it in [`corpus/corpus.yaml`](../../corpus/corpus.yaml), record what your adapter finds in it, and commit both.
That is what turns the fixture from a demonstration into a measurement, and it is what tells you months later that the
framework moved and your reader went quiet. The [corpus guide](corpus.md) has the steps.

## What not to do

- **Do not infer from a name.** A function called `retry` is not a retry. The shape is the evidence.
- **Do not invent a component to make a graph look complete.** A tool name assembled at runtime is unresolved, and
  unresolved is a reportable state.
- **Do not read the filesystem.** If you need a fact the model does not carry, add it to `packages/source-analysis` so every
  adapter benefits and one traversal still produces it.
- **Do not skip the applicability check.** An adapter that runs everywhere costs every user time and produces noise in
  repositories that do not use the framework.
