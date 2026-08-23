import { writeFileSync } from 'node:fs';
import { compareSeverity, OrchescopeError, stableJson } from '@orchescope/domain';
import {
  improvementOutcome,
  loopProgress,
  resolveNextAction,
  toMermaid,
  toSarif,
} from '@orchescope/report';
import type { Finding, ReportBundle } from '@orchescope/schema';
import { type AuditResult, runAudit } from '@orchescope/usecases';
import type { CommandContext } from '../context.ts';
import { EXIT_CODES } from '../exit.ts';
import { auditDocument } from '../terminal/audit-document.ts';
import { layoutFor } from '../terminal/document-grid.ts';

/**
 * The audit command.
 *
 * It is read only: it reads the repository, reads runs already stored, writes into `.orchescope/state` and
 * nothing else. The human facing product is the terminal document. Agents consume the same facts over
 * `--json` or MCP.
 */

export type AuditOptions = {
  readonly runs?: string;
  readonly failOn?: string;
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
  return written;
};

/**
 * Loop standing and the one next action, shaped for an agent that must not scrape the terminal.
 *
 * The same pure functions feed the human document. Capabilities travel too: they already sit on the
 * bundle and used to be dropped here, which forced agents to guess whether spawn or compare was open.
 */
const agentLoop = (result: AuditResult) => {
  const progress = loopProgress(result.bundle, result.findingSet.rulesEvaluated);
  const next = resolveNextAction({
    progress,
    agentSystemDetected: result.agentSystemDetected,
    adapters: result.graph.coverage.adapters,
  });
  return {
    loop: {
      standingAt: progress.standingAt?.id ?? null,
      checkCoverage: progress.coverage,
      steps: progress.steps.map((step) => ({
        id: step.id,
        ordinal: step.ordinal,
        title: step.title,
        state: step.state,
        summary: step.summary,
        detail: step.detail,
        command: step.command,
      })),
      next,
    },
    capabilities: result.bundle.capabilities,
  };
};

const writeAuditJson = (
  context: CommandContext,
  result: AuditResult,
  written: readonly string[],
): void => {
  const { loop, capabilities } = agentLoop(result);
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
        runPopulations: result.bundle.runPopulations,
        evidenceCoverage: result.bundle.evidenceCoverage,
        coverage: result.graph.coverage,
        findings: result.bundle.findings,
        rulesEvaluated: result.findingSet.rulesEvaluated,
        loop,
        /*
         * Did the last change help, answered without the caller holding an identifier. It was
         * computed on every audit and reached no surface, so an agent could ask what was wrong and
         * never ask whether its own last fix had worked.
         */
        outcome: improvementOutcome(result.bundle),
        capabilities,
        exports: written,
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

export const auditCommand = async (
  context: CommandContext,
  options: AuditOptions,
): Promise<number> => {
  const result = await runAudit({
    workspace: context.workspace,
    orchescopeVersion: context.version,
    ...(options.runs === undefined ? {} : { runLimit: Number.parseInt(options.runs, 10) }),
  });

  const risks = result.bundle.findings.filter((finding) => finding.polarity === 'risk');
  const failing = options.failOn === undefined ? [] : exceedsThreshold(risks, options.failOn);
  const written = writeExports(context, result.bundle, options);

  if (context.json) {
    writeAuditJson(context, result, written);
  } else {
    writeAuditText(context, result, written);
  }

  return failing.length > 0 ? EXIT_CODES.findings : EXIT_CODES.success;
};
