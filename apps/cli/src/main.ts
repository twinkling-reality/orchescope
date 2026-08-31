import module from 'node:module';
import { cancelledError, OrchescopeError } from '@orchescope/domain';
import { Command } from 'commander';
import { auditCommand } from './commands/audit.ts';
import { federateCommand } from './commands/federate.ts';
import {
  goalCreateCommand,
  goalListCommand,
  goalReviewCommand,
  goalShowCommand,
  goalValidateCommand,
} from './commands/goal.ts';
import { mcpInstallCommand, mcpServeCommand } from './commands/mcp.ts';
import {
  benchmarkCommand,
  chaosCommand,
  compareCommand,
  receiveCommand,
  testCommand,
  traceCommand,
} from './commands/run-commands.ts';
import { doctorCommand, exportCommand, initCommand } from './commands/workspace-commands.ts';
import {
  type CommandContext,
  createContext,
  type GlobalOptions,
  ORCHESCOPE_VERSION,
} from './context.ts';
import { EXIT_CODES, exitCodeFor, jsonError, renderError } from './exit.ts';
import { commandPaths, nearestCommand, typedCommandIn } from './unknown-command.ts';

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

/**
 * Every command runs inside this. The command name is passed in rather than derived, because a failure document
 * has to name the command that failed, and the argument parser's view of that is not always the one a caller
 * would recognise for a subcommand.
 */
const withContext = async (
  command: string,
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
      process.stdout.write(
        `${JSON.stringify(jsonError(error, { command, version: ORCHESCOPE_VERSION }))}\n`,
      );
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
  .description('Compare AI agent systems before and after a change.')
  .version(ORCHESCOPE_VERSION, '-v, --version')
  .option('--cwd <path>', 'repository to work in, defaults to the current directory')
  .option('--json', 'emit a single stable JSON document instead of human output')
  .option('--verbose', 'include detail that is normally hidden, including stack traces on failure')
  .option('--quiet', 'suppress progress output')
  .option('--color', 'force colour even when the output is not a terminal')
  .option('--no-color', 'disable colour')
  .configureHelp({ sortSubcommands: true })
  /**
   * Running the binary with no arguments prints this list, so the list has to say where to start. Fourteen
   * commands in alphabetical order tell a first time reader nothing about which one to run first.
   */
  .addHelpText(
    'afterAll',
    [
      '',
      'Start here, from the root of a repository that contains an agent system:',
      '  orchescope audit                     map it, reconcile it against stored runs, print findings',
      '  orchescope trace -- <your command>   run it once so the next audit has runtime evidence',
      '  orchescope mcp serve                 expose the same loop to a coding agent over MCP',
      '  orchescope goal create <findingId>   turn a finding into a bounded task an agent can finish',
      '',
      'Every command accepts --json and then writes exactly one JSON document, including on failure.',
    ].join('\n'),
  )
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
    reportUsageError(error);
    process.exit(EXIT_CODES.user);
  });

/**
 * A caller mistake, answered in the form the caller asked for.
 *
 * The parser writes its own message to standard error before this runs, and under `--json` that message
 * is the whole of what a script receives from an interface whose help says every command writes exactly
 * one document including on failure. So the document is written here, and the parser's own text is left
 * for the human form where it is what a reader wants.
 */
const reportUsageError = (error: { readonly message: string; readonly code: string }): void => {
  const typed = typedCommandIn(error.message);
  const nearest = typed === undefined ? undefined : nearestCommand(typed, commandPaths(program));
  if (process.argv.includes('--json')) {
    process.stdout.write(
      `${JSON.stringify(
        jsonError(
          new OrchescopeError('INVALID_ARGUMENT', error.message.replace(/^error: /, ''), {
            ...(nearest === undefined
              ? {}
              : { remediation: `Did you mean: orchescope ${nearest}` }),
          }),
          { command: typed ?? 'orchescope', version: ORCHESCOPE_VERSION },
        ),
      )}\n`,
    );
    return;
  }
  process.stderr.write(
    nearest === undefined
      ? `\nRun 'orchescope --help' for the list of commands.\n`
      : `\nDid you mean: orchescope ${nearest}\n`,
  );
};

const globals = (): GlobalOptions => program.opts<GlobalOptions>();

program
  .command('init')
  .description('create .orchescope with a configuration file that lists every default')
  .option('--name <name>', 'project name recorded in the configuration')
  .option(
    '--manifest',
    'also write a manifest template for components no adapter can read from source',
  )
  .option('--scenario', 'also write a scenario template that declares how your system is started')
  .action(async (options: { name?: string; manifest?: boolean; scenario?: boolean }) => {
    await withContext('init', globals(), (context) => initCommand(context, options));
  });

program
  .command('doctor')
  .description('check that this machine can run every command this build offers')
  .action(async () => {
    await withContext('doctor', globals(), (context) => doctorCommand(context));
  });

program
  .command('audit')
  .description('discover the agent system, reconcile it against stored runs, and report findings')
  .option(
    '--runs <count>',
    'how many recent runs to reconcile against, zero for a static only audit',
  )
  .option('--fail-on <severity>', 'exit non zero when a risk at or above this severity is found')
  .option('--export-json <path>', 'also write the report bundle as JSON')
  .option('--export-mermaid <path>', 'also write a Mermaid diagram')
  .option('--export-sarif <path>', 'also write findings as SARIF 2.1.0')
  .action(async (options: Parameters<typeof auditCommand>[1]) => {
    await withContext('audit', globals(), (context) => auditCommand(context, options));
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
      await withContext('trace', globals(), (context) => traceCommand(context, command, options));
    },
  );

