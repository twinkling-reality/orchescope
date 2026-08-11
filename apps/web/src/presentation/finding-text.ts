/**
 * Plain text rendering of a finding, for the clipboard. Everything the reader saw on screen is in it,
 * including the evidence identifiers, so a finding pasted into a review can still be checked.
 */

import type { Finding } from '@orchescope/schema';
import { describeBasis } from './basis.ts';
import { formatArgv, formatConfidence, formatMetricValue, formatSourceLocation } from './format.ts';

function headerLines(finding: Finding): readonly string[] {
  return [
    `${finding.id} ${finding.title}`,
    `Severity ${finding.severity} | category ${finding.category} | ${finding.polarity}`,
    `Evidence class ${describeBasis(finding.basis).label} | confidence ${formatConfidence(finding.confidence)}`,
    `Rule ${finding.ruleId} | recorded ${finding.createdAt}`,
    '',
    'EXPLANATION',
    finding.explanation,
    '',
    'IMPACT',
    finding.impact,
    '',
  ];
}

function metricLines(finding: Finding): readonly string[] {
  if (finding.metrics.length === 0) {
    return [];
  }
  const lines = finding.metrics.map((metric) => {
    const comparison =
      metric.comparisonValue === undefined
        ? ''
        : ` (compared with ${formatMetricValue(metric.comparisonValue, metric.unit)})`;
    return `- ${metric.name}: ${formatMetricValue(metric.value, metric.unit)}${comparison}, sample size ${metric.sampleSize}, ${describeBasis(metric.basis).label.toLowerCase()}`;
  });
  return ['MEASUREMENTS', ...lines, ''];
}

function componentLines(
  finding: Finding,
  describeComponentId: (componentId: string) => string,
): readonly string[] {
  if (finding.components.length === 0) {
    return [];
  }
  return [
    'AFFECTED COMPONENTS',
    ...finding.components.map(
      (componentId) => `- ${describeComponentId(componentId)} (${componentId})`,
    ),
    '',
  ];
}

function locationLines(finding: Finding): readonly string[] {
  if (finding.sourceLocations.length === 0) {
    return [];
  }
  return [
    'SOURCE LOCATIONS',
    ...finding.sourceLocations.map(
      (location) =>
        `- ${formatSourceLocation(location.file, location.startLine, location.endLine)}`,
    ),
    '',
  ];
}

function recommendationLines(finding: Finding): readonly string[] {
  const recommendation = finding.recommendation;
  if (recommendation === undefined) {
    return [];
  }
  return [
    'RECOMMENDATION',
    recommendation.summary,
    ...recommendation.steps.map((step, offset) => `${offset + 1}. ${step}`),
    `Effort ${recommendation.effort}, change risk ${recommendation.risk} (both are design judgements, not measurements)`,
    '',
  ];
}

function experimentLines(finding: Finding): readonly string[] {
  const experiment = finding.suggestedExperiment;
  if (experiment === undefined) {
    return [];
  }
  return [
    'SUGGESTED EXPERIMENT',
    experiment.description,
    `Command: ${formatArgv(experiment.command)}`,
    `Expected signal: ${experiment.expectedSignal}`,
    '',
  ];
}

function classificationLines(finding: Finding): readonly string[] {
  const lines: string[] = [];
  if (finding.taxonomy.length > 0) {
    lines.push(`TAXONOMY ${finding.taxonomy.join(', ')}`, '');
  }
  if (finding.conflictsWith.length > 0) {
    lines.push(`CONFLICTS WITH ${finding.conflictsWith.join(', ')}`, '');
  }
  lines.push(
    'GOAL READINESS',
    `${finding.goalReadiness.eligible ? 'eligible' : 'not eligible'}: ${finding.goalReadiness.reason}`,
  );
  return lines;
}

export function buildFindingText(
  finding: Finding,
  describeComponentId: (componentId: string) => string,
): string {
  const lines = [
    ...headerLines(finding),
    ...metricLines(finding),
    ...componentLines(finding, describeComponentId),
    ...locationLines(finding),
    'EVIDENCE',
    ...finding.evidence.map((id) => `- ${id}`),
    '',
    ...recommendationLines(finding),
    ...experimentLines(finding),
    ...classificationLines(finding),
  ];
  return `${lines.join('\n').trimEnd()}\n`;
}
