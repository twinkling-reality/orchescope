import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OrchescopeError, stableJson } from '@orchescope/domain';
import { renderStandaloneHtml, toMermaid, toSarif } from '@orchescope/report';
import { openInBrowser, startReportServer } from '@orchescope/report-server';
import { runDoctor } from '@orchescope/usecases';
import { initWorkspace } from '@orchescope/workspace';
import { findAssetDirectory } from '../assets.ts';
import type { CommandContext } from '../context.ts';
import { EXIT_CODES } from '../exit.ts';
import { serverActionsFor } from '../server-actions.ts';
import { doctorSummary } from '../terminal/summary.ts';

/**
 * Commands about the workspace itself: init, doctor, open and export.
 *
 * `open` serves the report that already exists rather than producing a new one, so opening a report is never a
 * side effect that changes what it shows.
 */

export const initCommand = (
  context: CommandContext,
  options: { readonly name?: string },
): number => {
  const result = initWorkspace(context.workspace.paths.root, options.name);
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
  } else {
    context.stdout(`${context.style.bold('Report')} ${context.style.link(server.url)}\n`);
    context.stdout(context.style.dim('  press Ctrl+C to stop serving\n'));
  }
  if (options.open === true || context.workspace.config.report.openByDefault) {
    const outcome = await openInBrowser(server.url);
    if (!outcome.opened && !context.json) {
      context.stdout(`${context.style.warn('!')} could not open a browser (${outcome.detail})\n`);
    }
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
  let contents: string;
  switch (format) {
    case 'json':
      contents = `${stableJson(bundle)}\n`;
      break;
    case 'mermaid':
      contents = toMermaid(bundle.graph);
      break;
    case 'sarif':
      contents = `${stableJson(toSarif(bundle.findings, { toolVersion: context.version }))}\n`;
      break;
    case 'html': {
      const assets = findAssetDirectory();
      contents = renderStandaloneHtml(bundle, {
        javascript: readFileSync(join(assets, 'app.js'), 'utf8'),
        css: readFileSync(join(assets, 'app.css'), 'utf8'),
        title: `Orchescope report for ${bundle.projectName}`,
      });
      break;
    }
    default:
      context.stderr(
        `${context.style.bad('error')} unknown format ${format}. Use json, mermaid, sarif or html.\n`,
      );
      return EXIT_CODES.user;
  }

  if (options.out === undefined) {
    context.stdout(contents.endsWith('\n') ? contents : `${contents}\n`);
    return EXIT_CODES.success;
  }
  writeFileSync(options.out, contents, { mode: 0o600 });
  if (!context.json) context.stdout(`${context.style.good('+')} wrote ${options.out}\n`);
  return EXIT_CODES.success;
};
