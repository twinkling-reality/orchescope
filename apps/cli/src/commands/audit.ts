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
import { type BrowserOutcome, reportReady } from '../terminal/report-ready.ts';
import { auditSummary, findingList, nextCommand } from '../terminal/summary.ts';

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
        css: readFileSync(join(assets, 'app.css'), 'utf8'),
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

const writeAuditText = (
  context: CommandContext,
  result: AuditResult,
  parts: {
    readonly risks: readonly Finding[];
    readonly strengths: readonly Finding[];
    readonly written: readonly string[];
  },
): void => {
  context.stdout(`${auditSummary(context.style, result)}\n`);
  if (parts.risks.length > 0) {
    context.stdout(
      `\n${context.style.bold('Top findings')}\n${findingList(context.style, parts.risks, 8)}\n`,
    );
  }
  if (parts.strengths.length > 0 && context.verbose) {
    context.stdout(
      `\n${context.style.bold('Strengths')}\n${findingList(context.style, parts.strengths, 8)}\n`,
    );
  }
  for (const path of parts.written) {
    context.stdout(`${context.style.good('+')} wrote ${path}\n`);
  }
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
  const strengths = result.bundle.findings.filter((finding) => finding.polarity === 'strength');
  const failing = options.failOn === undefined ? [] : exceedsThreshold(risks, options.failOn);
  const written = writeExports(context, result.bundle, options);

  // The server starts before anything is written, so the one document can carry the URL.
  const server = serve ? await startServing(context, result) : undefined;

  if (context.json) {
    writeAuditJson(context, result, written, server?.url);
  } else {
    writeAuditText(context, result, { risks, strengths, written });
  }

  if (server !== undefined) {
    await serveUntilInterrupted(context, server, options);
  } else if (!context.json) {
    context.stdout(`\n${context.style.dim('next:')} ${nextCommand(result)}\n`);
  }

  return failing.length > 0 ? EXIT_CODES.findings : EXIT_CODES.success;
};
