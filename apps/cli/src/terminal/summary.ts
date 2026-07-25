import type { Comparison, Finding, Goal, ReportBundle, ScenarioResult } from '@orchescope/schema';
import type { AuditResult, DoctorResult } from '@orchescope/usecases';
import {
  formatCount,
  padRight,
  paintSeverity,
  SEVERITY_LABEL,
  type Style,
  SYMBOLS,
  truncate,
} from './style.ts';

/**
 * Human readable summaries.
 *
 * The audit summary leads with the reconciliation delta rather than with a count of components, because the delta
 * between what a repository declares and what it exercised is the thing no other tool computes and the thing a
 * reader should see first. Every section states what is missing as plainly as what is present.
 */

const WIDTH = 76;

const notDetectedLines = (style: Style): readonly string[] => [
  `${style.warn(SYMBOLS.warning)} No agent system was detected. Nothing here looked like an agent, a model call, a tool or an MCP server.`,
  style.dim(
    '  If this repository does contain one, declare it in .orchescope/manifest.yaml so it appears in the graph.',
  ),
];

const reconciliationLines = (
  style: Style,
  delta: AuditResult['reconciliation'],
): readonly string[] => {
  if (delta === undefined) {
    return [
      `${style.dim(SYMBOLS.pending)} ${style.dim('No runtime evidence yet. Run: orchescope trace -- <your command>')}`,
    ];
  }
  const rate = delta.coverage.componentExerciseRate;
  const mark = (count: number, bad: boolean): string =>
    count === 0
      ? style.good(SYMBOLS.done)
      : bad
        ? style.bad(SYMBOLS.failed)
        : style.warn(SYMBOLS.warning);
  return [
    '',
    style.bold('Declared against exercised'),
    `  ${SYMBOLS.bullet} exercised: ${delta.coverage.exercisedComponents} of ${delta.coverage.declaredComponents}${rate === undefined ? '' : ` (${Math.round(rate * 100)} percent)`}`,
    `  ${mark(delta.declaredNotExercised.components.length, false)} declared and never exercised: ${delta.declaredNotExercised.components.length}`,
    `  ${mark(delta.exercisedNotDeclared.components.length, false)} exercised and never declared: ${delta.exercisedNotDeclared.components.length}`,
    `  ${mark(delta.contradictions.length, true)} declarations contradicted by behaviour: ${delta.contradictions.length}`,
    `  ${mark(delta.duplicateSideEffects.length, true)} duplicated side effects: ${delta.duplicateSideEffects.length}`,
  ];
};

const findingLines = (style: Style, result: AuditResult): readonly string[] => {
  const summary = result.bundle.summary;
  const bySeverity = summary.findingCountBySeverity;
  const lines: string[] = ['', style.bold('Findings')];
  for (const severity of ['critical', 'high', 'medium', 'low', 'info'] as const) {
    const count = bySeverity[severity] ?? 0;
    if (count > 0) {
      lines.push(
        `  ${paintSeverity(style, severity, SEVERITY_LABEL[severity] ?? severity)} ${formatCount(count, 'finding')}`,
      );
    }
  }
  if (Object.values(bySeverity).every((count) => count === 0)) {
    lines.push(
      `  ${style.good(SYMBOLS.done)} no risks were found by the rules that had enough evidence to fire`,
    );
  }
  lines.push(
    `  ${style.good(SYMBOLS.done)} ${formatCount(summary.strengthCount, 'strength')} recorded`,
  );
  const evaluated = result.findingSet.rulesEvaluated;
  const clear = evaluated.filter((rule) => rule.status === 'clear').length;
  const insufficient = evaluated.filter((rule) => rule.status === 'insufficient_evidence').length;
  lines.push(
    style.dim(
      `  ${evaluated.length} rules evaluated: ${clear} clear, ${insufficient} lacked evidence`,
    ),
  );
  return lines;
};

/** What Orchescope could not look at. Reported every time, because silence here reads as full coverage. */
const notInspectedLines = (
  style: Style,
  coverage: AuditResult['graph']['coverage'],
): readonly string[] => {
  if (coverage.skipped.length === 0 && coverage.unsupported.length === 0 && !coverage.truncated) {
    return [];
  }
  const lines: string[] = ['', style.bold('Not inspected')];
  if (coverage.truncated) {
    lines.push(
      `  ${style.warn(SYMBOLS.warning)} the scan hit its file limit, so coverage is partial`,
    );
  }
  const reasons = new Map<string, number>();
  for (const entry of coverage.skipped) {
    reasons.set(entry.reason, (reasons.get(entry.reason) ?? 0) + 1);
  }
  for (const [reason, count] of reasons) {
    lines.push(`  ${SYMBOLS.pending} ${count} file(s) skipped: ${reason.replace(/_/g, ' ')}`);
  }
  for (const area of coverage.unsupported) {
    lines.push(`  ${SYMBOLS.pending} ${area.area}: ${area.reason}`);
  }
  return lines;
};

