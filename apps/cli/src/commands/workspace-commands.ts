import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OrchescopeError, stableJson } from '@orchescope/domain';
import { renderStandaloneHtml, toMermaid, toSarif } from '@orchescope/report';
import { openInBrowser, startReportServer } from '@orchescope/report-server';
import type { ReportBundle } from '@orchescope/schema';
import { runDoctor } from '@orchescope/usecases';
import { initWorkspace } from '@orchescope/workspace';
import { findAssetDirectory } from '../assets.ts';
import type { CommandContext } from '../context.ts';
import { EXIT_CODES } from '../exit.ts';
import { serverActionsFor } from '../server-actions.ts';
import { type BrowserOutcome, reportReady } from '../terminal/report-ready.ts';
import { doctorSummary } from '../terminal/summary.ts';

/**
 * Commands about the workspace itself: init, doctor, open and export.
 *
 * `open` serves the report that already exists rather than producing a new one, so opening a report is never a
 * side effect that changes what it shows.
 */

export const initCommand = (
  context: CommandContext,
  options: { readonly name?: string; readonly manifest?: boolean },
): number => {
  const result = initWorkspace(context.workspace.paths.root, {
    ...(options.name === undefined ? {} : { projectName: options.name }),
    ...(options.manifest === true ? { manifest: true } : {}),
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
        '  It declares nothing yet. Declare the components and relations Orchescope could not read, then audit again.\n',
      ),
    );
  }
  context.stdout(
    context.style.dim(
      '  .orchescope/config.json is meant to be committed. .orchescope/state and .orchescope/cache are not, and a .gitignore inside .orchescope says so.\n',
    ),
  );
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

export const openCommand = async (
  context: CommandContext,
  options: { readonly open?: boolean },
): Promise<number> => {
  const bundle = context.workspace.store.latestReport(context.workspace.projectId);
  if (bundle === undefined) {
    throw new OrchescopeError('NOT_FOUND', 'No report has been generated for this project yet.', {
      remediation: 'Run: orchescope audit',
    });
  }
  const assets = findAssetDirectory();
  const server = await startReportServer({
    host: context.workspace.config.report.host,
    port: context.workspace.config.report.port,
    assetDirectory: assets,
    bundle: () => context.workspace.store.latestReport(context.workspace.projectId) ?? bundle,
    actions: serverActionsFor(context),
  });

  if (context.json) {
    context.stdout(
      `${stableJson({
        ok: true,
        command: 'open',
        version: context.version,
        data: { url: server.url, reportId: bundle.reportId },
      })}\n`,
    );
  }
  // Attempted before the block is written, so the block reports what happened rather than predicting it.
  let outcome: BrowserOutcome = { kind: 'not_requested' };
  if (options.open === true || context.workspace.config.report.openByDefault) {
    const attempt = await openInBrowser(server.url);
    outcome = attempt.opened ? { kind: 'opened' } : { kind: 'failed', detail: attempt.detail };
  }
  if (!context.json) {
    context.stdout(
      reportReady({
        style: context.style,
        url: server.url,
        outcome,
        columns: process.stdout.columns ?? 80,
        platform: process.platform,
      }),
    );
  }
  await new Promise<void>((resolve) => {
    const stop = (): void => {
      void server.close().then(() => resolve());
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  return EXIT_CODES.success;
};

const EXPORT_FORMATS = ['json', 'mermaid', 'sarif', 'html'] as const;

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
    case 'html': {
      const assets = findAssetDirectory();
      return renderStandaloneHtml(bundle, {
        javascript: readFileSync(join(assets, 'app.js'), 'utf8'),
        css: readFileSync(join(assets, 'app.standalone.css'), 'utf8'),
        title: `Orchescope report for ${bundle.projectName}`,
      });
    }
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
          bytes: Buffer.byteLength(contents, 'utf8'),
          out: options.out ?? null,
          reportId: bundle.reportId,
          // The artifact travels in the document only when no file was named, so that `--out` keeps a large
          // document out of the caller's buffer.
          content: options.out === undefined ? contents : null,
        },
      })}\n`,
    );
    return EXIT_CODES.success;
  }

  if (options.out === undefined) {
    context.stdout(contents.endsWith('\n') ? contents : `${contents}\n`);
    return EXIT_CODES.success;
  }
  context.stdout(`${context.style.good('+')} wrote ${options.out}\n`);
  return EXIT_CODES.success;
};
