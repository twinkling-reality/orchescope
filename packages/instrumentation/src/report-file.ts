import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { PatchOutcome } from './mcp-client.ts';

/**
 * What the shim managed to do, written where the run that started it can read it.
 *
 * The shim has no voice. It must not write to the target's own output, because those streams belong to
 * the program under test and a reader comparing two runs would see this instead of their own. But a patch
 * that declined has to reach somebody: a target whose Model Context Protocol client is a shape this build
 * does not know would otherwise produce a trace with no tool calls in it and no way to tell that from a
 * target that made none.
 *
 * The file goes beside the result document, in a directory the traced run created for exactly this and
 * removes afterwards. A failure to write it is swallowed like everything else here.
 */

export type InstrumentationReport = {
  readonly patches: readonly PatchOutcome[];
};

export const REPORT_FILE_NAME = 'instrumentation.json';

/** The report path for a run, derived from the result file the run already names. */
export const reportPathFor = (resultFile: string): string =>
  join(dirname(resultFile), REPORT_FILE_NAME);

export const writeReport = (
  resultFile: string | undefined,
  report: InstrumentationReport,
): void => {
  if (resultFile === undefined || resultFile.length === 0) return;
  try {
    writeFileSync(reportPathFor(resultFile), `${JSON.stringify(report)}\n`, { mode: 0o600 });
  } catch {
    // A run that cannot say what it patched is still a run. Nothing here is worth failing a target over.
  }
};
