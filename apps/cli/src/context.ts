import { createProgressReporter } from '@orchescope/observability';
import { openWorkspace, type Workspace } from '@orchescope/workspace';
import { createProgressRenderer, type ProgressRenderer } from './terminal/progress-renderer.ts';
import { createStyle, detectStyleMode, type Style } from './terminal/style.ts';

/**
 * Command context.
 *
 * Built once per invocation from the global options, then passed to the command. This is where the process
 * environment is read: the commands themselves receive values, so a command can be exercised in a test without
 * setting variables or attaching a terminal.
 */

export const ORCHESCOPE_VERSION = '0.1.0';

export type GlobalOptions = {
  readonly cwd?: string;
  readonly json?: boolean;
  readonly verbose?: boolean;
  readonly quiet?: boolean;
  readonly color?: boolean;
  readonly noColor?: boolean;
};

export type CommandContext = {
  readonly workspace: Workspace;
  readonly style: Style;
  readonly json: boolean;
  readonly verbose: boolean;
  readonly quiet: boolean;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly renderer: ProgressRenderer;
  readonly version: string;
  readonly close: () => void;
};

const isCiEnvironment = (): boolean =>
  process.env['CI'] !== undefined && process.env['CI'] !== 'false' && process.env['CI'] !== '0';

export const createContext = (options: GlobalOptions): CommandContext => {
  const json = options.json === true;
  const quiet = options.quiet === true;
  const verbose = options.verbose === true;
  const isTty = process.stdout.isTTY === true;
  const mode = detectStyleMode({
    isTty,
    noColor: options.noColor === true || process.env['NO_COLOR'] !== undefined,
    forceColor: options.color === true,
    jsonMode: json,
  });
  const style = createStyle(mode);
  const stdout = (text: string): void => {
    process.stdout.write(text);
  };
  const stderr = (text: string): void => {
    process.stderr.write(text);
  };

  const renderer = createProgressRenderer({
    style,
    // Animation is a terminal affordance: never in JSON mode, never when piped, never under CI.
    animate: isTty && !json && !quiet && !isCiEnvironment(),
    verbose,
    write: (text) => {
      if (!json && !quiet) process.stderr.write(text);
    },
    monotonicMs: () => Number(process.hrtime.bigint() / 1_000_000n),
  });

  const workspace = openWorkspace({
    root: options.cwd ?? process.cwd(),
    progress: createProgressReporter(renderer.sink, () =>
      Number(process.hrtime.bigint() / 1_000_000n),
    ),
    logLevel: verbose ? 'debug' : 'warning',
    logSink: (record) => {
      if (json || quiet) return;
      const fields = Object.entries(record.fields)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(' ');
      process.stderr.write(
        `${record.level}: ${record.message}${fields.length > 0 ? ` ${fields}` : ''}\n`,
      );
    },
  });

  return {
    workspace,
    style,
    json,
    verbose,
    quiet,
    stdout,
    stderr,
    renderer,
    version: ORCHESCOPE_VERSION,
    close: () => {
      renderer.stop();
      workspace.close();
    },
  };
};
