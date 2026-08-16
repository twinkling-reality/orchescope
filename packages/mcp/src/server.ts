import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { asOrchescopeError, isOrchescopeError } from '@orchescope/domain';
import { callTool, type HandlerContext } from './handlers.ts';
import { TOOL_DEFINITIONS } from './tools.ts';

/**
 * The MCP server.
 *
 * The low level protocol API is used rather than the schema helper, so tool schemas stay the TypeBox definitions the
 * rest of Orchescope validates against and the interface an agent sees cannot drift from the interface the handlers
 * enforce.
 *
 * A failed tool call returns a protocol level error result with the remediation attached, rather than throwing.
 * An agent needs to be told what to change; a transport error tells it nothing.
 */

export type McpServerOptions = {
  readonly context: HandlerContext;
  readonly onNotice?: (message: string) => void;
};

export const createMcpServer = (options: McpServerOptions): Server => {
  const server = new Server(
    { name: 'orchescope', version: options.context.orchescopeVersion },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: JSON.parse(JSON.stringify(tool.input)) as Record<string, unknown>,
      annotations: {
        title: tool.annotations.title,
        readOnlyHint: tool.annotations.readOnlyHint,
        destructiveHint: tool.annotations.destructiveHint,
        idempotentHint: tool.annotations.idempotentHint,
        openWorldHint: tool.annotations.openWorldHint,
      },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    try {
      const outcome = await callTool(options.context, name, request.params.arguments);
      /*
       * The digest joins the headline into one text block rather than becoming a second one. A client
       * that renders only the first block would otherwise be back where it started.
       */
      const text = [outcome.text, ...(outcome.digest ?? [])].join('\n');
      return {
        content: [{ type: 'text' as const, text }],
        structuredContent: outcome.data,
        isError: outcome.isError ?? false,
      };
    } catch (error) {
      const failure = isOrchescopeError(error) ? error : asOrchescopeError(error);
      options.onNotice?.(`${name} failed: ${failure.message}`);
      const remediation = failure.remediation === undefined ? '' : ` ${failure.remediation}`;
      return {
        content: [
          {
            type: 'text' as const,
            text: `${failure.code}: ${failure.message}${remediation}`,
          },
        ],
        structuredContent: { ok: false, error: failure.toJSON() },
        isError: true,
      };
    }
  });

  return server;
};

export const serveOverStdio = async (options: McpServerOptions): Promise<() => Promise<void>> => {
  const server = createMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return async () => {
    await server.close();
  };
};
