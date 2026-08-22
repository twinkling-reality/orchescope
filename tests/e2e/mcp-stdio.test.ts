import assert from 'node:assert/strict';
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * The agent interface over a real transport.
 *
 * The contract tests in `packages/mcp` hold the shape of the advertised tools without starting anything. This one
 * speaks newline delimited JSON-RPC to the process a coding agent would actually launch, because the promises that
 * only a live server can break are these: that standard output carries protocol traffic and nothing else, that the
 * advertised schemas are what the handlers enforce, and that a refusal comes back as a result an agent can read
 * rather than as a dead transport.
 *
 * Every wait here is driven by the arrival of a response, never by a sleep.
 */

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliEntry = join(repositoryRoot, 'apps/cli/src/main.ts');
const PROTOCOL_VERSION = '2025-06-18';

type Message = Record<string, unknown>;

/** One server process, with its standard output parsed as one JSON-RPC message per line. */
class StdioClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = '';
  private nextId = 1;
  private readonly waiting = new Map<number, (message: Message) => void>();
  readonly lines: string[] = [];
  readonly stderr: string[] = [];

  constructor(cwd: string) {
    this.child = spawn(process.execPath, [cliEntry, '--cwd', cwd, 'mcp', 'serve'], {
      cwd: repositoryRoot,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      let index = this.buffer.indexOf('\n');
      while (index !== -1) {
        const line = this.buffer.slice(0, index).trim();
        this.buffer = this.buffer.slice(index + 1);
        if (line.length > 0) this.accept(line);
        index = this.buffer.indexOf('\n');
      }
    });
    this.child.stderr.on('data', (chunk: string) => {
      this.stderr.push(chunk);
    });
  }

  private accept(line: string): void {
    this.lines.push(line);
    const message = JSON.parse(line) as Message;
    const id = message['id'];
    if (typeof id === 'number') {
      const resolve = this.waiting.get(id);
      if (resolve !== undefined) {
        this.waiting.delete(id);
        resolve(message);
      }
    }
  }

  request(method: string, params: Message = {}): Promise<Message> {
    const id = this.nextId;
    this.nextId += 1;
    const promise = new Promise<Message>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${method} did not answer within the deadline`));
      }, 60_000);
      this.waiting.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return promise;
  }

  notify(method: string, params: Message = {}): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  async close(): Promise<void> {
    const exited = new Promise<void>((resolve) => {
      this.child.once('exit', () => resolve());
    });
    this.child.stdin.end();
    await exited;
  }
}

const roots: string[] = [];
let client: StdioClient;
let handshake: Message;

before(async () => {
  const root = mkdtempSync(join(tmpdir(), 'orchescope-mcp-'));
  roots.push(root);
  cpSync(join(repositoryRoot, 'apps/demo'), root, {
    recursive: true,
    filter: (source) => !source.includes('/node_modules') && !source.includes('/state'),
  });
  client = new StdioClient(root);
  const initialized = await client.request('initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'orchescope-e2e', version: '1.0.0' },
  });
  const result = initialized['result'] as Message | undefined;
  assert.ok(result !== undefined, `initialize failed: ${JSON.stringify(initialized)}`);
  handshake = result;
  client.notify('notifications/initialized');
});

after(async () => {
  await client?.close();
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const callTool = async (name: string, args: Message = {}): Promise<Message> => {
  const response = await client.request('tools/call', { name, arguments: args });
  const result = response['result'] as Message | undefined;
  assert.ok(result !== undefined, `${name} produced no result: ${JSON.stringify(response)}`);
  return result;
};

/** What a client that renders only the text block puts in front of its reader. */
const textOf = (result: Message): string =>
  (result['content'] as readonly { text: string }[]).map((block) => block.text).join('\n');

describe('the agent interface over stdio', () => {
  it('completes the handshake as orchescope, naming the version it advertises tools for', () => {
    const info = handshake['serverInfo'] as { name: string; version: string } | undefined;
    assert.equal(info?.name, 'orchescope');
    assert.match(info?.version ?? '', /^\d+\.\d+\.\d+$/);
    assert.equal(handshake['protocolVersion'], PROTOCOL_VERSION);
    const capabilities = handshake['capabilities'] as Record<string, unknown>;
    assert.ok('tools' in capabilities, 'the server did not advertise the tools capability');
  });

  /*
   * The handshake is the only moment an agent is told anything before it has to choose a tool, and the
   * protocol carries one field for it. A server that advertises many tools and no entry point leaves
   * that choice to a guess between three read only tools, none of them wrong and none of them the start.
   */
  it('tells a connecting agent where the loop starts, before it has called anything', () => {
    const instructions = handshake['instructions'];
    assert.equal(typeof instructions, 'string', 'the handshake carried no instructions');
    const text = instructions as string;
    assert.ok(text.includes('audit_agent_system'), 'the instructions do not name the entry point');
    assert.ok(text.includes('loop.next.tool'), 'the instructions do not name what drives the rest');
  });

  it('answers a ping, so a client can tell a live server from a hung one', async () => {
    const response = await client.request('ping');
    assert.deepEqual(response['result'], {});
  });

  it('advertises every tool with a schema and an honest annotation', async () => {
    const result = (await client.request('tools/list'))['result'] as {
      tools: readonly {
        name: string;
        description: string;
        inputSchema: { type: string; additionalProperties?: boolean };
        annotations: { title: string; readOnlyHint: boolean };
      }[];
    };
    assert.ok(result.tools.length >= 15, `only ${result.tools.length} tools were advertised`);
    for (const tool of result.tools) {
      assert.match(tool.name, /^[a-z][a-z0-9_]*$/);
      assert.ok(tool.description.length > 40, `${tool.name} has a thin description`);
      assert.equal(tool.inputSchema.type, 'object', `${tool.name} does not take an object`);
      assert.equal(
        tool.inputSchema.additionalProperties,
        false,
        `${tool.name} would accept a field it does not understand`,
      );
      assert.ok(tool.annotations.title.length > 0, `${tool.name} has no title`);
    }
    const readOnly = result.tools.filter((tool) => tool.annotations.readOnlyHint);
    assert.ok(readOnly.length > 0, 'no tool is annotated as read only');
  });

  it('scans the repository and returns counts a caller can act on', async () => {
    const result = await callTool('scan_agent_system');
    assert.equal(result['isError'], false, JSON.stringify(result['content']));
    const data = result['structuredContent'] as {
      componentsByKind: Record<string, number>;
      edgeCount: number;
      coverage: { filesParsed: number };
    };
    assert.ok(data.edgeCount > 0, 'the scan reported no relations');
    assert.ok(data.coverage.filesParsed > 0, 'the scan parsed nothing');
    assert.ok(
      Object.values(data.componentsByKind).some((count) => count > 0),
      'the scan found no component of any kind',
    );
  });

  it('pages findings and returns only the ones a goal can be built from when asked', async () => {
    const all = await callTool('get_findings', { limit: 5 });
    const page = all['structuredContent'] as {
      total: number;
      truncated: boolean;
      findings: readonly { id: string; goalEligible: boolean }[];
    };
    assert.ok(page.findings.length > 0, 'no finding was returned');
    assert.ok(page.findings.length <= 5, 'the page was larger than the limit asked for');
    assert.equal(page.truncated, page.findings.length < page.total);

    const eligible = await callTool('get_findings', { limit: 5, goalEligibleOnly: true });
    const filtered = eligible['structuredContent'] as {
      findings: readonly { id: string; goalEligible: boolean }[];
    };
    assert.ok(filtered.findings.length > 0, 'no goal eligible finding was returned');
    for (const finding of filtered.findings) {
      assert.equal(
        finding.goalEligible,
        true,
        `${finding.id} is not eligible and was returned as though it were`,
      );
    }
  });

  it('turns an eligible finding into a goal with a prompt an implementer can follow', async () => {
    const eligible = await callTool('get_findings', { limit: 1, goalEligibleOnly: true });
    const [first] = (eligible['structuredContent'] as { findings: readonly { id: string }[] })
      .findings;
    assert.ok(first !== undefined, 'the demonstration reported no goal eligible finding');

    const created = await callTool('create_improvement_goal', { findingId: first.id });
    assert.equal(created['isError'], false, JSON.stringify(created['content']));
    const content = created['structuredContent'] as {
      goal: {
        id: string;
        findingId: string;
        scope: { allowedWritePaths: readonly string[] };
        acceptanceCriteria: readonly unknown[];
        validation: { commands: readonly { command: readonly string[] }[] };
      };
      agentPrompt: string;
    };
    assert.match(content.goal.id, /^OSC-GOAL-\d+$/);
    assert.equal(content.goal.findingId, first.id);
    assert.ok(
      content.goal.scope.allowedWritePaths.length > 0,
      'the goal bounds no write scope, so a change could not be attributed to it',
    );
    assert.ok(content.goal.acceptanceCriteria.length > 0, 'the goal states nothing to satisfy');
    assert.ok(
      content.goal.validation.commands.every((entry) => entry.command[0] === 'orchescope'),
      'a validation command does not name this tool',
    );
    assert.ok(content.agentPrompt.length > 200, 'the implementer prompt is too thin to act on');
  });

  /*
   * A client that renders `content` and ignores `structuredContent` is still common, and against one of
   * those `get_findings` showed its reader the sentence "2 of 2 findings." and not one word about either.
   * The property is that the text block carries the same answer the structured payload does.
   */
  it('puts the answer in the text block, not only in the structured payload', async () => {
    const result = await callTool('get_findings', { limit: 5 });
    const text = textOf(result);
    const page = result['structuredContent'] as {
      findings: readonly { id: string; title: string; severity: string }[];
    };
    assert.ok(page.findings.length > 0, 'no finding was returned');
    for (const found of page.findings) {
      assert.ok(text.includes(found.id), `the text does not name ${found.id}: ${text}`);
      assert.ok(text.includes(found.title), `the text does not carry the title of ${found.id}`);
      assert.ok(
        text.includes(found.severity),
        `the text does not carry the severity of ${found.id}`,
      );
    }

    const map = await callTool('get_system_map', { limit: 5 });
    const mapText = textOf(map);
    const components = (map['structuredContent'] as { components: readonly { id: string }[] })
      .components;
    for (const component of components) {
      assert.ok(mapText.includes(component.id), `the text does not name ${component.id}`);
    }
  });

  /*
   * Six calls naming one finding produced six identical goals in a real session, because an agent reading
   * the response shape calls this more than once. The tool annotates itself idempotent, so this is the
   * claim being held rather than a preference.
   */
  it('returns the goal a finding already has instead of a second copy of it', async () => {
    const eligible = await callTool('get_findings', { limit: 1, goalEligibleOnly: true });
    const [first] = (eligible['structuredContent'] as { findings: readonly { id: string }[] })
      .findings;
    assert.ok(first !== undefined, 'the demonstration reported no goal eligible finding');

    const goalIdOf = (result: Message): { id: string; created: boolean } => {
      const data = result['structuredContent'] as { goal: { id: string }; created: boolean };
      return { id: data.goal.id, created: data.created };
    };

    const opened = goalIdOf(await callTool('create_improvement_goal', { findingId: first.id }));
    const repeated = goalIdOf(await callTool('create_improvement_goal', { findingId: first.id }));
    assert.equal(repeated.id, opened.id, 'a second call created a second goal for one finding');
    assert.equal(repeated.created, false, 'a reused goal was reported as created');

    const another = await callTool('create_improvement_goal', {
      findingId: first.id,
      createAnother: true,
    });
    const deliberate = goalIdOf(another);
    assert.notEqual(deliberate.id, opened.id, 'createAnother did not cut a second goal');
    assert.equal(deliberate.created, true);
  });

  it('refuses an unknown field instead of ignoring it', async () => {
    const result = await callTool('get_findings', { limit: 1, sevrity: 'high' });
    assert.equal(result['isError'], true, 'a misspelled option was accepted');
    const text = (result['content'] as readonly { text: string }[])[0]?.text ?? '';
    assert.match(text, /sevrity|unknown|Unexpected/i);
  });

  it('names the tool rather than the transport when a tool does not exist', async () => {
    const result = await callTool('teleport_the_agent');
    assert.equal(result['isError'], true);
    const text = (result['content'] as readonly { text: string }[])[0]?.text ?? '';
    assert.match(text, /teleport_the_agent/);
  });

  it('writes nothing to standard output that is not protocol traffic', () => {
    assert.ok(client.lines.length > 0, 'the server said nothing at all');
    for (const line of client.lines) {
      const message = JSON.parse(line) as Message;
      assert.equal(
        message['jsonrpc'],
        '2.0',
        `a line on standard output was not a JSON-RPC message: ${line}`,
      );
    }
  });

  it('keeps its diagnostics on standard error, where a client expects them', () => {
    assert.match(client.stderr.join(''), /orchescope mcp serve: \d+ tools available/);
  });

  /*
   * A server is started once and serves every call in a session, so an upgrade installed while it runs
   * changes nothing a caller can see: the old build keeps answering and nothing in the response says
   * which one is speaking. An agent comparing today's audit against a finding it recorded last week
   * cannot then tell a change in the repository from a change in the reader.
   */
  it('says which build produced the audit, as every command line document already does', async () => {
    const response = await client.request('tools/call', {
      name: 'audit_agent_system',
      arguments: {},
    });
    const result = response['result'] as Message | undefined;
    assert.ok(result !== undefined, `audit produced no result: ${JSON.stringify(response)}`);
    const data = result['structuredContent'] as { orchescopeVersion?: string };
    assert.match(
      data.orchescopeVersion ?? '',
      /^\d+\.\d+\.\d+/,
      `the payload does not name the build: ${JSON.stringify(Object.keys(data))}`,
    );
  });

  /*
   * The scenario files are on disk before anything asks about them, so the first audit of a repository has
   * to see them. It did not: reading them was the caller's job, the command line did it and this interface
   * did not, and an agent whose first call is an audit was told that a repository holding three scenarios
   * held none. What it was handed instead was a placeholder command that the tool it named then refused,
   * so the opening move of the loop was one no agent could play. A fresh server on a fresh copy is the only
   * arrangement that can catch it, because one later call to list_scenarios repairs the store and hides it.
   */
  it('sees the scenarios on disk when an audit is the first call of the session', async () => {
    const root = mkdtempSync(join(tmpdir(), 'orchescope-mcp-first-'));
    roots.push(root);
    cpSync(join(repositoryRoot, 'apps/demo'), root, {
      recursive: true,
      filter: (source) => !source.includes('/node_modules') && !source.includes('/state'),
    });
    const fresh = new StdioClient(root);
    try {
      await fresh.request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'orchescope-e2e', version: '1.0.0' },
      });
      fresh.notify('notifications/initialized');

      const response = await fresh.request('tools/call', {
        name: 'audit_agent_system',
        arguments: {},
      });
      const result = response['result'] as Message | undefined;
      assert.ok(result !== undefined, `audit produced no result: ${JSON.stringify(response)}`);
      const data = result['structuredContent'] as {
        loop: { next: { argv: readonly string[]; tool?: { name: string } } };
        capabilities: readonly { name: string; available: boolean; reason: string }[];
      };

      const next = data.loop.next;
      assert.ok(
        !next.argv.some((word) => word.includes('<')),
        `the first action carried a placeholder: ${next.argv.join(' ')}`,
      );
      assert.equal(next.tool?.name, 'run_scenario');

      for (const name of ['rerun_scenario', 'run_benchmark', 'run_chaos']) {
        const capability = data.capabilities.find((entry) => entry.name === name);
        assert.equal(capability?.available, true, `${name}: ${capability?.reason}`);
      }
    } finally {
      await fresh.close();
    }
  });
});
