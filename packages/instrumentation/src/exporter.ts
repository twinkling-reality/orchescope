/**
 * An OTLP over HTTP JSON exporter with no dependencies, running inside somebody else's process.
 *
 * Three properties matter more than throughput here, and all three are about the host rather than about
 * the spans. It never throws, because a program must not fail on account of being watched. It never
 * writes to standard output or standard error, because those streams belong to the target and a reader
 * comparing two runs would see this instead of their own output. And its queue has a ceiling, because an
 * unbounded buffer inside a long running process is a leak with a good excuse.
 *
 * The wire details a stock JSON encoder gets wrong: identifiers are lowercase hex rather than base64,
 * kind and status are integers, and the nanosecond timestamps are decimal strings because a nanosecond
 * epoch does not fit in a double.
 */

export type AttributeValue = string | number | boolean;
export type SpanAttributes = Readonly<Record<string, AttributeValue>>;

export type FinishedSpan = {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string;
  readonly name: string;
  readonly kind: number;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly attributes: SpanAttributes;
  readonly events: readonly {
    readonly name: string;
    readonly timeUnixNano: string;
    readonly attributes: SpanAttributes;
  }[];
  readonly status: { readonly code: number; readonly message?: string };
};

export type Exporter = {
  readonly record: (span: FinishedSpan) => void;
  readonly flush: () => Promise<void>;
  /** Spans dropped because the ceiling was reached, so a run can say it was truncated. */
  readonly dropped: () => number;
};

export type ExporterOptions = {
  readonly endpoint: string;
  readonly serviceName: string;
  readonly maxSpans: number;
  /** The fetch captured before anything was patched, so exporting is never itself traced. */
  readonly send: typeof globalThis.fetch;
};

const BATCH_LIMIT = 256;
const EXPORT_TIMEOUT_MS = 2_000;

type OtlpAnyValue =
  | { readonly stringValue: string }
  | { readonly boolValue: boolean }
  | { readonly intValue: string }
  | { readonly doubleValue: number };

const anyValue = (value: AttributeValue): OtlpAnyValue => {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
};

const keyValues = (attributes: SpanAttributes) =>
  Object.entries(attributes).map(([key, value]) => ({ key, value: anyValue(value) }));

const wireSpan = (span: FinishedSpan) => ({
  traceId: span.traceId,
  spanId: span.spanId,
  parentSpanId: span.parentSpanId,
  name: span.name,
  kind: span.kind,
  startTimeUnixNano: span.startTimeUnixNano,
  endTimeUnixNano: span.endTimeUnixNano,
  attributes: keyValues(span.attributes),
  events: span.events.map((event) => ({
    name: event.name,
    timeUnixNano: event.timeUnixNano,
    attributes: keyValues(event.attributes),
  })),
  status: span.status,
});

export const createExporter = (options: ExporterOptions): Exporter => {
  let batch: FinishedSpan[] = [];
  let inFlight: Promise<void> = Promise.resolve();
  let recorded = 0;
  let dropped = 0;

  const post = async (spans: readonly FinishedSpan[]): Promise<void> => {
    if (spans.length === 0) return;
    const payload = {
      resourceSpans: [
        {
          resource: {
            attributes: [{ key: 'service.name', value: { stringValue: options.serviceName } }],
          },
          scopeSpans: [{ scope: { name: 'orchescope' }, spans: spans.map(wireSpan) }],
        },
      ],
    };
    try {
      const response = await options.send(`${options.endpoint}/v1/traces`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', connection: 'close' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS),
      });
      await response.text();
    } catch {
      /*
       * A target that failed because its exporter could not reach a collector would be reporting the
       * collector's health as its own. There is nowhere to put this that is not the target's own output,
       * so the run reports the shortfall instead: the receiver knows how many spans it received.
       */
    }
  };

  const enqueue = (): void => {
    if (batch.length === 0) return;
    const spans = batch;
    batch = [];
    inFlight = inFlight.then(() => post(spans));
  };

  return {
    record: (span) => {
      if (recorded >= options.maxSpans) {
        dropped += 1;
        return;
      }
      recorded += 1;
      batch.push(span);
      if (batch.length >= BATCH_LIMIT) enqueue();
    },
    flush: async () => {
      enqueue();
      await inFlight;
    },
    dropped: () => dropped,
  };
};
