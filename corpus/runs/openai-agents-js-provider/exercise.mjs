/**
 * Exercises the pinned repository's own one agent example against a real provider, so that one model call
 * watched by two producers is measured somewhere other than a unit test.
 *
 * `orchescope trace` patches `fetch` in the target so that a system with no instrumentation of its own still
 * says something. A system worth auditing usually has its own, and then both watch the same request: this
 * build from outside, the target's instrumentation from inside the SDK that made it. 0.8.0 taught the reader
 * to keep the better placed of the two and to stop naming a model call after the host that served it, and
 * **no corpus entry witnessed either change**. Every entry carrying a run drove an offline model, or ran
 * Python where the shim does not apply, or reached a provider through `openai@4`, which bundles `node-fetch`
 * and is invisible to a patch on `globalThis.fetch`.
 *
 * This one is none of those. `@openai/agents` resolves `openai@6`, which has no dependencies and makes its
 * requests with `globalThis.fetch`, so the shim sees the call the SDK's own instrumentor is already
 * reporting.
 *
 * **The example is the repository's own and the driver supplies nothing.** `examples/basic/hello-world.ts`
 * builds one agent with no tools and runs one turn, which is the whole reason it can be pinned: the sibling
 * entry drives the customer service example, where the same conversation against a real `gpt-4o-mini`
 * produced eight spans, then eleven, then eight, because whether the seat agent asks for a confirmation
 * number again is the model's decision. An agent holding no tool and no handoff has no decision to make. It
 * answers once, and one turn is one model call whatever it says.
 *
 * So the driver registers the instrumentation and gets out of the way. It sets no model provider, which is
 * what separates this run from the hermetic one: the SDK opens a generation span from its own model
 * implementations and not from somebody else's, so the sibling entry reports no model span at all and this
 * one reports the only thing it is here to measure.
 *
 * Two mechanics are inherited from the sibling driver because each was a failure before it was a line of it.
 * The example is loaded by Node rather than by a compiler, and a bare specifier written here is resolved as
 * though it were written inside the environment, so the driver instruments the SDK instance the example
 * runs rather than a second copy of it. And the example's turn is still in flight when the import resolves,
 * so the run waits for the process to drain before the exporter is flushed.
 *
 * Spans go wherever `OTEL_EXPORTER_OTLP_ENDPOINT` points, which is what `orchescope trace` sets before it
 * runs a command:
 *
 *   orchescope --cwd corpus/.cache/openai-agents-js-provider-exercised trace -- \
 *     node corpus/runs/openai-agents-js-provider/exercise.mjs <checkout> <node_modules>
 *
 * The environment is built by scripts/corpus/exercise.mjs, and `OPENAI_API_KEY` has to be in it: the run
 * reaches the provider, which is why the entry names it in `requiresEnvironment` and a machine without it is
 * skipped with the reason printed.
 */

import { registerHooks } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , checkoutArgument, modulesArgument] = process.argv;
const checkout = resolve(checkoutArgument ?? process.cwd());
const modules = resolve(modulesArgument ?? join(checkout, 'node_modules'));

/*
 * A position in the tree rather than a module. A bare specifier written in this file resolves the way the same
 * specifier written inside the checkout does, so the driver instruments the SDK instance the example runs.
 */
const insideTheEnvironment = pathToFileURL(join(modules, 'orchescope-corpus-driver.mjs')).href;
const isBare = (specifier) =>
  !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.includes(':');

registerHooks({
  resolve: (specifier, context, nextResolve) =>
    context.parentURL === import.meta.url && isBare(specifier)
      ? nextResolve(specifier, { ...context, parentURL: insideTheEnvironment })
      : nextResolve(specifier, context),
});

const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
const { BatchSpanProcessor, NodeTracerProvider } = await import('@opentelemetry/sdk-trace-node');
const { OpenAIAgentsInstrumentation } = await import(
  '@arizeai/openinference-instrumentation-openai-agents'
);
const agents = await import('@openai/agents');

const provider = new NodeTracerProvider({
  spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
});
provider.register();
new OpenAIAgentsInstrumentation({ tracerProvider: provider }).manuallyInstrument(agents);

await import(pathToFileURL(join(checkout, 'examples/basic/hello-world.ts')).href);

// The example's turn is still in flight when the import resolves.
await new Promise((settle) => process.once('beforeExit', settle));

await provider.shutdown();
