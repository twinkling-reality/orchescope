/**
 * Recognising a Model Context Protocol call inside the request that carries it.
 *
 * An MCP call over HTTP is a JSON-RPC document in the body of an ordinary POST, so without reading it the
 * only thing an outbound request says is which host was talked to. That is the difference between a run
 * reporting that a system reached `127.0.0.1:9000` and a run reporting that it executed `issue_refund`,
 * and only the second one joins to anything a repository declared. Reconciliation is a join by name, so a
 * span that carries no name for what it did cannot take part in it.
 *
 * The body is a string the caller was about to send anyway. The method and the tool name are taken from
 * it and nothing else is: the arguments to a tool call are the payload of the system under test, and this
 * shim does not read payloads.
 */

export type ProtocolCall = {
  readonly method: string;
  readonly toolName: string | undefined;
};

/** Past this, a body is not a control message and reading it is not worth the pause. */
const BODY_LIMIT = 1_000_000;

const readMethod = (record: Record<string, unknown>): string | undefined => {
  if (record['jsonrpc'] !== '2.0') return undefined;
  const method = record['method'];
  return typeof method === 'string' && method.length > 0 ? method : undefined;
};

/**
 * The tool a `tools/call` names.
 *
 * Only that one method carries a name worth joining on. The rest of the protocol is the conversation that
 * surrounds the calls, and giving `tools/list` a component would put the act of asking what exists into
 * the inventory of what exists.
 */
const readToolName = (record: Record<string, unknown>, method: string): string | undefined => {
  if (method !== 'tools/call') return undefined;
  const parameters = record['params'];
  if (typeof parameters !== 'object' || parameters === null) return undefined;
  const name = (parameters as Record<string, unknown>)['name'];
  return typeof name === 'string' && name.length > 0 ? name : undefined;
};

export const recogniseProtocolCall = (body: string | undefined): ProtocolCall | undefined => {
  if (body === undefined || body.length === 0 || body.length > BODY_LIMIT) return undefined;
  // A cheap rejection first: nearly every body reaching here is not a control message.
  if (!body.includes('"jsonrpc"')) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
  // A batch is a list of calls, and one span cannot honestly name several. The first is what it reports.
  const candidate = Array.isArray(parsed) ? parsed[0] : parsed;
  if (typeof candidate !== 'object' || candidate === null) return undefined;
  const record = candidate as Record<string, unknown>;
  const method = readMethod(record);
  if (method === undefined) return undefined;
  const toolName = readToolName(record, method);
  return { method, ...(toolName === undefined ? { toolName: undefined } : { toolName }) };
};
