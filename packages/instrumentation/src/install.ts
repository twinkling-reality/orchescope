import { randomBytes } from 'node:crypto';
import { createExporter, type Exporter } from './exporter.ts';
import { patchMcpClient, type PatchOutcome } from './mcp-client.ts';
import { instrumentedFetch } from './outbound-fetch.ts';
import { writeReport } from './report-file.ts';
import { type InstrumentationSettings, readSettings } from './settings.ts';
import { createTracer, type Tracer } from './tracer.ts';

/**
 * Turning the shim on, inside a process that did not ask for it.
 *
 * The whole of this file is about restraint. It is loaded through `NODE_OPTIONS`, before the target's own
 * first line, into a program whose author has never heard of it, and the only acceptable outcome for a
 * program that is merely being watched is that it behaves exactly as it did before. So: nothing is patched
 * unless this run is the subject of a trace, nothing is patched if the target already runs OpenTelemetry,
 * nothing here writes to the target's output, no signal handler is registered, and every failure ends in
 * the shim switching itself off rather than in an exception crossing back into the host.
 *
 * Not registering a signal handler is a deliberate cost. Adding a `SIGTERM` listener stops Node exiting on
 * `SIGTERM` by default, which would change how the target shuts down, so a target killed by a signal loses
 * whatever has not been flushed. The periodic flush below is what bounds that loss.
 */

/** How often spans are pushed even when the batch is not full, so a long run is not one export at the end. */
const FLUSH_INTERVAL_MS = 1_000;

/** Where the OpenTelemetry JavaScript API registers itself, and therefore how to tell it is already here. */
const OTEL_GLOBAL = Symbol.for('opentelemetry.js.api.1');

export type Installation = {
  readonly settings: InstrumentationSettings;
  readonly tracer: Tracer;
  readonly exporter: Exporter;
  /** Settles before the target runs. What it patched, and what it declined to patch and why. */
  readonly patches: Promise<readonly PatchOutcome[]>;
  /** Restores everything this changed. Exists so a test can run twice in one process. */
  readonly uninstall: () => Promise<void>;
};

export type InstallOptions = {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly globals: {
    fetch: typeof globalThis.fetch;
    [key: symbol]: unknown;
  };
  readonly onBeforeExit: (listener: () => void) => void;
  readonly setInterval: (body: () => void, ms: number) => { readonly unref: () => void };
  /** The traced repository, which is where a package the target depends on is resolved from. */
  readonly directory: string;
  readonly nowNanos?: () => bigint;
  readonly identifier?: (bytes: number) => string;
  readonly loadModule?: (specifier: string) => Promise<readonly unknown[]>;
};

const platformNanos = (): bigint =>
  BigInt(Math.round(performance.timeOrigin + performance.now())) * 1_000_000n;

const platformIdentifier = (bytes: number): string => randomBytes(bytes).toString('hex');

/**
 * A target that already runs OpenTelemetry is already answering the question this shim exists to answer.
 *
 * Instrumenting on top of it would report every model call twice, which moves every count and every rate
 * derived from them. The target's own instrumentation is also better informed than this one: it knows the
 * names of things this can only see the shape of.
 */
export const alreadyInstrumented = (globals: { [key: symbol]: unknown }): boolean => {
  const registered = globals[OTEL_GLOBAL];
  return typeof registered === 'object' && registered !== null;
};

export const install = (options: InstallOptions): Installation | undefined => {
  const settings = readSettings(options.environment);
  if (settings === undefined) return undefined;
  if (alreadyInstrumented(options.globals)) return undefined;

  const original = options.globals.fetch;
  const exporter = createExporter({
    endpoint: settings.endpoint,
    serviceName: settings.serviceName,
    maxSpans: settings.maxSpans,
    send: original,
  });
  const tracer = createTracer({
    exporter,
    nowNanos: options.nowNanos ?? platformNanos,
    identifier: options.identifier ?? platformIdentifier,
  });

  options.globals.fetch = instrumentedFetch({
    tracer,
    original,
    receiverOrigin: new URL(settings.endpoint).origin,
  });

  const timer = options.setInterval(() => {
    void exporter.flush();
  }, FLUSH_INTERVAL_MS);
  timer.unref();

  options.onBeforeExit(() => {
    void exporter.flush();
  });

  return {
    settings,
    tracer,
    exporter,
    /*
     * The patches are awaited by the caller before the target's first line runs, which `--import` allows
     * because it settles the module it loads, top level await and all, before loading the entry point.
     */
    patches: patchMcpClient({
      tracer,
      directory: options.directory,
      ...(options.loadModule === undefined ? {} : { load: options.loadModule }),
    })
      .catch((error: unknown) => ({
        patched: false as const,
        target: 'instrumentation',
        reason: error instanceof Error ? error.message : 'the patch could not be attempted',
      }))
      .then((outcome) => {
        const patches = [outcome];
        writeReport(options.environment['ORCHESCOPE_RESULT_FILE'], { patches });
        return patches;
      }),
    uninstall: async () => {
      options.globals.fetch = original;
      await exporter.flush();
    },
  };
};
