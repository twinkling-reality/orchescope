import module from 'node:module';
import { cancelledError } from '@orchescope/domain';
import { Command } from 'commander';
import { auditCommand } from './commands/audit.ts';
import {
  goalCreateCommand,
  goalListCommand,
  goalShowCommand,
  goalValidateCommand,
} from './commands/goal.ts';
import { mcpInstallCommand, mcpServeCommand } from './commands/mcp.ts';
import {
  benchmarkCommand,
  chaosCommand,
  compareCommand,
  testCommand,
  traceCommand,
} from './commands/run-commands.ts';
import {
  doctorCommand,
  exportCommand,
  initCommand,
  openCommand,
} from './commands/workspace-commands.ts';
import {
  type CommandContext,
  createContext,
  type GlobalOptions,
  ORCHESCOPE_VERSION,
} from './context.ts';
import { EXIT_CODES, exitCodeFor, jsonError, renderError } from './exit.ts';

/**
 * The command line entry point.
 *
 * Two things happen before anything else. The compile cache is enabled, which measurably cuts the cost of loading
 * the heavier subsystems on repeat invocations. And the interrupt handler is installed, so Ctrl+C produces a clean
 * shutdown with exit code 130 rather than a half written database and a stack trace.
 */

try {
  module.enableCompileCache?.();
} catch {
  // The compile cache is an optimisation. A runtime that does not offer it simply starts a little slower.
}

const withContext = async (
  options: GlobalOptions,
  work: (context: CommandContext) => Promise<number> | number,
): Promise<void> => {
  let context: CommandContext | undefined;
  try {
    context = createContext(options);
    const code = await work(context);
    context.close();
    process.exitCode = code;
  } catch (error) {
    const style = context?.style;
    if (options.json === true) {
      process.stdout.write(`${JSON.stringify(jsonError(error))}\n`);
    } else if (style !== undefined) {
      process.stderr.write(renderError(style, error, options.verbose === true));
    } else {
      process.stderr.write(
        `error: ${error instanceof Error ? error.message : 'unknown failure'}\n`,
      );
    }
    context?.close();
    process.exitCode = exitCodeFor(error);
  }
};

const program = new Command();

program
  .name('orchescope')
  .description('Map, test, and improve agent systems.')
  .version(ORCHESCOPE_VERSION, '-v, --version')
  .option('--cwd <path>', 'repository to work in, defaults to the current directory')
  .option('--json', 'emit a single stable JSON document instead of human output')
  .option('--verbose', 'include detail that is normally hidden, including stack traces on failure')
  .option('--quiet', 'suppress progress output')
  .option('--color', 'force colour even when the output is not a terminal')
  .option('--no-color', 'disable colour')
  .showHelpAfterError()
  .configureHelp({ sortSubcommands: true })
  // An unknown command or a malformed flag is a caller mistake, which this interface reports as exit code 2. The
  // argument parser exits 1 by default, and 1 means "the command ran and found something you asked to fail on".
  .exitOverride((error) => {
    if (
      error.exitCode === 0 ||
      error.code === 'commander.version' ||
      error.code === 'commander.help'
    ) {
      process.exit(0);
    }
    process.exit(EXIT_CODES.user);
  });

const globals = (): GlobalOptions => program.opts<GlobalOptions>();

program
  .command('init')
  .description('create .orchescope with a configuration file that lists every default')
  .option('--name <name>', 'project name recorded in the configuration')
  .action(async (options: { name?: string }) => {
    await withContext(globals(), (context) => initCommand(context, options));
  });

program
  .command('doctor')
  .description('check that this machine can run every command this build offers')
  .action(async () => {
    await withContext(globals(), (context) => doctorCommand(context));
  });

program
  .command('audit')
  .description('discover the agent system, reconcile it against stored runs, and report findings')
  .option('--open', 'serve the report and open it in a browser')
  .option('--serve', 'serve the report without opening a browser')
  .option(
    '--runs <count>',
    'how many recent runs to reconcile against, zero for a static only audit',
  )
  .option('--fail-on <severity>', 'exit non zero when a risk at or above this severity is found')
  .option('--export-html <path>', 'also write a single file report')
  .option('--export-json <path>', 'also write the report bundle as JSON')
  .option('--export-mermaid <path>', 'also write a Mermaid diagram')
  .option('--export-sarif <path>', 'also write findings as SARIF 2.1.0')
  .action(async (options: Parameters<typeof auditCommand>[1]) => {
    await withContext(globals(), (context) => auditCommand(context, options));
  });

program
  .command('trace')
  .description('run a command, collect its OpenTelemetry spans, and store them as a run')
  .option('--label <label>', 'name for this run')
  .option('--timeout <ms>', 'deadline for the command')
  .option(
    '--import <file>',
    'store spans from an OTLP JSON or newline delimited file instead of running anything',
  )
  .argument('[command...]', 'the command to run, after a double dash')
  .action(
    async (command: string[], options: { label?: string; timeout?: string; import?: string }) => {
      await withContext(globals(), (context) => traceCommand(context, command, options));
    },
  );

