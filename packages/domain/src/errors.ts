/**
 * Structured errors. Every failure Orchescope reports carries a code, a category and, when the user
 * can do something about it, a remediation. Nothing is thrown as a bare string or a plain Error.
 */

export const ERROR_CODES = [
  'CONFIG_INVALID',
  'SCHEMA_INVALID',
  'ARTIFACT_INVALID',
  'ARTIFACT_MISSING',
  'STORE_CORRUPT',
  'STORE_VERSION_UNSUPPORTED',
  'NOT_FOUND',
  'POLICY_DENIED',
  'BUDGET_EXCEEDED',
  'PERMISSION_REQUIRED',
  'TIMEOUT',
  'CANCELLED',
  'TARGET_FAILED',
  'TARGET_PROTOCOL_VIOLATION',
  'UNSUPPORTED_ECOSYSTEM',
  'UNSUPPORTED_PLATFORM',
  'PARSE_FAILED',
  'IO_FAILED',
  'NETWORK_REFUSED',
  'MODEL_UNAVAILABLE',
  'MODEL_OUTPUT_REJECTED',
  'INVALID_ARGUMENT',
  'INVALID_STATE',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Category drives how the edge presents a failure:
 *  - `user` the caller can fix it, show remediation and exit 2
 *  - `policy` the action was refused on purpose, show what to grant and exit 3
 *  - `target` the audited system failed, not Orchescope, exit 4
 *  - `environment` the machine or platform is missing something, exit 5
 *  - `internal` a defect in Orchescope, exit 70 and ask for a report
 */
export type ErrorCategory = 'user' | 'policy' | 'target' | 'environment' | 'internal';

const CATEGORY_BY_CODE: Readonly<Record<ErrorCode, ErrorCategory>> = {
  CONFIG_INVALID: 'user',
  SCHEMA_INVALID: 'user',
  ARTIFACT_INVALID: 'user',
  ARTIFACT_MISSING: 'user',
  STORE_CORRUPT: 'environment',
  STORE_VERSION_UNSUPPORTED: 'environment',
  NOT_FOUND: 'user',
  POLICY_DENIED: 'policy',
  BUDGET_EXCEEDED: 'policy',
  PERMISSION_REQUIRED: 'policy',
  TIMEOUT: 'target',
  CANCELLED: 'user',
  TARGET_FAILED: 'target',
  TARGET_PROTOCOL_VIOLATION: 'target',
  UNSUPPORTED_ECOSYSTEM: 'user',
  UNSUPPORTED_PLATFORM: 'environment',
  PARSE_FAILED: 'target',
  IO_FAILED: 'environment',
  NETWORK_REFUSED: 'environment',
  MODEL_UNAVAILABLE: 'environment',
  MODEL_OUTPUT_REJECTED: 'internal',
  INVALID_ARGUMENT: 'user',
  INVALID_STATE: 'internal',
  INTERNAL: 'internal',
};

export type ErrorDetail = Readonly<Record<string, string | number | boolean>>;

export type OrchescopeErrorOptions = {
  readonly detail?: ErrorDetail;
  readonly remediation?: string;
  readonly cause?: unknown;
};

export class OrchescopeError extends Error {
  readonly code: ErrorCode;
  readonly category: ErrorCategory;
  readonly detail: ErrorDetail;
  readonly remediation: string | undefined;

  constructor(code: ErrorCode, message: string, options: OrchescopeErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'OrchescopeError';
    this.code = code;
    this.category = CATEGORY_BY_CODE[code];
    this.detail = options.detail ?? {};
    this.remediation = options.remediation;
  }

  toJSON(): {
    code: ErrorCode;
    category: ErrorCategory;
    message: string;
    detail: ErrorDetail;
    remediation?: string;
  } {
    return {
      code: this.code,
      category: this.category,
      message: this.message,
      detail: this.detail,
      ...(this.remediation === undefined ? {} : { remediation: this.remediation }),
    };
  }
}

export const isOrchescopeError = (value: unknown): value is OrchescopeError =>
  value instanceof OrchescopeError;

export const errorCategory = (code: ErrorCode): ErrorCategory => CATEGORY_BY_CODE[code];

/**
 * Wraps an unknown thrown value without losing it. Used at process boundaries where a third party
 * can throw anything at all.
 */
export const asOrchescopeError = (
  value: unknown,
  fallbackCode: ErrorCode = 'INTERNAL',
  fallbackMessage = 'An unexpected failure occurred.',
): OrchescopeError => {
  if (isOrchescopeError(value)) return value;
  if (value instanceof Error) {
    return new OrchescopeError(fallbackCode, value.message || fallbackMessage, { cause: value });
  }
  return new OrchescopeError(fallbackCode, fallbackMessage, {
    detail: { thrown: typeof value === 'string' ? value.slice(0, 500) : typeof value },
  });
};

export const cancelledError = (what: string): OrchescopeError =>
  new OrchescopeError('CANCELLED', `${what} was cancelled.`);

export const timeoutError = (what: string, timeoutMs: number): OrchescopeError =>
  new OrchescopeError('TIMEOUT', `${what} exceeded its ${timeoutMs} ms deadline.`, {
    detail: { timeoutMs },
    remediation: 'Raise the deadline for this operation or reduce the work it has to do.',
  });
