import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareSeverity, OrchescopeError, stableJson } from '@orchescope/domain';
import { renderStandaloneHtml, toMermaid, toSarif } from '@orchescope/report';
import { openInBrowser, startReportServer } from '@orchescope/report-server';
import type { Finding, ReportBundle } from '@orchescope/schema';
import { type AuditResult, discoverScenarios, runAudit } from '@orchescope/usecases';
import { findAssetDirectory } from '../assets.ts';
import type { CommandContext } from '../context.ts';
import { EXIT_CODES } from '../exit.ts';
import { serverActionsFor } from '../server-actions.ts';
import { auditDocument } from '../terminal/audit-document.ts';
import { layoutFor } from '../terminal/document-grid.ts';
import { type BrowserOutcome, reportReady } from '../terminal/report-ready.ts';

/**
 * The audit command.
 *
 * It is read only: it reads the repository, reads runs already stored, writes into `.orchescope/state` and nothing
 * else. Serving the report and opening a browser are separate, explicitly requested actions.
 */

export type AuditOptions = {
  readonly open?: boolean;
  readonly serve?: boolean;
  readonly runs?: string;
  readonly failOn?: string;
  readonly exportHtml?: string;
  readonly exportMermaid?: string;
  readonly exportSarif?: string;
  readonly exportJson?: string;
};

const SEVERITY_ORDER = ['info', 'low', 'medium', 'high', 'critical'] as const;

const exceedsThreshold = (findings: readonly Finding[], threshold: string): readonly Finding[] => {
  if (!SEVERITY_ORDER.includes(threshold as (typeof SEVERITY_ORDER)[number])) {
    throw new OrchescopeError('INVALID_ARGUMENT', `${threshold} is not a severity.`, {
      remediation: `Pass one of: ${SEVERITY_ORDER.join(', ')}.`,
    });
  }
  return findings.filter(
    (finding) =>
      finding.polarity === 'risk' &&
      compareSeverity(finding.severity, threshold as Finding['severity']) <= 0,
  );
};

const writeExports = (
  context: CommandContext,
  bundle: ReportBundle,
  options: AuditOptions,
): readonly string[] => {
  const written: string[] = [];
  if (options.exportJson !== undefined) {
    writeFileSync(options.exportJson, `${stableJson(bundle)}\n`, { mode: 0o600 });
    written.push(options.exportJson);
  }
  if (options.exportMermaid !== undefined) {
    writeFileSync(options.exportMermaid, toMermaid(bundle.graph), { mode: 0o600 });
    written.push(options.exportMermaid);
  }
  if (options.exportSarif !== undefined) {
    writeFileSync(
      options.exportSarif,
      `${stableJson(toSarif(bundle.findings, { toolVersion: context.version }))}\n`,
      { mode: 0o600 },
    );
    written.push(options.exportSarif);
  }
  if (options.exportHtml !== undefined) {
    const assets = findAssetDirectory();
    writeFileSync(
      options.exportHtml,
      renderStandaloneHtml(bundle, {
        javascript: readFileSync(join(assets, 'app.js'), 'utf8'),
        css: readFileSync(join(assets, 'app.standalone.css'), 'utf8'),
        title: `Orchescope report for ${bundle.projectName}`,
      }),
      { mode: 0o600 },
    );
    written.push(options.exportHtml);
  }
  return written;
};

/**
 * One document, even when the report is being served. Printing a second document for the server URL would break
 * the promise that a command writes exactly one, so the URL is a field of this one.
 */
const writeAuditJson = (
  context: CommandContext,
  result: AuditResult,
  written: readonly string[],
  reportUrl: string | undefined,
): void => {
  context.stdout(
    `${stableJson({
      ok: true,
      command: 'audit',
      version: context.version,
      data: {
        scanId: result.scanId,
        reportId: result.bundle.reportId,
        agentSystemDetected: result.agentSystemDetected,
        summary: result.bundle.summary,
        reconciliation: result.reconciliation,
        coverage: result.graph.coverage,
        findings: result.bundle.findings,
        rulesEvaluated: result.findingSet.rulesEvaluated,
        exports: written,
        reportUrl: reportUrl ?? null,
      },
    })}\n`,
  );
};

/**
 * One document, composed once.
 *
 * The width comes from standard output, because standard output is where the document goes. When that
 * stream is not a terminal it has no width, and the document is composed at eighty, so a pipe on one
 * machine and a pipe on another produce the same bytes and a diff between two runs reports only what
 * the audit found differently.
 */
const writeAuditText = (
  context: CommandContext,
  result: AuditResult,
  written: readonly string[],
): void => {
  context.stdout(
    `${auditDocument({
      result,
      layout: layoutFor(process.stdout.columns),
      style: context.style,
      verbose: context.verbose,
      written,
    })}\n`,
  );
};

type ServedReport = { readonly url: string; readonly close: () => Promise<void> };

const startServing = async (
  context: CommandContext,
  result: AuditResult,
): Promise<ServedReport> => {
  const server = await startReportServer({
    host: context.workspace.config.report.host,
    port: context.workspace.config.report.port,
    assetDirectory: findAssetDirectory(),
    bundle: () =>
      context.workspace.store.latestReport(context.workspace.projectId) ?? result.bundle,
    actions: serverActionsFor(context),
  });
  return { url: server.url, close: () => server.close() };
};

/** Holds the report open until the process is interrupted, which is what makes `--open` a foreground command. */
const serveUntilInterrupted = async (
  context: CommandContext,
  server: ServedReport,
  options: AuditOptions,
): Promise<void> => {
  /*
   * The browser is attempted before the block is written, so the block can say what happened rather than predict it.
   * Telling a reader their browser opened and then failing to open it is the one wording this cannot afford.
   */
  let outcome: BrowserOutcome = { kind: 'not_requested' };
  if (options.open === true) {
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
};

export const auditCommand = async (
  context: CommandContext,
  options: AuditOptions,
): Promise<number> => {
  discoverScenarios(context.workspace);
  const serve = options.serve === true || options.open === true;
  const result = await runAudit({
    workspace: context.workspace,
    orchescopeVersion: context.version,
    ...(options.runs === undefined ? {} : { runLimit: Number.parseInt(options.runs, 10) }),
    served: serve,
  });

  const risks = result.bundle.findings.filter((finding) => finding.polarity === 'risk');
  const failing = options.failOn === undefined ? [] : exceedsThreshold(risks, options.failOn);
  const written = writeExports(context, result.bundle, options);

  // The server starts before anything is written, so the one document can carry the URL.
  const server = serve ? await startServing(context, result) : undefined;

  if (context.json) {
    writeAuditJson(context, result, written, server?.url);
  } else {
    writeAuditText(context, result, written);
  }

  /*
   * The document's last region already says what to run, derived from the loop, so there is no second
   * line of advice under it. There was one, it came from a different policy, and on the bundled
   * demonstration the two disagreed about which command to name.
   */
  if (server !== undefined) {
    await serveUntilInterrupted(context, server, options);
  }

  return failing.length > 0 ? EXIT_CODES.findings : EXIT_CODES.success;
};
