/**
 * The agent facing interface: an MCP server over stdio with bounded output, explicit read and effect annotations,
 * and registration helpers for the clients that keep their server list in a file.
 */

export { callTool, type HandlerContext, type ToolOutcome } from './handlers.ts';
export {
  type InstallOptions,
  type InstallResult,
  type InstallTarget,
  installServer,
  installTargets,
  type McpClient,
} from './install.ts';
export { createMcpServer, type McpServerOptions, serveOverStdio } from './server.ts';
export {
  TOOL_DEFINITIONS,
  type ToolAnnotations,
  type ToolDefinition,
  toolByName,
} from './tools.ts';
