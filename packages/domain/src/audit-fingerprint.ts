/**
 * The stable core of an audit JSON document.
 *
 * Round 2 of the agent comparison measured that three audits of an unchanged clone are not
 * byte-identical: `durationMs` (and sibling timings) and freshly minted scan, report, evidence and
 * finding display identifiers move. After those volatiles are stripped, finding content is equal.
 *
 * Any claim that audits are reproducible must either produce byte-identical JSON or document and
 * exclude these fields. This helper is the exclusion.
 */

const VOLATILE_KEY =
  /^(durationMs|elapsedMs|startedAt|finishedAt|createdAt|updatedAt|scannedAt|recordedAt)$/;

const VOLATILE_ID = /^(scanId|reportId|runId|comparisonId|evidenceId|id|goalId)$/;

const looksLikeFreshId = (value: string): boolean =>
  /^(scan_|run_|cmp_|ev_|rpt_|OSC-[A-Z]{3,5}-\d{4}|OSC-GOAL-\d{4})/.test(value);

const scrub = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(scrub);
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'string' && looksLikeFreshId(value)) return '<id>';
    return value;
  }
  const record = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (VOLATILE_KEY.test(key)) continue;
    if (VOLATILE_ID.test(key)) {
      next[key] = typeof entry === 'string' ? '<id>' : scrub(entry);
      continue;
    }
    next[key] = scrub(entry);
  }
  return next;
};

/**
 * A canonical fingerprint of audit output for reproducibility claims.
 *
 * Pass the parsed `--json` document (or its `data` object). Volatile timings and fresh identifiers are
 * removed or replaced; what remains is what Round 2 found stable across identical inputs.
 */
export const auditFingerprint = (document: unknown): unknown => scrub(document);