program
  .command('test')
  .description('run a scenario and evaluate it')
  .option('--scenario <reference>', 'scenario identifier or path to a YAML file')
  .option('--goal <goalId>', 'run the scenarios named by a goal')
  .option('--repetitions <count>', 'how many times to run it')
  .action(async (options: { scenario?: string; goal?: string; repetitions?: string }) => {
    await withContext(globals(), (context) => testCommand(context, options));
  });

program
  .command('benchmark')
  .description('vary one dimension of a scenario and compare the variants')
  .option('--scenario <reference>', 'scenario identifier or path to a YAML file')
  .option('--agents <list>', 'agent counts, for example 1,2,4,8')
  .option('--workers <list>', 'worker counts')
  .option('--concurrency <list>', 'simultaneous user requests, for example 1,10,50')
  .option('--repetitions <count>', 'repetitions per variant, default 3')
  .option('--warmup <count>', 'warmup runs per variant, excluded from the results')
  .action(async (options: Parameters<typeof benchmarkCommand>[1]) => {
    await withContext(globals(), (context) => benchmarkCommand(context, options));
  });

program
  .command('chaos')
  .description('inject the faults a scenario declares and report what each one did')
  .option('--scenario <reference>', 'scenario identifier or path to a YAML file')
  .option('--seed <number>', 'seed for deterministic fault decisions')
  .option('--repetitions <count>', 'repetitions per fault')
  .option('--environment <name>', 'local_deterministic, declared_test or live')
  .action(async (options: Parameters<typeof chaosCommand>[1]) => {
    await withContext(globals(), (context) => chaosCommand(context, options));
  });

program
  .command('compare')
  .description('compare a baseline against a candidate run, scan or git revision')
  .argument('<baseline>', 'run identifier, scan identifier, git revision or "latest"')
  .argument('<candidate>', 'run identifier, scan identifier, git revision or "latest"')
  .option('--goal <goalId>', 'attach the comparison to a goal')
  .action(async (baseline: string, candidate: string, options: { goal?: string }) => {
    await withContext(globals(), (context) =>
      compareCommand(context, baseline, candidate, options),
    );
  });

program
  .command('open')
  .description('serve the most recent report from loopback')
  .option('--open', 'also open a browser')
  .action(async (options: { open?: boolean }) => {
    await withContext(globals(), (context) => openCommand(context, options));
  });

program
  .command('export')
  .description('export the most recent report as json, mermaid, sarif or html')
  .option('--format <format>', 'json, mermaid, sarif or html', 'json')
  .option('--out <path>', 'write to a file instead of standard output')
  .action(async (options: { format?: string; out?: string }) => {
    await withContext(globals(), (context) => exportCommand(context, options));
  });

const goal = program.command('goal').description('work with improvement goals');

goal
  .command('create')
  .description('turn an eligible finding into a bounded improvement goal')
  .argument('<findingId>', 'finding identifier, for example OSC-PERF-0001')
  .option('--repetitions <count>', 'repetitions the validation plan should use')
  .action(async (findingId: string, options: { repetitions?: string }) => {
    await withContext(globals(), (context) => goalCreateCommand(context, findingId, options));
  });

goal
  .command('show')
  .description('print a goal, its agent prompt or its markdown document')
  .argument('<goalId>', 'goal identifier, for example OSC-GOAL-0001')
  .option('--prompt', 'print the plain text prompt for a coding agent')
  .option('--markdown', 'print the goal as markdown')
  .option('--out <path>', 'write to a file instead of standard output')
  .action(
    async (goalId: string, options: { prompt?: boolean; markdown?: boolean; out?: string }) => {
      await withContext(globals(), (context) => goalShowCommand(context, goalId, options));
    },
  );

goal
  .command('validate')
  .description('judge a goal against its acceptance criteria')
  .argument('<goalId>', 'goal identifier')
  .option('--comparison <id>', 'comparison to judge against')
  .action(async (goalId: string, options: { comparison?: string }) => {
    await withContext(globals(), (context) => goalValidateCommand(context, goalId, options));
  });

program
  .command('goals')
  .description('list improvement goals')
  .option('--status <status>', 'filter by status')
  .action(async (options: { status?: string }) => {
    await withContext(globals(), (context) => goalListCommand(context, options));
  });

const mcp = program.command('mcp').description('the agent facing interface');

mcp
  .command('serve')
  .description('speak the Model Context Protocol on stdio')
  .action(async () => {
    await withContext(globals(), (context) => mcpServeCommand(context));
  });

mcp
  .command('install')
  .description('register this Orchescope with a coding agent')
  .option('--client <name>', 'claude-code, vscode, cursor or claude-desktop')
  .option('--overwrite', 'replace an existing entry')
  .option('--list', 'list the clients and the files that would be written')
  .action(async (options: { client?: string; overwrite?: boolean; list?: boolean }) => {
    await withContext(globals(), (context) => mcpInstallCommand(context, options));
  });

process.on('SIGINT', () => {
  process.exitCode = EXIT_CODES.interrupted;
});

const parsed = program.parseAsync(process.argv);
parsed.catch((error: unknown) => {
  process.stderr.write(
    `error: ${error instanceof Error ? error.message : String(cancelledError('the command').message)}\n`,
  );
  process.exitCode = exitCodeFor(error);
});
