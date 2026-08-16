import { isOrchescopeError, type OrchescopeError } from '@orchescope/domain';
import type { Style } from './terminal/style.ts';

/**
 * Exit codes and error presentation.
 *
 * Codes are part of the interface, so they are stable and documented:
 *
 *  0  success
 *  1  the command succeeded and found something the caller asked to fail on, or reached no conclusion
 *     a gate may proceed on: `compare` exits 1 on a regression and on insufficient evidence, because a
 *     gate that goes green on "I cannot tell" is worse than no gate
 *  2  the caller made a mistake, for example an unknown scenario or an invalid flag
 *  3  the action was refused by policy
 *  4  the audited system failed, not Orchescope
 *  5  the environment is missing something Orchescope needs
 *  70 a defect in Orchescope
 *  130 interrupted
 *
 * An error message states what happened, then what to do about it. A stack trace appears only in verbose mode,
 * because a stack is for a maintainer and a remediation is for a user.
 */

export const EXIT_CODES = {
  success: 0,
  findings: 1,
  user: 2,
  policy: 3,
  target: 4,
  environment: 5,
  internal: 70,
  interrupted: 130,
} as const;

export const exitCodeFor = (error: unknown): number => {
  if (!isOrchescopeError(error)) return EXIT_CODES.internal;
  switch (error.category) {
    case 'user':
      return error.code === 'CANCELLED' ? EXIT_CODES.interrupted : EXIT_CODES.user;
    case 'policy':
      return EXIT_CODES.policy;
    case 'target':
      return EXIT_CODES.target;
    case 'environment':
      return EXIT_CODES.environment;
    default:
      return EXIT_CODES.internal;
  }
};

const classifiedErrorLines = (
  style: Style,
  error: OrchescopeError,
  verbose: boolean,
): readonly string[] => {
  const lines = [`${style.bad('error')} ${error.message}`];
  if (error.remediation !== undefined) lines.push(`  ${error.remediation}`);
  const detail = Object.entries(error.detail);
  if (verbose && detail.length > 0) {
    lines.push(style.dim(`  ${detail.map(([key, value]) => `${key}=${String(value)}`).join(' ')}`));
  }
  if (verbose && error.stack !== undefined) lines.push(style.dim(error.stack));
  if (error.category === 'internal') {
    lines.push(
      style.dim(
        '  This is a defect in Orchescope. Rerun with --verbose and include the output in a report.',
      ),
    );
  }
  return lines;
};

const plainErrorLines = (style: Style, error: unknown, verbose: boolean): readonly string[] => {
  if (!(error instanceof Error)) {
    return [`${style.bad('error')} an unexpected value was thrown`];
  }
  const lines = [`${style.bad('error')} ${error.message}`];
  if (verbose && error.stack !== undefined) lines.push(style.dim(error.stack));
  return lines;
};

export const renderError = (style: Style, error: unknown, verbose: boolean): string => {
  const lines = isOrchescopeError(error)
    ? classifiedErrorLines(style, error, verbose)
    : plainErrorLines(style, error, verbose);
  return `${lines.join('\n')}\n`;
};

/**
 * The failure document.
 *
 * It carries `command` and `version` for the same reason the success document does: a caller reads those two
 * fields the same way whatever happened, and a document that changes shape on failure is a document a script has
 * to special case. `data` is null rather than absent, so the key is always there to read.
 */
export const jsonError = (
  error: unknown,
  input: { readonly command: string; readonly version: string },
): Record<string, unknown> => ({
  ok: false,
  command: input.command,
  version: input.version,
  data: null,
  error: isOrchescopeError(error)
    ? error.toJSON()
    : {
        code: 'INTERNAL',
        category: 'internal',
        message: error instanceof Error ? error.message : 'an unexpected value was thrown',
      },
});
