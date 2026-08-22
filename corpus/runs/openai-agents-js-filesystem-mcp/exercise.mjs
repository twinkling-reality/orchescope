/**
 * Exercise the pinned OpenAI Agents filesystem example across its real stdio server boundary.
 *
 * The client example and server implementation are both upstream source at their pinned revisions. This
 * driver supplies a deterministic model, source-aware instrumentation and execution wiring to the compiled
 * server checkout. Repository identity is derived inside the two processes from runtime frames and Git.
 *
 * The three upstream prompts still run. The first model response selects `read_text_file` only after the
 * real server advertises it, calls it with an allowed upstream sample file, and then answers without a
 * provider. A missing tool, failed result, absent W3C parent or source-map failure makes the proof fail.
 */

import { execFileSync } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , clientArgument, modulesArgument, serverArgument] = process.argv;
if (!clientArgument || !modulesArgument || !serverArgument) {
  throw new Error('expected the client checkout, isolated node_modules and server checkout');
}

const directory = (value) => {
  const found = realpathSync(resolve(value));
  if (!statSync(found).isDirectory()) throw new Error(`${found} is not a directory`);
  return found;
};

const clientCheckout = directory(clientArgument);
const modules = directory(modulesArgument);
const serverCheckout = directory(serverArgument);
const serverPackage = join(serverCheckout, 'src/filesystem');
const serverEntry = join(serverPackage, 'dist/index.js');
const example = join(clientCheckout, 'examples/mcp/filesystem-example.ts');
const exampleUrl = pathToFileURL(example).href;
const integrationUrl = new URL(
  '../../instrumentation/openai_agents_mcp_source_identity.mjs',
  import.meta.url,
).href;

const require = createRequire(pathToFileURL(join(modules, 'orchescope-corpus-driver.mjs')));
const insideEnvironment = pathToFileURL(join(modules, 'orchescope-corpus-driver.mjs')).href;
const isBare = (specifier) =>
  !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.includes(':');
const importFromEnvironment = async (specifier) => import(specifier);

execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    '--project',
    join(serverPackage, 'tsconfig.json'),
    '--sourceMap',
    'true',
    '--inlineSources',
    'false',
  ],
  {
    cwd: serverPackage,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

process.env.OPENAI_AGENTS_DISABLE_TRACING = '1';
process.env.ORCHESCOPE_CORPUS_MODULES = modules;
process.env.ORCHESCOPE_CORPUS_MCP_SERVER_ENTRY = serverEntry;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@openai/agents' && context.parentURL === exampleUrl) {
      return { shortCircuit: true, url: integrationUrl };
    }
    if (context.parentURL === import.meta.url && isBare(specifier)) {
      return nextResolve(specifier, { ...context, parentURL: insideEnvironment });
    }
    return nextResolve(specifier, context);
  },
});

const { OTLPTraceExporter } = await importFromEnvironment(
  '@opentelemetry/exporter-trace-otlp-http',
);
const { resourceFromAttributes } = await importFromEnvironment('@opentelemetry/resources');
const { BatchSpanProcessor, NodeTracerProvider } = await importFromEnvironment(
  '@opentelemetry/sdk-trace-node',
);
const agents = await importFromEnvironment('@openai/agents');
const integration = await import(integrationUrl);

const provider = new NodeTracerProvider({
  resource: resourceFromAttributes({ 'service.name': 'openai-agents-filesystem-example' }),
  spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
});
provider.register();
agents.setTracingDisabled(true);

const selectedCalls = new Set();
const sampleFile = join(dirname(example), 'sample_files/books.txt');

const functionCall = (name, arguments_) => ({
  type: 'function_call',
  callId: `corpus-${selectedCalls.size + 1}`,
  name,
  arguments: JSON.stringify(arguments_),
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
    const tool = (request.tools ?? []).find((candidate) => candidate.name === 'read_text_file');
    if (!selectedCalls.has('read_text_file')) {
      if (tool === undefined) {
        throw new Error('the pinned filesystem server did not advertise read_text_file');
      }
      selectedCalls.add(tool.name);
      return Promise.resolve({
        usage: new agents.Usage(),
        output: [functionCall(tool.name, { path: sampleFile, head: 1 })],
      });
    }
    return Promise.resolve({
      usage: new agents.Usage(),
      output: [finalAnswer('The filesystem result was read successfully.')],
    });
  },
  getStreamedResponse() {
    throw new Error('the pinned filesystem example does not stream');
  },
};

agents.setDefaultModelProvider({ getModel: async () => scriptedModel });
globalThis.__dirname = dirname(example);

try {
  await import(exampleUrl);
  await integration.waitForMcpServerClose();
  const calls = integration.observedMcpCalls();
  if (
    calls.length !== 1 ||
    calls[0]?.toolName !== 'read_text_file' ||
    calls[0]?.succeeded !== true
  ) {
    throw new Error(`the real MCP tool call did not succeed: ${JSON.stringify(calls)}`);
  }
  process.stdout.write('crossing tool: read_text_file, result: succeeded\n');
  await provider.forceFlush();
} finally {
  await provider.shutdown();
}
