/**
 * Goal exports.
 *
 * An improvement goal is the contract between the report and whoever implements the change. These
 * builders are the whole of that hand off: they work with no server, they contain no advice that is
 * not in the goal document, and they carry the write scope and the prohibitions rather than only the
 * request, because an agent given a task without a boundary will find one of its own.
 */

import type { AcceptanceCriterion, Goal } from '@orchescope/schema';
import { formatArgv } from './format.ts';

type Check = AcceptanceCriterion['check'];

export function describeAcceptanceCheck(check: Check): string {
  switch (check.kind) {
    case 'metric_improvement': {
      const relative =
        check.relativeThreshold === undefined
          ? null
          : `${(check.relativeThreshold * 100).toFixed(1)}% relative`;
      const absolute =
        check.absoluteThreshold === undefined ? null : `${check.absoluteThreshold} absolute`;
      const bound = [relative, absolute].filter((part) => part !== null).join(' or ');
      return `metric ${check.metric} ${check.comparator}${bound.length > 0 ? ` ${bound}` : ''}`;
    }
    case 'metric_not_worse':
      return `metric ${check.metric} no worse than baseline within ${check.tolerance}`;
    case 'scenario_passes':
      return `scenario ${check.scenarioId} passes`;
    case 'finding_resolved':
      return `finding ${check.findingId} no longer reported`;
    case 'command_succeeds':
      return `command succeeds: ${formatArgv(check.command)}`;
    case 'manual_review':
      return `manual review: ${check.instruction}`;
    default:
      return 'unrecognised check';
  }
}

function bullets(lines: readonly string[], marker = '- '): readonly string[] {
  return lines.map((line) => `${marker}${line}`);
}

function section(title: string, lines: readonly string[]): readonly string[] {
  if (lines.length === 0) {
    return [title, '(none recorded)', ''];
  }
  return [title, ...lines, ''];
}

function locationLines(goal: Goal): readonly string[] {
  return goal.sourceLocations.map((location) => {
    const end =
      location.endLine !== undefined && location.endLine !== location.startLine
        ? `-${location.endLine}`
        : '';
    return `- ${location.file}:${location.startLine}${end}`;
  });
}

function evidenceLines(goal: Goal): readonly string[] {
  return goal.evidenceSummary.map((entry) => `- ${entry.label}: ${entry.value} [${entry.basis}]`);
}

function criteriaLines(goal: Goal): readonly string[] {
  return goal.acceptanceCriteria.map(
    (criterion) =>
      `- ${criterion.id} ${criterion.statement} (checked by: ${describeAcceptanceCheck(criterion.check)})`,
  );
}

function validationLines(goal: Goal): readonly string[] {
  const lines = goal.validation.commands.map(
    (entry) => `- ${entry.purpose}: ${formatArgv(entry.command)}`,
  );
  if (goal.validation.scenarioIds.length > 0) {
    lines.push(`- Scenarios to rerun: ${goal.validation.scenarioIds.join(', ')}`);
  }
  if (goal.validation.baselineRunIds.length > 0) {
    lines.push(`- Baseline runs: ${goal.validation.baselineRunIds.join(', ')}`);
  }
  if (goal.validation.baselineBenchmarkId !== undefined) {
    lines.push(`- Baseline benchmark: ${goal.validation.baselineBenchmarkId}`);
  }
  lines.push(`- Repetitions: ${goal.validation.repetitions}`);
  lines.push(
    `- Requires executing the system: ${goal.validation.requiresExecution ? 'yes' : 'no'}`,
  );
  return lines;
}

/**
 * A self contained plain text brief. Deliberately not Markdown: it is pasted into a terminal, an issue
 * tracker or an agent prompt, and plain text survives all three.
 */
export function buildAgentPrompt(goal: Goal): string {
  const lines: string[] = [
    `Improvement goal ${goal.id}: ${goal.title}`,
    `Derived from finding ${goal.findingId}. Status ${goal.status}, risk ${goal.risk}.`,
    '',
    ...section('PROBLEM', [goal.problemStatement]),
    ...section('EVIDENCE', evidenceLines(goal)),
    ...section('AFFECTED COMPONENTS', bullets(goal.affectedComponents)),
    ...section('SOURCE LOCATIONS', locationLines(goal)),
    ...section('YOU MAY ONLY WRITE TO', bullets(goal.scope.allowedWritePaths)),
    ...section('YOU MUST NOT', bullets(goal.scope.prohibitedChanges)),
    ...section('BEHAVIOUR THAT MUST NOT CHANGE', bullets(goal.scope.invariants)),
    ...section('ACCEPTANCE CRITERIA', criteriaLines(goal)),
    ...section('VALIDATION', validationLines(goal)),
    ...section('ROLLBACK', [goal.rollback]),
  ];
  if (goal.scope.requiredApprovals.length > 0) {
    lines.push(
      ...section('APPROVALS REQUIRED BEFORE MERGING', bullets(goal.scope.requiredApprovals)),
    );
  }
  if (goal.expectedImprovement !== undefined) {
    lines.push(...section('EXPECTED IMPROVEMENT', [goal.expectedImprovement]));
  }
  lines.push(
    'Do not widen the scope. If the evidence above is insufficient to make the change safely, say so',
    'and stop rather than guessing.',
  );
  return `${lines.join('\n').trimEnd()}\n`;
}

function markdownList(lines: readonly string[]): readonly string[] {
  return lines.length === 0 ? ['_None recorded._', ''] : [...lines, ''];
}

export function goalToMarkdown(goal: Goal): string {
  const lines: string[] = [
    `# ${goal.id} ${goal.title}`,
    '',
    `- Finding: ${goal.findingId}`,
    `- Status: ${goal.status}`,
    `- Risk: ${goal.risk}`,
    `- Created: ${goal.createdAt}`,
    `- Updated: ${goal.updatedAt}`,
    '',
    '## Problem',
    '',
    goal.problemStatement,
    '',
    '## Evidence',
    '',
    ...markdownList(evidenceLines(goal)),
    '## Affected components',
    '',
    ...markdownList(bullets(goal.affectedComponents)),
    '## Source locations',
    '',
    ...markdownList(locationLines(goal)),
    '## Scope',
    '',
    '### Allowed write paths',
    '',
    ...markdownList(bullets(goal.scope.allowedWritePaths)),
    '### Prohibited changes',
    '',
    ...markdownList(bullets(goal.scope.prohibitedChanges)),
    '### Invariants',
    '',
    ...markdownList(bullets(goal.scope.invariants)),
    '## Acceptance criteria',
    '',
    ...markdownList(criteriaLines(goal)),
    '## Validation',
    '',
    ...markdownList(validationLines(goal)),
    '## Rollback',
    '',
    goal.rollback,
    '',
  ];
  if (goal.validationResults.length > 0) {
    lines.push(
      '## Validation results',
      '',
      ...markdownList(
        goal.validationResults.map(
          (result) => `- ${result.at} ${result.comparisonId}: ${result.verdict}`,
        ),
      ),
    );
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function goalToJson(goal: Goal): string {
  return `${JSON.stringify(goal, null, 2)}\n`;
}
