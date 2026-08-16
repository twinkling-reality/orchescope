import type { InstrumentationOutcome } from '@orchescope/usecases';
import { type Style, SYMBOLS } from './style.ts';

/**
 * A run that collected nothing.
 *
 * This is where a first attempt at runtime evidence usually stops, so the message names what Orchescope did,
 * which variables the exporter was expected to honour, the three things that actually cause an empty run, and
 * the way in that needs no instrumentation at all. The variable names come from the run rather than from a
 * list in this file, so they cannot drift from what was set.
 *
 * Which of those causes is worth printing depends on what the run was able to do. Orchescope now loads its
 * own instrumentation into a traced Node process, so a Node target that still collects nothing is a
 * different situation from a target the shim could never have reached, and the second one is the common
 * case: Cloudflare Workers, Python and anything in a container run somewhere `NODE_OPTIONS` does not go. In
 * the session that prompted this, a test suite spawned `wrangler dev` and the server under test ran in
 * workerd, so perfect Node instrumentation would have captured the client and missed the server entirely.
 */

const boundaryLines = (style: Style, receiverUrl: string): readonly string[] => [
  style.dim(
    '  This target is not a Node process, so the instrumentation Orchescope loads could not reach it.',
  ),
  style.dim(
    `  Point its own exporter at ${receiverUrl}, which is what a Python, container or Workers runtime needs: it speaks OTLP over HTTP on /v1/traces.`,
  ),
  style.dim(
    '  A command that starts a child in another runtime has the same boundary: the child is where the spans are, and it needs the endpoint too.',
  ),
];

const nodeTargetLines = (style: Style): readonly string[] => [
  style.dim(
    '  Orchescope loaded its own instrumentation into this process and nothing came back, so no outbound request it can see was made.',
  ),
  style.dim(
    '  Usually one of three things: the work happens in a child process or another runtime, the target loads its own OpenTelemetry SDK (which this stands down for) and that SDK exported over gRPC rather than HTTP, or the process exited before flushing.',
  ),
];

const uninstrumentedLines = (style: Style): readonly string[] => [
  style.dim(
    '  Usually one of three things: no OpenTelemetry SDK was loaded, the SDK exported over gRPC rather than HTTP, or the process exited before flushing.',
  ),
];

const causeLines = (
  style: Style,
  instrumentation: InstrumentationOutcome,
  receiverUrl: string,
): readonly string[] => {
  if (instrumentation.injected) return nodeTargetLines(style);
  if (instrumentation.reason === 'not_a_node_target') return boundaryLines(style, receiverUrl);
  return uninstrumentedLines(style);
};

export const noSpansLines = (
  style: Style,
  input: {
    readonly receiverUrl: string;
    readonly otlpVariables: readonly string[];
    readonly instrumentation: InstrumentationOutcome;
  },
): string =>
  [
    `${style.warn(SYMBOLS.warning)} No spans arrived, so this run produced no runtime evidence.`,
    style.dim(
      `  Orchescope listened on ${input.receiverUrl} and accepts OTLP over HTTP on /v1/traces, protobuf or JSON.`,
    ),
    ...(input.otlpVariables.length === 0
      ? []
      : [style.dim(`  It set ${input.otlpVariables.join(', ')} for the target process.`)]),
    ...causeLines(style, input.instrumentation, input.receiverUrl),
    style.dim(
      '  A system that emits nothing yet can still be reconciled: declare it in .orchescope/manifest.yaml, or import spans you already have with orchescope trace --import <file>.',
    ),
  ].join('\n');
