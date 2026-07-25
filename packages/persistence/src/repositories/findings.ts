import type { Finding } from '@orchescope/schema';
import { asInteger, type Database } from '../database.ts';
import { text } from '../rows.ts';

/**
 * Findings.
 *
 * Findings are stored per scan, so a rescan produces a new set rather than mutating the old one and a comparison can
 * ask which findings a change resolved.
 */

export const createFindingsRepository = (input: { readonly database: Database }) => {
  const { database } = input;

  const saveFindings = (scanId: string, findings: readonly Finding[]): void =>
    database.transaction(() => {
      database.run('DELETE FROM finding WHERE scan_id = ?', scanId);
      database.run('DELETE FROM finding_component WHERE scan_id = ?', scanId);
      for (const finding of findings) {
        database.run(
          `INSERT INTO finding (id, scan_id, rule_id, category, polarity, severity, confidence, basis,
                                title, goal_eligible, created_at, json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          finding.id,
          scanId,
          finding.ruleId,
          finding.category,
          finding.polarity,
          finding.severity,
          finding.confidence,
          finding.basis,
          finding.title,
          asInteger(finding.goalReadiness.eligible),
          finding.createdAt,
          JSON.stringify(finding),
        );
        for (const componentId of finding.components) {
          database.run(
            `INSERT INTO finding_component (scan_id, finding_id, component_id) VALUES (?, ?, ?)
             ON CONFLICT DO NOTHING`,
            scanId,
            finding.id,
            componentId,
          );
        }
      }
    });

  const listFindings = (input: {
    readonly scanId: string;
    readonly severity?: readonly string[];
    readonly category?: readonly string[];
    readonly polarity?: string;
    readonly componentId?: string;
    readonly limit?: number;
  }): readonly Finding[] => {
    const clauses = ['finding.scan_id = ?'];
    const parameters: (string | number)[] = [input.scanId];
    if (input.severity !== undefined && input.severity.length > 0) {
      clauses.push(`finding.severity IN (${input.severity.map(() => '?').join(', ')})`);
      parameters.push(...input.severity);
    }
    if (input.category !== undefined && input.category.length > 0) {
      clauses.push(`finding.category IN (${input.category.map(() => '?').join(', ')})`);
      parameters.push(...input.category);
    }
    if (input.polarity !== undefined) {
      clauses.push('finding.polarity = ?');
      parameters.push(input.polarity);
    }
    const join =
      input.componentId === undefined
        ? ''
        : 'JOIN finding_component ON finding_component.scan_id = finding.scan_id AND finding_component.finding_id = finding.id';
    if (input.componentId !== undefined) {
      clauses.push('finding_component.component_id = ?');
      parameters.push(input.componentId);
    }
    parameters.push(input.limit ?? 500);
    const rows = database.all(
      `SELECT DISTINCT finding.json AS json, finding.severity AS severity, finding.id AS id
       FROM finding ${join}
       WHERE ${clauses.join(' AND ')}
       ORDER BY CASE finding.severity
                  WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2
                  WHEN 'low' THEN 3 ELSE 4 END, finding.id
       LIMIT ?`,
      ...parameters,
    );
    return rows.map((row) => JSON.parse(text(row, 'json')) as Finding);
  };

  const findingById = (scanId: string, findingId: string): Finding | undefined => {
    const row = database.get(
      'SELECT json FROM finding WHERE scan_id = ? AND id = ?',
      scanId,
      findingId,
    );
    return row === undefined ? undefined : (JSON.parse(text(row, 'json')) as Finding);
  };

  return {
    saveFindings,
    listFindings,
    findingById,
  };
};
