/**
 * Exercises the pinned Vercel AI SDK application so a JavaScript run can be joined to the declared graph.
 *
 * The join had only been shown on Python, and instrumentation is the half of it that differs most between languages:
 * a decoder that reads one dialect says nothing about the other. This drives the `ai-chatbot` checkout at the commit
 * `corpus/corpus.yaml` pins, using two pieces of that repository rather than reimplementations of them:
 *
 *   `lib/ai/models.mock.ts`     the repository's own offline model, which it uses for its own end to end tests
 *   `lib/ai/tools/get-weather.ts`  the repository's own tool, declared with the SDK's `tool()`
 *
 * No provider is called and no credential is needed. The tool is invoked with no arguments, which is the branch of
 * the repository's own code that answers without reaching a weather service, so a real third party tool executes and
 * nothing outside this machine is contacted.
 *
 * What this cannot do is run the application's own agents: `generateTitleFromUserMessage` and the chat route are
 * Next.js server actions that need a request, a session and a database. The agent in this run is therefore the
 * driver's own, and it arrives exercised and never declared. That is a result rather than a gap to hide, and it is
 * written up in docs/research/runtime-join-on-third-party-code.md.
 *
 * Spans go wherever OTEL_EXPORTER_OTLP_ENDPOINT points, which is what `orchescope trace` sets. Run it through that:
 *
 *   orchescope --cwd corpus/.cache/vercel-ai-chatbot trace -- \
 *     node corpus/runs/vercel-ai-chatbot/exercise.mjs <checkout> <node_modules>
 *
 * The environment is built by scripts/corpus/exercise.mjs.
 */

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

const [, , checkoutArgument, modulesArgument] = process.argv;
const checkout = resolve(checkoutArgument ?? process.cwd());
const modules = resolve(modulesArgument ?? join(checkout, 'node_modules'));

/*
 * This driver lives in the Orchescope repository, so its own bare imports would resolve against Orchescope's
 * dependencies, which do not include the SDK. Resolving them from the cached tree instead makes the SDK the driver
 * drives the same instance the repository's own tool is built with. The checkout finds that tree by itself: it sits
 * one directory above every checkout, which is where Node looks next.
 */
const fromCache = createRequire(pathToFileURL(join(modules, 'noop.js')));
const cached = (specifier) => pathToFileURL(fromCache.resolve(specifier)).href;

const { OTLPTraceExporter } = await import(cached('@opentelemetry/exporter-trace-otlp-http'));
const { BatchSpanProcessor, NodeTracerProvider } = await import(
  cached('@opentelemetry/sdk-trace-node')
);
const { generateText, registerTelemetry, stepCountIs } = await import(cached('ai'));
const { OpenTelemetry } = await import(cached('@ai-sdk/otel'));

const provider = new NodeTracerProvider({
  spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
});
provider.register();
// From version 7 the SDK emits nothing until a telemetry integration is registered, and this is that integration.
registerTelemetry(new OpenTelemetry());

/*
 * Node runs the checkout's TypeScript directly, and both of these modules are plain enough for type stripping: the
 * mock model imports only a type, and the tool imports the SDK and zod, which the checkout resolves upwards.
 */
const { chatModel } = await import(pathToFileURL(join(checkout, 'lib/ai/models.mock.ts')).href);
const { getWeather } = await import(
  pathToFileURL(join(checkout, 'lib/ai/tools/get-weather.ts')).href
);

/*
 * The repository's mock model always answers with text, because the end to end tests it was written for assert on
 * text. A run that never calls a tool cannot show a tool joining, so the first step is asked for by the driver and
 * every step after it is the repository's model answering. The tool that runs is the repository's own, and it is
 * called with no arguments: that is the branch of its own code which answers without contacting a weather service.
 */
let step = 0;
const model = {
  ...chatModel,
  doGenerate: (options) => {
    step += 1;
    if (step > 1) return chatModel.doGenerate(options);
    return Promise.resolve({
      content: [{ type: 'tool-call', toolCallId: 'corpus-1', toolName: 'getWeather', input: '{}' }],
      finishReason: 'tool-calls',
      usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
      warnings: [],
    });
  },
};

const result = await generateText({
  model,
  prompt: 'What is the weather?',
  tools: { getWeather },
  stopWhen: stepCountIs(3),
  experimental_telemetry: { functionId: 'corpus-exercise' },
});

// What the run did, so a corpus log says whether the tool was reached rather than only that the process exited.
process.stdout.write(`steps: ${result.steps.length}, tool calls: ${result.toolCalls.length}\n`);
await provider.shutdown();
