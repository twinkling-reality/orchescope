/**
 * Exercises the pinned memory agent so a LangGraph run in JavaScript can be joined to the declared graph.
 *
 * The LangChain dialect had been measured in one ecosystem. `open-deep-research-exercised` traced a Python LangGraph
 * application and found that the rule deciding whether a chain span reports a component or the instrumentation's own
 * structure deleted the application, and the reading that repaired it hangs on one attribute shape: an OpenInference
 * `metadata` document carrying `langgraph_node`, on a span the graph named after that node. Nothing in this build had
 * ever seen what the JavaScript instrumentor writes, and a fact read in Python is not read in JavaScript.
 *
 * `@arizeai/openinference-instrumentation-langchain` is the instrumentor, for the same reason its Python sibling is:
 * LangGraph's own tracing exports to LangSmith rather than over OTLP, and this one hangs off LangChain's callback
 * manager, so every node of the compiled graph becomes a span whatever the application did to build it.
 *
 * Three things about running somebody else's TypeScript from here are worth stating, because each one was a failure
 * before it was a line of this file.
 *
 * **The instrumentor patches a class, so it has to be handed the copy the application runs.** `@langchain/core` ships
 * a CommonJS build and an ECMAScript one, and they hold two different `CallbackManager` classes. `createRequire`,
 * which is what the Node driver beside this one uses, resolves under the `require` condition and answers with the
 * first; the checkout imports and gets the second. Patching the copy the application never runs is silent: the graph
 * runs, the process exits zero, and no span is produced at all. The resolve hook below is what makes a bare specifier
 * written here resolve the way the same specifier written inside the checkout does.
 *
 * **The checkout's TypeScript is not the kind Node can strip.** Its modules import their siblings with `.js`
 * specifiers that name `.ts` files, and they import types through value imports, so type stripping leaves an import
 * of a binding that does not exist at runtime. `tsx` compiles rather than strips, which is what the repository's own
 * tooling does with it.
 *
 * **The application expects a store its platform normally supplies.** Both nodes read `config.store`, and the driver
 * passes the library's own in memory one, so the memory the agent writes goes nowhere outside this process.
 *
 * The run is bounded on purpose: one message, `openai/gpt-4o-mini`, and a recursion limit of six. What that buys is
 * the whole declared graph, which is two nodes and one tool: the model answers with a call to `upsertMemory`, so
 * `call_model` routes to `store_memory`, which routes back, and the second answer ends the run. It reaches a real
 * provider, which is why the entry names `OPENAI_API_KEY` in `requiresEnvironment` and a machine without it is
 * skipped with the reason printed.
 *
 * Spans go wherever `OTEL_EXPORTER_OTLP_ENDPOINT` points, which is what `orchescope trace` sets before it runs a
 * command:
 *
 *   orchescope --cwd corpus/.cache/memory-agent-js-exercised trace -- \
 *     node corpus/runs/memory-agent-js/exercise.mjs <checkout> <node_modules>
 *
 * The environment is built by scripts/corpus/exercise.mjs.
 */

import { registerHooks } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , checkoutArgument, modulesArgument] = process.argv;
const checkout = resolve(checkoutArgument ?? process.cwd());
const modules = resolve(modulesArgument ?? join(checkout, 'node_modules'));

/*
 * A file that never has to exist: it is a position in the tree rather than a module, and what Node reads from it is
 * the chain of node_modules directories above it, which is the chain the checkout resolves against.
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
const { LangChainInstrumentation } = await import(
  '@arizeai/openinference-instrumentation-langchain'
);
const callbacks = await import('@langchain/core/callbacks/manager');

const provider = new NodeTracerProvider({
  spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
});
provider.register();
new LangChainInstrumentation().manuallyInstrument(callbacks);

const tsx = await import('tsx/esm/api');
tsx.register();

const { InMemoryStore } = await import('@langchain/langgraph');
const { graph } = await import(pathToFileURL(join(checkout, 'src/memory_agent/graph.ts')).href);

const result = await graph.invoke(
  {
    messages: [{ role: 'user', content: 'Remember that I am learning French for a move to Lyon.' }],
  },
  {
    store: new InMemoryStore(),
    configurable: { userId: 'corpus', model: 'openai/gpt-4o-mini' },
    recursionLimit: 6,
  },
);

// What the run did, so a corpus log says whether the tool was reached rather than only that the process exited.
const calling = result.messages.filter((message) => (message.tool_calls ?? []).length > 0).length;
process.stdout.write(`messages: ${result.messages.length}, tool calling turns: ${calling}\n`);
await provider.shutdown();