const collectRepository = (value: string, previous: readonly string[]): readonly string[] => [
  ...previous,
  value,
];

program
  .command('federate')
  .description('join separately scanned repositories using source-qualified runtime evidence')
  .requiredOption(
    '--repository <path>',
    'repository root to scan, repeat for each repository',
    collectRepository,
    [],
  )
  .option('--runs <count>', 'how many recent runs from the runtime workspace to consider', '10')
  .option(
    '--export-json <path>',
    'write the complete federation report inside the runtime workspace',
  )
  .action(async (options: Parameters<typeof federateCommand>[1]) => {
    await withContext('federate', globals(), (context) => federateCommand(context, options));
  });

program
  .command('receive')
  .description('listen for spans from a system that is already running, and store them as a run')
  .option('--for <duration>', 'how long to listen, for example 90s, 10m or 1h', '5m')
  .option('--label <label>', 'name for this run')
  .action(async (options: { for: string; label?: string }) => {
    await withContext('receive', globals(), (context) => receiveCommand(context, options));
  });

program
  .command('test')
  .description('run a scenario and evaluate it')
  .option('--scenario <reference>', 'scenario identifier or path to a YAML file')
  .option('--goal <goalId>', 'run the scenarios named by a goal')
  .option('--repetitions <count>', 'how many times to run it')
  .action(async (options: { scenario?: string; goal?: string; repetitions?: string }) => {
    await withContext('test', globals(), (context) => testCommand(context, options));
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
    await withContext('benchmark', globals(), (context) => benchmarkCommand(context, options));
  });

program
  .command('chaos')
  .description('inject the faults a scenario declares and report what each one did')
  .option('--scenario <reference>', 'scenario identifier or path to a YAML file')
  .option('--seed <number>', 'seed for deterministic fault decisions')
  .option('--repetitions <count>', 'repetitions per fault')
  .option('--environment <name>', 'local_deterministic, declared_test or live')
  .action(async (options: Parameters<typeof chaosCommand>[1]) => {
    await withContext('chaos', globals(), (context) => chaosCommand(context, options));
  });

program
  .command('compare')
  .description('compare a baseline against a candidate run, scan or git revision')
  .argument('<baseline>', 'run identifier, scan identifier, git revision or "latest"')
  .argument('<candidate>', 'run identifier, scan identifier, git revision or "latest"')
  .option('--goal <goalId>', 'attach the comparison to a goal')
  .action(async (baseline: string, candidate: string, options: { goal?: string }) => {
    await withContext('compare', globals(), (context) =>
      compareCommand(context, baseline, candidate, options),
    );
  });

program
  .command('export')
  .description('export the most recent report as json, mermaid or sarif')
  .option('--format <format>', 'json, mermaid or sarif', 'json')
  .option('--out <path>', 'write to a file instead of standard output')
  .action(async (options: { format?: string; out?: string }) => {
    await withContext('export', globals(), (context) => exportCommand(context, options));
  });

const goal = program.command('goal').description('work with improvement goals');

goal
  .command('create')
  .description('turn an eligible finding into a bounded improvement goal')
  .argument('<findingId>', 'finding identifier, for example OSC-PERF-0001')
  .option('--repetitions <count>', 'repetitions the validation plan should use')
  .option('--another', 'cut a second goal from a finding that already has an open one')
  .action(async (findingId: string, options: { repetitions?: string; another?: boolean }) => {
    await withContext('goal create', globals(), (context) =>
      goalCreateCommand(context, findingId, options),
    );
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
      await withContext('goal show', globals(), (context) =>
        goalShowCommand(context, goalId, options),
      );
    },
  );

goal
  .command('review')
  .description('record that the change described by a goal was reviewed')
  .argument('<goalId>', 'goal identifier')
  .option('--note <text>', 'what you checked and what you concluded')
  .action(async (goalId: string, options: { note?: string }) => {
    await withContext('goal review', globals(), (context) =>
      goalReviewCommand(context, goalId, options),
    );
  });

goal
  .command('validate')
  .description('judge a goal against its acceptance criteria')
  .argument('<goalId>', 'goal identifier')
  .option('--comparison <id>', 'comparison to judge against')
  .action(async (goalId: string, options: { comparison?: string }) => {
    await withContext('goal validate', globals(), (context) =>
      goalValidateCommand(context, goalId, options),
    );
  });

program
  .command('goals')
  .description('list improvement goals')
  .option('--status <status>', 'filter by status')
  .action(async (options: { status?: string }) => {
    await withContext('goals', globals(), (context) => goalListCommand(context, options));
  });

const mcp = program.command('mcp').description('the agent facing interface');

mcp
  .command('serve')
  .description('speak the Model Context Protocol on stdio')
  .action(async () => {
    await withContext('mcp serve', globals(), (context) => mcpServeCommand(context));
  });

mcp
  .command('install')
  .description('register this Orchescope with a coding agent')
  .option('--client <name>', 'claude-code, vscode, cursor or claude-desktop')
  .option('--overwrite', 'replace an existing entry')
  .option('--list', 'list the clients and the files that would be written')
  .action(async (options: { client?: string; overwrite?: boolean; list?: boolean }) => {
    await withContext('mcp install', globals(), (context) => mcpInstallCommand(context, options));
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
