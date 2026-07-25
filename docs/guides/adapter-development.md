# Adapter development

Two ways to make Orchescope understand a framework it does not recognise. Start with the manifest; write an adapter when the
manifest becomes repetitive.

## The manifest, first

`.orchescope/manifest.yaml` is a first class input, not a fallback. Anything declared there is a real component with
`manifest` presence, participates in reconciliation, and can be the subject of a finding:

`orchescope init --manifest` writes a template with the accepted vocabulary in it. Filled in, it looks like this:

```yaml
schemaVersion: 1
components:
  - kind: agent
    name: orchestrator
    displayName: Support orchestrator
    runtimeName: orchestrator
    definedIn: src/orchestrator.rb
    definedAtLine: 12
  - kind: tool
    name: issue_refund
    runtimeName: issue_refund
    definedIn: src/tools/refund.rb
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
  readonly ecosystem: 'javascript' | 'python' | 'configuration' | 'manifest';
  readonly appliesTo: (context: DiscoveryContext) => boolean;
  readonly discover: (context: DiscoveryContext, builder: SystemGraphBuilder) => AdapterFindings;
};
```

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
  symbols: SymbolIndex;            // exported names across the repository
  bindings: BindingRegistry;       // local name to the component it produced
  deadline: Deadline;
};
```

The fact model is language neutral, so one adapter usually covers a framework in both ecosystems: `new Agent({ name })` in
TypeScript and `Agent(name=...)` in Python reduce to the same call fact with the same object entries.

### A minimal adapter

```ts
import { CONFIDENCE_BANDS } from '@orchescope/domain';
import type { AdapterFindings, AgentSystemAdapter } from '../adapter.ts';
import { createDrafts, sourceIdentity } from '../drafts.ts';
import { findEntry, matchCalls, objectArgument, projectUses, stringValue } from '../matching.ts';

const ADAPTER_ID = 'adapter:my-framework';
const PACKAGES = ['my-framework'];
const drafts = createDrafts(ADAPTER_ID);

export const myFrameworkAdapter: AgentSystemAdapter = {
  id: ADAPTER_ID,
  version: '1',
  ecosystem: 'javascript',
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

    return { componentsFound: components, edgesFound: 0, filesInspected: files.size };
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

Then add the framework to the support table in the README, because that table is a claim and this test is what makes it
true.

## What not to do

- **Do not infer from a name.** A function called `retry` is not a retry. The shape is the evidence.
- **Do not invent a component to make a graph look complete.** A tool name assembled at runtime is unresolved, and
  unresolved is a reportable state.
- **Do not read the filesystem.** If you need a fact the model does not carry, add it to `packages/source-analysis` so every
  adapter benefits and one traversal still produces it.
- **Do not skip the applicability check.** An adapter that runs everywhere costs every user time and produces noise in
  repositories that do not use the framework.
