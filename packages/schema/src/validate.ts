import type { Static, TSchema } from '@sinclair/typebox';
import { TypeCompiler } from '@sinclair/typebox/compiler';
import { Value } from '@sinclair/typebox/value';

/**
 * Validation returns a result rather than throwing. Every untrusted input crossing into Orchescope
 * (imported artifacts, scenario files, OTLP payloads, MCP arguments) passes through here, and the
 * caller decides how a failure is surfaced.
 */

export type ValidationIssue = {
  readonly path: string;
  readonly message: string;
  readonly received?: string;
};

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

const MAX_REPORTED_ISSUES = 20;

const describe = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return 'null';
  if (typeof value === 'object') return Array.isArray(value) ? `array(${value.length})` : 'object';
  const text = String(value);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
};

export const validate = <S extends TSchema>(
  schema: S,
  data: unknown,
): ValidationResult<Static<S>> => {
  if (Value.Check(schema, data)) {
    return { ok: true, value: data as Static<S> };
  }
  const issues: ValidationIssue[] = [];
  for (const error of Value.Errors(schema, data)) {
    if (issues.length >= MAX_REPORTED_ISSUES) break;
    const received = describe(error.value);
    issues.push({
      path: error.path === '' ? '/' : error.path,
      message: error.message,
      ...(received === undefined ? {} : { received }),
    });
  }
  return { ok: false, issues };
};

/** Precompiled checker for hot paths such as trace ingestion. */
export const compileChecker = <S extends TSchema>(schema: S) => {
  const compiled = TypeCompiler.Compile(schema);
  return (data: unknown): ValidationResult<Static<S>> => {
    if (compiled.Check(data)) return { ok: true, value: data as Static<S> };
    const issues: ValidationIssue[] = [];
    for (const error of compiled.Errors(data)) {
      if (issues.length >= MAX_REPORTED_ISSUES) break;
      const received = describe(error.value);
      issues.push({
        path: error.path === '' ? '/' : error.path,
        message: error.message,
        ...(received === undefined ? {} : { received }),
      });
    }
    return { ok: false, issues };
  };
};

/**
 * Validates a versioned document, checking the version before the shape so that an unreadable
 * artifact produces a clear message instead of a wall of property errors.
 */
export const validateDocument = <S extends TSchema>(
  schema: S,
  expectedVersion: number,
  minReadableVersion: number,
  data: unknown,
): ValidationResult<Static<S>> => {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, issues: [{ path: '/', message: 'Expected a JSON object document.' }] };
  }
  const version = (data as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return {
      ok: false,
      issues: [
        {
          path: '/schemaVersion',
          message: 'Missing integer schemaVersion.',
          ...(describe(version) === undefined ? {} : { received: describe(version) as string }),
        },
      ],
    };
  }
  if (version > expectedVersion) {
    return {
      ok: false,
      issues: [
        {
          path: '/schemaVersion',
          message: `Document version ${version} is newer than this build understands (${expectedVersion}). Upgrade Orchescope.`,
        },
      ],
    };
  }
  if (version < minReadableVersion) {
    return {
      ok: false,
      issues: [
        {
          path: '/schemaVersion',
          message: `Document version ${version} is older than the minimum readable version ${minReadableVersion}.`,
        },
      ],
    };
  }
  return validate(schema, data);
};

export const formatIssues = (issues: readonly ValidationIssue[]): string =>
  issues
    .map(
      (issue) =>
        `${issue.path}: ${issue.message}${issue.received === undefined ? '' : ` (received ${issue.received})`}`,
    )
    .join('; ');