export const auditSummary = (style: Style, result: AuditResult): string => {
  const summary = result.bundle.summary;
  const graph = result.graph;
  const heading = [
    '',
    style.bold(`${result.bundle.projectName}  ${style.dim(graph.provenance.scanId)}`),
    style.dim('-'.repeat(WIDTH)),
  ];

  if (!result.agentSystemDetected) {
    return [...heading, ...notDetectedLines(style)].join('\n');
  }

  return [
    ...heading,
    `${SYMBOLS.bullet} ${formatCount(summary.componentCount, 'component')}, ${formatCount(summary.edgeCount, 'relation')}, ${formatCount(graph.coverage.filesParsed, 'file')} parsed`,
    ...reconciliationLines(style, result.reconciliation),
    ...findingLines(style, result),
    ...notInspectedLines(style, graph.coverage),
  ].join('\n');
};

export const findingList = (style: Style, findings: readonly Finding[], limit: number): string => {
  if (findings.length === 0) return style.dim('  no findings');
  const lines: string[] = [];
  for (const finding of findings.slice(0, limit)) {
    const marker =
      finding.polarity === 'strength'
        ? style.good(SYMBOLS.done)
        : paintSeverity(style, finding.severity, SYMBOLS.warning);
    lines.push(
      `  ${marker} ${style.dim(padRight(finding.id, 16))} ${truncate(finding.title, WIDTH - 20)}`,
    );
    lines.push(
      style.dim(
        `      ${finding.category} | ${finding.basis} | confidence ${finding.confidence.toFixed(2)} | ${formatCount(finding.evidence.length, 'evidence record')}`,
      ),
    );
  }
  if (findings.length > limit) {
    lines.push(style.dim(`  ... ${findings.length - limit} more, see the report`));
  }
  return lines.join('\n');
};

export const nextCommand = (bundle: ReportBundle, hasRuns: boolean): string => {
  if (!hasRuns) return 'orchescope trace -- <the command that starts your system>';
  const eligible = bundle.findings.find((finding) => finding.goalReadiness.eligible);
  if (eligible !== undefined) return `orchescope goal create ${eligible.id}`;
  if (bundle.scenarios.length === 0)
    return 'add a scenario under scenarios/ and run orchescope test --scenario <file>';
  return `orchescope benchmark --scenario ${bundle.scenarios[0]?.id ?? '<scenario>'} --agents 1,2,4`;
};

const CHECK_MARKERS: Readonly<Record<string, (style: Style) => string>> = {
  ok: (style) => style.good(SYMBOLS.done),
  warning: (style) => style.warn(SYMBOLS.warning),
  failed: (style) => style.bad(SYMBOLS.failed),
};

export const doctorSummary = (style: Style, result: DoctorResult): string => {
  const lines: string[] = [];
  const width = Math.max(...result.checks.map((check) => check.name.length)) + 2;
  for (const check of result.checks) {
    const marker = (CHECK_MARKERS[check.status] ?? ((inner: Style) => inner.dim(SYMBOLS.skipped)))(
      style,
    );
    lines.push(`${marker} ${padRight(check.name, width)} ${check.detail}`);
    if (check.remediation !== undefined && check.status !== 'ok') {
      lines.push(style.dim(`  ${' '.repeat(width)} ${check.remediation}`));
    }
  }
  lines.push('');
  lines.push(
    result.ok
      ? style.good(
          `${SYMBOLS.done} every required check passed${result.warnings > 0 ? `, with ${formatCount(result.warnings, 'warning')}` : ''}`,
        )
      : style.bad(`${SYMBOLS.failed} at least one required check failed`),
  );
  return lines.join('\n');
};

