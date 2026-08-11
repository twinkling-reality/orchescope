import { formatCount } from '@orchescope/domain';
import type { DoctorResult } from '@orchescope/usecases';
import { padRight, type Style, SYMBOLS } from './style.ts';

/** What `orchescope doctor` reports: one row per check, then whether the required ones all passed. */

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
