import { writeFileSync } from 'node:fs';
import { OrchescopeError, stableJson } from '@orchescope/domain';
import { toMermaid, toSarif } from '@orchescope/report';
import type { ReportBundle } from '@orchescope/schema';
import { runDoctor } from '@orchescope/usecases';
import { initWorkspace } from '@orchescope/workspace';
import type { CommandContext } from '../context.ts';
import { EXIT_CODES } from '../exit.ts';
import { doctorSummary } from '../terminal/doctor-summary.ts';

/**
 * Commands about the workspace itself: init, doctor and export.
 *
 * There is no browser report. Humans read the terminal. Agents read `--json` or MCP. Export writes
 * machine artifacts (JSON, Mermaid, SARIF) for CI and pull requests.
 */

export const initCommand = (
  context: CommandContext,
  options: { readonly name?: string; readonly manifest?: boolean; readonly scenario?: boolean },
): number => {
  const result = initWorkspace(context.workspace.paths.root, {
    ...(options.name === undefined ? {} : { projectName: options.name }),
    ...(options.manifest === true ? { manifest: true } : {}),
    ...(options.scenario === true ? { scenario: true } : {}),
  });
  if (context.json) {
    context.stdout(
      `${stableJson({ ok: true, command: 'init', version: context.version, data: result })}\n`,
    );
    return EXIT_CODES.success;
  }
  context.stdout(
    result.created
      ? `${context.style.good('+')} wrote ${result.configFile}\n`
      : `${context.style.dim('.')} ${result.configFile} already exists, left unchanged\n`,
  );
  if (result.manifest !== undefined) {
    context.stdout(
      result.manifest.created
        ? `${context.style.good('+')} wrote ${result.manifest.manifestFile}\n`
        : `${context.style.dim('.')} ${result.manifest.manifestFile} already exists, left unchanged\n`,
    );
    context.stdout(
      context.style.dim(
        '  It declares nothing yet. Declare the components and edges Orchescope could not read, then audit again.\n',
      ),
    );
  }
  if (result.scenario !== undefined) {
    context.stdout(
      result.scenario.created
        ? `${context.style.good('+')} wrote ${result.scenario.scenarioFile}\n`
        : `${context.style.dim('.')} ${result.scenario.scenarioFile} already exists, left unchanged\n`,
    );
    /*
     * Where to put it is the half a reader cannot infer. Scenarios are read from `scenarios/` and this
     * file is not there, which is deliberate: nothing runs until the command in it is yours.
     */
    context.stdout(
      context.style.dim(
        '  Fill in target.command, then move it to scenarios/ and run: orchescope test --scenario example\n',
      ),
    );
  }
  context.stdout(
    context.style.dim(
      '  .orchescope/config.json is meant to be committed. .orchescope/state and .orchescope/cache are not, and a .gitignore inside .orchescope says so.\n',
    ),
  );
  /*
   * Said here rather than left for the reader to discover, because the sentence above is the one it
   * contradicts. Git does not consult a .gitignore inside a directory it has already excluded, so the
   * nested rule is inert and the file this command just wrote will never be committed.
   */
  if (result.configIgnoredBy !== undefined) {
    context.stdout(
      `${context.style.warn('!')} it will not be committed: ${result.configIgnoredBy.rule} excludes it.\n`,
    );
    context.stdout(
      context.style.dim(
        `  Git will not re-include a file whose directory is excluded, so replace that pattern with:\n${result.configIgnoredBy.fix.map((line) => `    ${line}\n`).join('')}`,
      ),
    );
  }
  context.stdout(`\n${context.style.dim('next:')} orchescope audit\n`);
  return EXIT_CODES.success;
};

export const doctorCommand = async (context: CommandContext): Promise<number> => {
  const result = await runDoctor({
    workspace: context.workspace,
    orchescopeVersion: context.version,
  });
  if (context.json) {
    context.stdout(
      `${stableJson({ ok: result.ok, command: 'doctor', version: context.version, data: result })}\n`,
    );
  } else {
    context.stdout(`${doctorSummary(context.style, result)}\n`);
  }
  return result.ok ? EXIT_CODES.success : EXIT_CODES.environment;
};

const EXPORT_FORMATS = ['json', 'mermaid', 'sarif'] as const;

const renderExport = (
  context: CommandContext,
  bundle: ReportBundle,
  format: string,
): string | undefined => {
  switch (format) {
    case 'json':
      return `${stableJson(bundle)}\n`;
    case 'mermaid':
      return toMermaid(bundle.graph);
    case 'sarif':
      return `${stableJson(toSarif(bundle.findings, { toolVersion: context.version }))}\n`;
    default:
      return undefined;
  }
};

/**
 * Exporting is the one command whose output is an artifact rather than a report about one, so the two modes are
 * kept apart. Without `--json` the artifact goes to the file or to standard output, which is what a shell
 * pipeline wants. With `--json` the caller gets the same document shape as every other command, describing what
 * was written and carrying the artifact only when there was no file to put it in.
 */
export const exportCommand = (
  context: CommandContext,
  options: { readonly format?: string; readonly out?: string },
): number => {
  const bundle = context.workspace.store.latestReport(context.workspace.projectId);
  if (bundle === undefined) {
    throw new OrchescopeError('NOT_FOUND', 'No report exists yet.', {
      remediation: 'Run: orchescope audit',
    });
  }
  const format = options.format ?? 'json';
  const contents = renderExport(context, bundle, format);
  if (contents === undefined) {
    throw new OrchescopeError('INVALID_ARGUMENT', `${format} is not a format this build writes.`, {
      remediation: `Pass one of: ${EXPORT_FORMATS.join(', ')}.`,
    });
  }
  if (options.out !== undefined) {
    writeFileSync(options.out, contents, { mode: 0o600 });
  }
  if (context.json) {
    context.stdout(
      `${stableJson({
        ok: true,
        command: 'export',
        version: context.version,
        data: {
          format,
          out: options.out ?? null,
          bytes: Buffer.byteLength(contents),
          content: options.out === undefined ? contents : null,
        },
      })}\n`,
    );
    return EXIT_CODES.success;
  }
  if (options.out === undefined) {
    context.stdout(contents);
  } else {
    context.stdout(`${context.style.good('+')} wrote ${options.out}\n`);
  }
  return EXIT_CODES.success;
};
