/**
 * Redaction. Applied to every string that leaves the process, and never described as a guarantee: a pattern
 * set cannot prove the absence of a secret.
 */

export {
  DEFAULT_RULES,
  DEFAULT_SENSITIVE_FRAGMENTS,
  type RedactionRule,
  type Redactor,
  type RedactorOptions,
  createRedactor,
  redactDeep,
} from './redact.ts';
