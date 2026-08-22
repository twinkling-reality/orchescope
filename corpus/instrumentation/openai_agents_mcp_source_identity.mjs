/**
 * Bounded source-aware wrappers for the pinned OpenAI Agents filesystem MCP example.
 *
 * The wrapper changes execution wiring so the upstream example launches the separately pinned server
 * checkout and exports spans. Component source coordinates still come only from runtime call sites and
 * the clean Git checkout that owns each frame.
 */

import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { captureNodeSourceIdentity, nodeSourceAttributes } from './node_source_identity.mjs';

const modules = process.env.ORCHESCOPE_CORPUS_MODULES;
const serverEntry = process.env.ORCHESCOPE_CORPUS_MCP_SERVER_ENTRY;
if (!modules || !serverEntry) {
  throw new Error('the MCP source integration requires its isolated modules and server entry');
}

const insideEnvironment = pathToFileURL(join(modules, 'orchescope-corpus-driver.mjs')).href;
const isBare = (specifier) =>
  !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.includes(':');
registerHooks({
  resolve: (specifier, context, nextResolve) =>
    context.parentURL === import.meta.url && isBare(specifier)
      ? nextResolve(specifier, { ...context, parentURL: insideEnvironment })
      : nextResolve(specifier, context),
});
const importFromEnvironment = async (specifier) => import(specifier);

const agents = await importFromEnvironment('@openai/agents');
const api = await importFromEnvironment('@opentelemetry/api');
const integrationFile = fileURLToPath(import.meta.url);
const serverPreload = new URL('./mcp_stdio_source_identity.mjs', import.meta.url).href;
const tracer = api.trace.getTracer('orchescope.corpus.openai_agents_mcp');

const agentSources = new WeakMap();
const serverSources = new WeakMap();
const calls = [];
let closeServer;
const serverClosed = new Promise((resolve) => {
  closeServer = resolve;
});

const sourceAttributes = (source) => (source === undefined ? {} : nodeSourceAttributes(source));

const childEnvironment = (supplied) => {
  const inherited = { ...process.env, ...(supplied ?? {}) };
  const existing = inherited.NODE_OPTIONS?.trim();
  inherited.NODE_OPTIONS = [existing, '--enable-source-maps', `--import=${serverPreload}`]
    .filter(Boolean)
    .join(' ');
  inherited.ORCHESCOPE_CORPUS_MODULES = modules;
  return inherited;
};

export class Agent extends agents.Agent {
  constructor(config) {
    const source = captureNodeSourceIdentity([integrationFile]);
    super(config);
    if (source !== undefined) agentSources.set(this, source);
  }
}

export class MCPServerStdio extends agents.MCPServerStdio {
  constructor(options) {
    const source = captureNodeSourceIdentity([integrationFile]);
    if (options.command !== process.execPath || !Array.isArray(options.args) || !options.args[0]) {
      throw new Error('the pinned filesystem example no longer launches a Node package over stdio');
    }
    super({
      ...options,
      args: [serverEntry, ...options.args.slice(1)],
      env: childEnvironment(options.env),
    });
    if (source !== undefined) serverSources.set(this, source);
  }

  callToolResult(toolName, args, meta) {
    return tracer.startActiveSpan(
      `mcp_request ${this.name}`,
      {
        kind: api.SpanKind.CLIENT,
        attributes: sourceAttributes(serverSources.get(this)),
      },
      async (span) => {
        const carrier = {};
        api.propagation.inject(api.context.active(), carrier);
        try {
          const result = await super.callToolResult(toolName, args, {
            ...(meta ?? {}),
            ...carrier,
          });
          calls.push({ toolName, succeeded: result.isError !== true });
          if (result.isError === true) {
            span.setStatus({
              code: api.SpanStatusCode.ERROR,
              message: 'MCP tool returned an error',
            });
          }
          return result;
        } catch (error) {
          calls.push({ toolName, succeeded: false });
          span.recordException(error);
          span.setStatus({
            code: api.SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  }

  async close() {
    try {
      await super.close();
    } finally {
      closeServer();
    }
  }
}

export const run = async (agent, input, options) =>
  tracer.startActiveSpan(
    `invoke_agent ${agent.name}`,
    { attributes: sourceAttributes(agentSources.get(agent)) },
    async (span) => {
      try {
        return await agents.run(agent, input, options);
      } catch (error) {
        span.recordException(error);
        span.setStatus({
          code: api.SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        span.end();
      }
    },
  );

export const withTrace = agents.withTrace;

export const waitForMcpServerClose = () => serverClosed;

export const observedMcpCalls = () => calls.map((call) => ({ ...call }));
