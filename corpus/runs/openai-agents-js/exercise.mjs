/**
 * Exercises the pinned customer service example so an OpenAI Agents run in JavaScript can be joined to the
 * declared graph.
 *
 * The OpenAI Agents dialect had been measured in one ecosystem, and it is the richest source of defects this
 * build has had: `openai-cs-agents-demo-exercised` is where a handoff arriving as a tool call, an
 * instrumentation's own wrapper spans becoming components, and a provider written under only one of two
 * attribute names were each found. Every one of those is a claim about what one program emits.
 * `@arizeai/openinference-instrumentation-openai-agents` is a different program, and nothing in this build had
 * ever read a span it wrote.
 *
 * The example is the repository's own, and so are the agents, the tools and the handoffs between them. What
 * the driver supplies is the model, and three things follow from that.
 *
 * **The run is hermetic and needs no credential.** `setDefaultModelProvider` is the SDK's own way to say
 * where completions come from, so a model that answers from a script reaches nothing outside this process.
 *
 * **The run is reproducible, which a run against a provider was not.** Driven by `gpt-4o-mini` the same
 * conversation produced eight spans, then eleven, then eight: the seat agent follows a routine that asks for a
 * confirmation number, and whether it asks again before calling its tool is the model's choice. A corpus entry
 * pins a span count, so the decisions have to be the driver's.
 *
 * **The script chooses from what the request offers rather than from a name written here.** Each call takes
 * the first of the handoff and the tool that the agent actually holds and has not used, so what runs is
 * whatever the repository declared, and a rename there changes the run rather than silently skipping it.
 *
 * Two mechanics are worth stating because each one was a failure before it was a line of this file.
 *
 * **The example is a terminal loop.** It builds a readline interface over `process.stdin` at module scope and
 * asks for a message until the stream ends, so one scripted turn followed by end of file is the whole
 * conversation.
 *
 * **The example is loaded by Node rather than by a compiler.** Its TypeScript imports nothing by a `.js`
 * specifier and imports no type as a value, so type stripping runs it as it stands. That matters beyond
 * convenience: `tsx` resolves a bare specifier to its own instance of a package, so a driver that instruments
 * `@openai/agents` and then loads the example through `tsx` instruments a copy the example never uses, and the
 * run produces no span at all while exiting zero.
 *
 * Spans go wherever `OTEL_EXPORTER_OTLP_ENDPOINT` points, which is what `orchescope trace` sets before it runs
 * a command:
 *
 *   orchescope --cwd corpus/.cache/openai-agents-js-exercised trace -- \
 *     node corpus/runs/openai-agents-js/exercise.mjs <checkout> <node_modules>
 *
 * The environment is built by scripts/corpus/exercise.mjs.
 */

import { registerHooks } from 'node:module';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
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

/** The transfer and the tool this conversation is meant to walk, in the order it walks them. */
const SCRIPT = [
  ['transfer_to_Seat_Booking_Agent', {}],
  ['update_seat', { confirmationNumber: 'IR-D204', seatNumber: '14A' }],
];

const used = new Set();

const functionCall = (name, args) => ({
  type: 'function_call',
  callId: `corpus-${used.size + 1}`,
  name,
  arguments: JSON.stringify(args),
  status: 'completed',
});

const finalAnswer = (text) => ({
  type: 'message',
  role: 'assistant',
  status: 'completed',
  content: [{ type: 'output_text', text }],
});

const scriptedModel = {
  getResponse(request) {
    const offered = (name) =>
      (request.handoffs ?? []).some((handoff) => handoff.toolName === name) ||
      (request.tools ?? []).some((tool) => tool.name === name);
    for (const [name, args] of SCRIPT) {
      if (!used.has(name) && offered(name)) {
        const call = functionCall(name, args);
        used.add(name);
        return Promise.resolve({ usage: new agents.Usage(), output: [call] });
      }
    }
    return Promise.resolve({
      usage: new agents.Usage(),
      output: [finalAnswer('Your seat is now 14A.')],
    });
  },
  /*
   * The example never streams. Answering a request that was never made would be a fiction, so this refuses
   * rather than returning nothing, and a checkout that starts streaming fails here instead of going quiet.
   */
  getStreamedResponse() {
    throw new Error('the customer service example does not stream, and this model does not either');
  },
};

agents.setDefaultModelProvider({ getModel: async () => scriptedModel });

const conversation = Readable.from([
  'I want to change my seat to 14A. My confirmation number is IR-D204.\n',
]);
Object.defineProperty(process, 'stdin', { value: conversation, configurable: true });

await import(pathToFileURL(join(checkout, 'examples/customer-service/index.ts')).href);

// The example's loop ends at end of file, and its turn is still in flight when the import resolves.
await new Promise((settle) => process.once('beforeExit', settle));

// What the run did, so a corpus log says whether the transfer was reached rather than only that it exited.
process.stdout.write(`script used: ${[...used].join(', ')}\n`);
await provider.shutdown();
