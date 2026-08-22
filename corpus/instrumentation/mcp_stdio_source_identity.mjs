/**
 * Instrument real MCP tool handlers in the spawned stdio server.
 *
 * W3C trace context is read from the protocol request `_meta` field. The tool name is the value the
 * server registers, while source identity is captured from the actual registration call site.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { captureNodeSourceIdentity, nodeSourceAttributes } from './node_source_identity.mjs';

const modules = process.env.ORCHESCOPE_CORPUS_MODULES;
if (!modules) throw new Error('the MCP stdio integration requires its isolated modules');

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

const api = await importFromEnvironment('@opentelemetry/api');
const { OTLPTraceExporter } = await importFromEnvironment(
  '@opentelemetry/exporter-trace-otlp-http',
);
const { resourceFromAttributes } = await importFromEnvironment('@opentelemetry/resources');
const { BatchSpanProcessor, NodeTracerProvider } = await importFromEnvironment(
  '@opentelemetry/sdk-trace-node',
);
const { Server } = await importFromEnvironment('@modelcontextprotocol/sdk/server/index.js');
const { McpServer } = await importFromEnvironment('@modelcontextprotocol/sdk/server/mcp.js');

const provider = new NodeTracerProvider({
  resource: resourceFromAttributes({ 'service.name': 'mcp-filesystem-server' }),
  spanProcessors: [
    new BatchSpanProcessor(new OTLPTraceExporter(), {
      exportTimeoutMillis: 3_000,
      maxExportBatchSize: 16,
      maxQueueSize: 64,
      scheduledDelayMillis: 50,
    }),
  ],
});
provider.register();

const tracer = provider.getTracer('orchescope.corpus.mcp_stdio');
const requestMetadata = new AsyncLocalStorage();
const integrationFile = fileURLToPath(import.meta.url);
const patched = Symbol.for('orchescope.corpus.mcp_stdio_source_identity');

if (!Server.prototype[patched]) {
  const setRequestHandler = Server.prototype.setRequestHandler;
  Server.prototype.setRequestHandler = function setSourceAwareRequestHandler(schema, handler) {
    return setRequestHandler.call(this, schema, (request, extra) =>
      requestMetadata.run(request?.params?._meta ?? {}, () => handler(request, extra)),
    );
  };
  Server.prototype[patched] = true;
}

if (!McpServer.prototype[patched]) {
  const registerTool = McpServer.prototype.registerTool;
  McpServer.prototype.registerTool = function registerSourceAwareTool(name, config, callback) {
    const source = captureNodeSourceIdentity([integrationFile]);
    return registerTool.call(this, name, config, (...arguments_) => {
      const parent = api.propagation.extract(api.ROOT_CONTEXT, requestMetadata.getStore() ?? {});
      const parentContext = api.trace.getSpanContext(parent);
      if (parentContext === undefined || !api.isSpanContextValid(parentContext)) {
        throw new Error('the MCP tool request did not carry valid W3C trace context');
      }
      return tracer.startActiveSpan(
        `execute_tool ${name}`,
        {
          kind: api.SpanKind.SERVER,
          attributes: source === undefined ? {} : nodeSourceAttributes(source),
        },
        parent,
        async (span) => {
          try {
            return await callback(...arguments_);
          } catch (error) {
            span.recordException(error);
            span.setStatus({
              code: api.SpanStatusCode.ERROR,
              message: error instanceof Error ? error.message : String(error),
            });
            throw error;
          } finally {
            span.end();
            await provider.forceFlush();
          }
        },
      );
    });
  };
  McpServer.prototype[patched] = true;
}
