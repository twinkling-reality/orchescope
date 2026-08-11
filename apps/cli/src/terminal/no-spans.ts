import { type Style, SYMBOLS } from './style.ts';

/**
 * A run that collected nothing.
 *
 * This is where a first attempt at runtime evidence usually stops, so the message names what Orchescope did,
 * which variables the exporter was expected to honour, the three things that actually cause an empty run, and
 * the way in that needs no instrumentation at all. The variable names come from the run rather than from a
 * list in this file, so they cannot drift from what was set.
 */
export const noSpansLines = (
  style: Style,
  input: { readonly receiverUrl: string; readonly otlpVariables: readonly string[] },
): string =>
  [
    `${style.warn(SYMBOLS.warning)} No spans arrived, so this run produced no runtime evidence.`,
    style.dim(
      `  Orchescope listened on ${input.receiverUrl} and accepts OTLP over HTTP on /v1/traces, protobuf or JSON.`,
    ),
    ...(input.otlpVariables.length === 0
      ? []
      : [style.dim(`  It set ${input.otlpVariables.join(', ')} for the target process.`)]),
    style.dim(
      '  Usually one of three things: no OpenTelemetry SDK was loaded, the SDK exported over gRPC rather than HTTP, or the process exited before flushing.',
    ),
    style.dim(
      '  A system that emits nothing yet can still be reconciled: declare it in .orchescope/manifest.yaml, or import spans you already have with orchescope trace --import <file>.',
    ),
  ].join('\n');
