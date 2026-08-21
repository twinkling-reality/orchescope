import { homedir } from 'node:os';
import { stableJson } from '@orchescope/domain';
import { installServer, installTargets, serveOverStdio, TOOL_DEFINITIONS } from '@orchescope/mcp';
import { inMemoryFactCache } from '@orchescope/source-analysis';
import type { CommandContext } from '../context.ts';
import { EXIT_CODES } from '../exit.ts';

/**
 * The MCP commands.
 *
 * `mcp serve` speaks the protocol on stdio, so nothing may be written to standard output except protocol messages.
 * Progress and diagnostics go to standard error, which is what the specification recommends for a stdio server.
 */

export const mcpServeCommand = async (context: CommandContext): Promise<number> => {
  /*
   * One cache for the life of the server, because this is the one command that scans a repository more than
   * once. A command line audit parses everything and exits; an agent holding this server open scans, changes
   * something and scans again, and parsing is what the second scan spends. It is bounded by the same
   * `maxFiles` that bounds a traversal, so one whole scan fits and nothing older than one scan survives.
   */
  const stop = await serveOverStdio({
    context: {
      workspace: context.workspace,
      orchescopeVersion: context.version,
      cache: inMemoryFactCache(context.workspace.config.analysis.maxFiles),
    },
    onNotice: (message) => {
      process.stderr.write(`${message}\n`);
    },
  });
  process.stderr.write(
    `orchescope mcp serve: ${TOOL_DEFINITIONS.length} tools available for ${context.workspace.projectName}\n`,
  );
  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      void stop().then(() => resolve());
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    process.stdin.once('end', shutdown);
  });
  return EXIT_CODES.success;
};

export const mcpInstallCommand = (
  context: CommandContext,
  options: { readonly client?: string; readonly overwrite?: boolean; readonly list?: boolean },
): number => {
  const targets = installTargets(context.workspace.paths.root, homedir());
  if (options.list === true || options.client === undefined) {
    if (context.json) {
      context.stdout(
        `${stableJson({
          ok: true,
          command: 'mcp install',
          version: context.version,
          data: { targets },
        })}\n`,
      );
      return EXIT_CODES.success;
    }
    context.stdout(`${context.style.bold('Available clients')}\n`);
    for (const target of targets) {
      context.stdout(`  ${target.client.padEnd(16)} ${target.file}\n`);
      context.stdout(context.style.dim(`  ${' '.repeat(16)} ${target.description}\n`));
    }
    context.stdout(
      `\n${context.style.dim('choose one:')} orchescope mcp install --client claude-code\n`,
    );
    return EXIT_CODES.success;
  }

  const target = targets.find((candidate) => candidate.client === options.client);
  if (target === undefined) {
    context.stderr(
      `${context.style.bad('error')} unknown client ${options.client}. Known: ${targets.map((entry) => entry.client).join(', ')}\n`,
    );
    return EXIT_CODES.user;
  }

  /*
   * A project scoped file is committed, so it has to name the binary rather than this machine. The
   * client starts a project server with the project as its working directory, which is what lets the
   * --cwd go: naming an absolute root here is the difference between a file a colleague can use and one
   * that resolves to a directory they do not have. If orchescope is not on their path they get a command
   * that is not found, which says what is wrong, rather than a server that starts somewhere else.
   */
  const portable = target.scope === 'project';
  const result = installServer({
    target,
    command: portable ? 'orchescope' : process.execPath,
    args: portable
      ? ['mcp', 'serve']
      : [process.argv[1] ?? 'orchescope', 'mcp', 'serve', '--cwd', context.workspace.paths.root],
    overwrite: options.overwrite === true,
  });

  if (context.json) {
    context.stdout(
      `${stableJson({ ok: true, command: 'mcp install', version: context.version, data: result })}\n`,
    );
    return EXIT_CODES.success;
  }
  const marker = result.action === 'unchanged' ? context.style.dim('.') : context.style.good('+');
  context.stdout(`${marker} ${result.file}: ${result.detail}\n`);
  if (result.action !== 'unchanged') {
    context.stdout(
      context.style.dim(
        '  restart the client so it picks up the new server, then ask it to list Orchescope tools\n',
      ),
    );
  }
  return EXIT_CODES.success;
};