export const scenarioSummary = (style: Style, result: ScenarioResult): string => {
  const lines: string[] = [];
  lines.push('');
  lines.push(
    `${result.passed ? style.good(SYMBOLS.done) : style.bad(SYMBOLS.failed)} ${style.bold(result.scenarioId)}: ${result.passed ? 'passed' : 'failed'} over ${formatCount(result.repetitions.length, 'repetition')}`,
  );
  const distribution = result.aggregate.durationMs;
  lines.push(
    `  duration: p50 ${distribution.p50 === undefined ? 'withheld' : `${Math.round(distribution.p50)}ms`}, min ${Math.round(distribution.min ?? 0)}ms, max ${Math.round(distribution.max ?? 0)}ms, ${formatCount(distribution.sampleSize, 'sample')}`,
  );
  for (const withheld of distribution.withheld) {
    lines.push(
      style.dim(
        `  ${withheld.quantile} withheld: it needs at least ${withheld.requiredSamples} samples`,
      ),
    );
  }
  lines.push(
    `  reliability: ${result.reliability.successes} of ${result.reliability.repetitions} succeeded${result.reliability.passPowerK
      .map((entry) => `, pass^${entry.k} ${entry.value.toFixed(2)}`)
      .join('')}`,
  );
  const failedEvaluators = result.aggregate.evaluators.filter(
    (evaluator) => !evaluator.passed && evaluator.skipped !== true,
  );
  for (const evaluator of failedEvaluators) {
    lines.push(`  ${style.bad(SYMBOLS.failed)} ${evaluator.kind}: ${evaluator.detail}`);
  }
  const skipped = result.aggregate.evaluators.filter((evaluator) => evaluator.skipped === true);
  for (const evaluator of skipped) {
    lines.push(
      style.dim(
        `  ${SYMBOLS.skipped} ${evaluator.kind} skipped: ${evaluator.skipReason ?? 'no reason given'}`,
      ),
    );
  }
  for (const limitation of result.limitations) {
    lines.push(style.dim(`  ${SYMBOLS.pending} ${limitation}`));
  }
  return lines.join('\n');
};

const VERDICT_PAINTERS: Readonly<Record<string, (style: Style) => (text: string) => string>> = {
  improved: (style) => style.good,
  regressed: (style) => style.bad,
};

const DIRECTION_MARKERS: Readonly<Record<string, (style: Style) => string>> = {
  improved: (style) => style.good(SYMBOLS.done),
  regressed: (style) => style.bad(SYMBOLS.failed),
};

const metricRow = (
  style: Style,
  delta: Comparison['metricDeltas'][number],
  nameWidth: number,
): string => {
  const change =
    delta.relativeChange === undefined
      ? '-'
      : `${delta.relativeChange > 0 ? '+' : ''}${(delta.relativeChange * 100).toFixed(1)}%`;
  const marker = (
    DIRECTION_MARKERS[delta.direction] ?? ((inner: Style) => inner.dim(SYMBOLS.pending))
  )(style);
  const value = (amount: number | undefined): string =>
    amount === undefined ? '-' : amount.toFixed(2);
  return `  ${marker} ${padRight(delta.metric, nameWidth - 2)} ${padRight(value(delta.baseline), 12)} ${padRight(value(delta.candidate), 12)} ${padRight(change, 12)} ${delta.baselineSamples}/${delta.candidateSamples}`;
};

export const comparisonSummary = (style: Style, comparison: Comparison): string => {
  const lines: string[] = [];
  const verdictStyle = (VERDICT_PAINTERS[comparison.verdict] ?? ((inner: Style) => inner.warn))(
    style,
  );
  lines.push('');
  lines.push(`${verdictStyle(comparison.verdict.replace(/_/g, ' '))}: ${comparison.verdictReason}`);
  lines.push(
    style.dim(
      `  ${comparison.baseline.label} (${comparison.baseline.reference}) against ${comparison.candidate.label} (${comparison.candidate.reference})`,
    ),
  );
  lines.push('');
  const nameWidth = Math.max(...comparison.metricDeltas.map((delta) => delta.metric.length), 8) + 1;
  lines.push(
    style.dim(
      `  ${padRight('metric', nameWidth)} ${padRight('baseline', 12)} ${padRight('candidate', 12)} ${padRight('change', 12)} samples`,
    ),
  );
  for (const delta of comparison.metricDeltas) {
    lines.push(metricRow(style, delta, nameWidth));
    if (delta.caveat !== undefined) lines.push(style.dim(`      ${delta.caveat}`));
  }
  for (const limitation of comparison.limitations) {
    lines.push(style.dim(`  ${SYMBOLS.pending} ${limitation}`));
  }
  return lines.join('\n');
};

export const goalSummary = (style: Style, goal: Goal): string =>
  [
    '',
    `${style.bold(goal.id)}  ${goal.title}`,
    style.dim(`  from finding ${goal.findingId}, risk ${goal.risk}, status ${goal.status}`),
    '',
    style.bold('  Acceptance criteria'),
    ...goal.acceptanceCriteria.map((criterion) => `    ${criterion.id} ${criterion.statement}`),
    '',
    style.bold('  Validation'),
    ...goal.validation.commands.map((entry) => `    ${entry.command.join(' ')}`),
    goal.validation.baselineRunIds.length === 0
      ? style.dim('    no baseline run recorded, so metric criteria cannot be judged yet')
      : style.dim(`    baseline: ${goal.validation.baselineRunIds.join(', ')}`),
    '',
    style.bold('  Allowed write paths'),
    ...goal.scope.allowedWritePaths.map((path) => `    ${path}`),
  ].join('\n');
