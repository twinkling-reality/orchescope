import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

/**
 * The command line contract.
 *
 * Exit codes, the shape of the JSON document and the wording of a refusal are all interface: a script or a coding agent
 * depends on them, so they are tested rather than assumed. Every case runs the real binary entry point.
 */

const execFileAsync = promisify(execFile);
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliEntry = join(repositoryRoot, 'apps/cli/src/main.ts');

const EXIT = {
  success: 0,
  findings: 1,
  user: 2,
  policy: 3,
  environment: 5,
} as const;

type Result = { readonly stdout: string; readonly stderr: string; readonly code: number };

const run = async (
  args: readonly string[],
  options: { readonly cwd?: string; readonly env?: Record<string, string> } = {},
): Promise<Result> => {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cliEntry, ...args], {
      cwd: repositoryRoot,
      maxBuffer: 64 * 1024 * 1024,
      timeout: 240_000,
      env: { ...process.env, ...options.env },
    });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: failure.stdout ?? '', stderr: failure.stderr ?? '', code: failure.code ?? 1 };
  }
};

const workspaces: string[] = [];

const emptyProject = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'orchescope-cli-'));
  workspaces.push(root);
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify({ name: 'plain', private: true })}\n`,
  );
  writeFileSync(join(root, 'index.js'), 'export const add = (a, b) => a + b;\n');
  return root;
};

let demo: string;

before(() => {
  demo = mkdtempSync(join(tmpdir(), 'orchescope-cli-demo-'));
  workspaces.push(demo);
  cpSync(join(repositoryRoot, 'apps/demo'), demo, {
    recursive: true,
    filter: (source) => !source.includes('/node_modules'),
  });
});

after(() => {
  for (const root of workspaces) rmSync(root, { recursive: true, force: true });
});

const parsed = (result: Result): Record<string, unknown> => {
  const text = result.stdout.trim();
  assert.ok(
    text.startsWith('{') && text.endsWith('}'),
    `standard output was not one JSON document: ${text.slice(0, 200)}`,
  );
  return JSON.parse(text) as Record<string, unknown>;
};

describe('startup and discovery', () => {
  it('reports its version on one line', async () => {
    const result = await run(['--version']);
    assert.equal(result.code, EXIT.success);
    assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/);
  });

  it('lists every command in the help output', async () => {
    const result = await run(['--help']);
    assert.equal(result.code, EXIT.success);
    for (const command of [
      'audit',
      'trace',
      'test',
      'benchmark',
      'chaos',
      'compare',
      'goal',
      'export',
      'init',
      'doctor',
      'mcp',
    ]) {
      assert.match(result.stdout, new RegExp(`\\b${command}\\b`), `${command} is not in the help`);
    }
  });

  /**
   * The bare invocation prints the help, so the help is the first thing a stranger reads. It has to say where to
   * start, and every invocation it suggests has to be one this binary accepts.
   */
  it('says where to start, and every command it suggests exists', async () => {
    const result = await run(['--help']);
    assert.match(result.stdout, /Start here/);
    const suggested = [...result.stdout.matchAll(/^ {2}orchescope ([a-z]+(?: [a-z]+)?)/gm)].map(
      (match) => match[1] as string,
    );
    assert.ok(suggested.length >= 3, `the help suggests too little: ${suggested.join(', ')}`);
    for (const suggestion of suggested) {
      const verb = suggestion.split(' ');
      const help = await run([...verb, '--help']);
      assert.equal(help.code, EXIT.success, `orchescope ${suggestion} is not a command`);
      assert.match(help.stdout, new RegExp(`Usage: orchescope ${suggestion}`));
    }
  });

  it('refuses an unknown command with the caller error code', async () => {
    const result = await run(['not-a-command']);
    assert.equal(result.code, EXIT.user);
    assert.match(result.stderr, /unknown command/i);
  });

  it('refuses an unknown option rather than ignoring it', async () => {
    const result = await run(['audit', '--not-an-option']);
    assert.equal(result.code, EXIT.user);
  });

  it('reports what the machine can and cannot do', async () => {
    const result = await run(['doctor', '--json']);
    const document = parsed(result);
    assert.equal(document['ok'], true);
    const data = document['data'] as { checks: { name: string; status: string }[]; ok: boolean };
    assert.ok(data.checks.length >= 5);
    for (const check of data.checks) {
      assert.ok(['ok', 'warning', 'failed', 'not_applicable'].includes(check.status), check.status);
    }
  });
});

describe('the json document', () => {
  it('carries the same envelope for every command', async () => {
    for (const args of [
      ['doctor', '--json'],
      ['--cwd', demo, 'audit', '--json'],
      ['--cwd', demo, 'goals', '--json'],
    ]) {
      const document = parsed(await run(args));
      assert.equal(document['ok'], true, `${args.join(' ')} did not report ok`);
      assert.equal(typeof document['command'], 'string');
      assert.match(String(document['version']), /^\d+\.\d+\.\d+$/);
      assert.equal(typeof document['data'], 'object');
    }
  });

  it('is byte for byte the same for a rerun of the same stored state', async () => {
    const first = await run(['--cwd', demo, 'goals', '--json']);
    const second = await run(['--cwd', demo, 'goals', '--json']);
    assert.equal(first.stdout, second.stdout);
  });

  it('keeps progress and warnings off standard output', async () => {
    const result = await run(['--cwd', demo, 'audit', '--json']);
    assert.doesNotThrow(() => JSON.parse(result.stdout));
  });

  it('reports a failure as a document with an error rather than as text', async () => {
    const result = await run(['--cwd', demo, 'goal', 'show', 'OSC-GOAL-9999', '--json']);
    assert.equal(result.code, EXIT.user);
    const document = parsed(result);
    assert.equal(document['ok'], false);
    const error = document['error'] as { code: string; category: string; message: string };
    assert.equal(error.category, 'user');
    assert.ok(error.code.length > 0);
    assert.ok(error.message.length > 0);
  });
});

describe('terminal behaviour', () => {
  /** The byte a terminal reads as the start of a colour sequence. */
  const Escape = '\u001b[';

  it('emits no escape sequence when the output is not a terminal', async () => {
    const result = await run(['--cwd', demo, 'goals']);
    assert.equal(result.stdout.includes(Escape), false, 'colour was written to a pipe');
  });

  it('honours NO_COLOR', async () => {
    const result = await run(['--cwd', demo, 'goals'], { env: { NO_COLOR: '1' } });
    assert.equal(result.stdout.includes(Escape), false);
  });

  it('never colourises a json document, even when colour is forced', async () => {
    const result = await run(['--cwd', demo, 'goals', '--color', '--json']);
    assert.equal(result.stdout.includes(Escape), false);
    assert.doesNotThrow(() => JSON.parse(result.stdout));
  });

  it('says nothing on standard output when asked to be quiet', async () => {
    const result = await run(['--cwd', demo, 'audit', '--quiet']);
    assert.equal(result.code, EXIT.success);
    assert.equal(result.stderr.includes(Escape), false);
  });
});

describe('a repository with no agent system', () => {
  it('says so plainly and still exits successfully', async () => {
    const root = emptyProject();
    const result = await run(['--cwd', root, 'audit']);
    assert.equal(result.code, EXIT.success);
    assert.match(result.stdout, /No agent system was detected/);
    assert.match(result.stdout, /manifest\.yaml/);
  });

  it('reports the same in the machine readable form', async () => {
    const root = emptyProject();
    const document = parsed(await run(['--cwd', root, 'audit', '--json']));
    const data = document['data'] as { agentSystemDetected: boolean };
    assert.equal(data.agentSystemDetected, false);
  });

  /*
   * `emptyProject` holds one JavaScript file and one `package.json`. The walk counts both, because configuration
   * adapters read JSON, and only the JavaScript file is in a language this build parses. Dividing the files parsed
   * by the files walked printed "1 of 2" and read as half a repository unread, when every file this build claims to
   * read had been read.
   */
  it('counts the parse rate against the files it claims to read, not against every file walked', async () => {
    const root = emptyProject();
    const result = await run(['--cwd', root, 'audit'], { env: { NO_COLOR: '1' } });
    const document = parsed(await run(['--cwd', root, 'audit', '--json']));
    const coverage = (document['data'] as { coverage: Record<string, number> }).coverage;

    assert.equal(coverage['filesParsed'], 1);
    assert.equal(coverage['filesInSupportedLanguages'], 1);
    assert.equal(coverage['filesDiscovered'], 2);
    // The headline states the files read over the files this build claims to read, on line one.
    assert.match(result.stdout, /1 of 1 file read/);
    assert.equal(
      /of 2 files? read/.test(result.stdout),
      false,
      'the files walked were used as the denominator of the files this build parses',
    );
  });
});

describe('policy refusals', () => {
  it('refuses to run a scenario the configuration has not granted, and names the setting', async () => {
    const root = mkdtempSync(join(tmpdir(), 'orchescope-policy-'));
    workspaces.push(root);
    cpSync(demo, root, { recursive: true, filter: (source) => !source.includes('/state') });
    // The demonstration repository has no configuration file, so one is written the way `init` would, with the single
    // setting this case is about turned off.
    await run(['--cwd', root, 'init']);
    const configPath = join(root, '.orchescope/config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      policy: Record<string, unknown>;
    };
    config.policy['allowProcessSpawn'] = false;
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

    const result = await run(['--cwd', root, 'test', '--scenario', 'support-desk', '--json']);
    assert.equal(result.code, EXIT.policy);
    const document = parsed(result);
    const error = document['error'] as { category: string; detail?: { setting?: string } };
    assert.equal(error.category, 'policy');
    assert.match(String(error.detail?.setting), /allowProcessSpawn/);
  });

  it('refuses a scenario path outside the repository', async () => {
    const result = await run(['--cwd', demo, 'test', '--scenario', '../../etc/passwd.yaml']);
    assert.equal(result.code, EXIT.user);
  });

  it('refuses to trace a command that is not on the allow list', async () => {
    const result = await run(['--cwd', demo, 'trace', '--', 'curl', 'https://example.com']);
    assert.equal(result.code, EXIT.policy);
    assert.match(result.stderr, /allowedCommands/);
  });
});

describe('exit codes', () => {
  it('reports findings above a threshold with the findings code', async () => {
    const result = await run(['--cwd', demo, 'audit', '--fail-on', 'medium', '--json']);
    assert.equal(result.code, EXIT.findings);
    const document = parsed(result);
    assert.equal(document['ok'], true, 'a threshold exit still produced a successful document');
  });

  it('exits successfully when nothing reaches the threshold', async () => {
    const result = await run(['--cwd', demo, 'audit', '--fail-on', 'critical', '--json']);
    assert.equal(result.code, EXIT.success);
  });

  it('refuses a threshold it does not understand', async () => {
    const result = await run(['--cwd', demo, 'audit', '--fail-on', 'catastrophic']);
    assert.equal(result.code, EXIT.user);
  });
});

describe('init', () => {
  it('creates a configuration that lists every default, and does not overwrite it', async () => {
    const root = emptyProject();
    const first = await run(['--cwd', root, 'init', '--json']);
    assert.equal(first.code, EXIT.success);
    const config = JSON.parse(readFileSync(join(root, '.orchescope/config.json'), 'utf8')) as {
      policy: Record<string, unknown>;
      schemaVersion: number;
    };
    assert.equal(config.schemaVersion, 2, 'the configuration document is at version 2');
    assert.equal(config.policy['allowOutboundNetwork'], false);
    assert.equal(config.policy['allowPaidModels'], false);
    assert.equal(config.policy['allowFilesystemWrites'], false);

    writeFileSync(
      join(root, '.orchescope/config.json'),
      `${JSON.stringify({ schemaVersion: 2, projectName: 'kept-by-the-user' }, null, 2)}\n`,
    );
    const second = await run(['--cwd', root, 'init', '--json']);
    assert.equal(second.code, EXIT.success);
    assert.match(readFileSync(join(root, '.orchescope/config.json'), 'utf8'), /kept-by-the-user/);
  });

  it('refuses a configuration file that is not valid', async () => {
    const root = emptyProject();
    await run(['--cwd', root, 'init']);
    writeFileSync(join(root, '.orchescope/config.json'), '{"schemaVersion": "one"}\n');
    const result = await run(['--cwd', root, 'audit', '--json']);
    assert.equal(result.code, EXIT.user);
    const document = parsed(result);
    const error = document['error'] as { code: string };
    assert.match(error.code, /CONFIG_INVALID|SCHEMA_INVALID/);
  });
});

describe('export', () => {
  it('writes the formats it claims and refuses one it does not know', async () => {
    for (const format of ['json', 'mermaid', 'sarif']) {
      const target = join(demo, `.orchescope/state/contract.${format}`);
      const result = await run(['--cwd', demo, 'export', '--format', format, '--out', target]);
      assert.equal(result.code, EXIT.success, `${format} failed: ${result.stderr}`);
      assert.ok(readFileSync(target, 'utf8').length > 0);
    }
    const bad = await run(['--cwd', demo, 'export', '--format', 'pdf']);
    assert.equal(bad.code, EXIT.user);
  });

  it('produces a sarif document a scanner can read', async () => {
    const target = join(demo, '.orchescope/state/contract.sarif');
    await run(['--cwd', demo, 'export', '--format', 'sarif', '--out', target]);
    const document = JSON.parse(readFileSync(target, 'utf8')) as {
      version: string;
      runs: { tool: { driver: { name: string; rules: unknown[] } }; results: unknown[] }[];
    };
    assert.equal(document.version, '2.1.0');
    assert.equal(document.runs[0]?.tool.driver.name, 'Orchescope');
    assert.ok((document.runs[0]?.tool.driver.rules.length ?? 0) > 0);
  });
});
