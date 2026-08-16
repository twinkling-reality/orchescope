import { AsyncLocalStorage } from 'node:async_hooks';
import type { AttributeValue, Exporter, SpanAttributes } from './exporter.ts';

/**
 * Span creation and the parent relation between spans.
 *
 * The parent relation is what makes a trace a tree rather than a list, and the tree is what the audit
 * reads: self time is total time minus the time spent in children, and two calls are called sequential
 * only when they are siblings of the same parent. So the current span travels through `AsyncLocalStorage`
 * rather than through an argument, which is the only way an automatic instrumentation can know that the
 * request a library just made happened inside the tool call a person wrote.
 *
 * Time and identity arrive as arguments. A test that supplies a fixed clock and a counted identifier gets
 * a byte identical trace, and nothing here reaches for the platform on its own.
 */

export type SpanHandle = {
  readonly traceId: string;
  readonly spanId: string;
  readonly set: (key: string, value: AttributeValue) => void;
  readonly addEvent: (name: string, attributes: SpanAttributes) => void;
  readonly end: (outcome: 'ok' | 'error', message?: string) => void;
};

export type StartSpan = {
  readonly name: string;
  readonly kind: number;
  readonly attributes?: SpanAttributes;
};

export type Tracer = {
  readonly start: (options: StartSpan) => SpanHandle;
  /** Runs `body` with `span` as the parent of everything it starts. */
  readonly within: <T>(span: SpanHandle, body: () => T) => T;
  readonly current: () => SpanHandle | undefined;
};

export type TracerOptions = {
  readonly exporter: Exporter;
  /** Nanoseconds since the Unix epoch. A string because a nanosecond epoch does not fit in a double. */
  readonly nowNanos: () => bigint;
  /** Lowercase hex of the requested byte length. */
  readonly identifier: (bytes: number) => string;
};

export const SPAN_KIND_INTERNAL = 1;
export const SPAN_KIND_CLIENT = 3;

const STATUS_OK = 1;
const STATUS_ERROR = 2;

export const createTracer = (options: TracerOptions): Tracer => {
  const active = new AsyncLocalStorage<SpanHandle>();

  const start = (span: StartSpan): SpanHandle => {
    const parent = active.getStore();
    const traceId = parent?.traceId ?? options.identifier(16);
    const spanId = options.identifier(8);
    const startTimeUnixNano = options.nowNanos().toString();
    const attributes: Record<string, AttributeValue> = { ...span.attributes };
    const events: {
      name: string;
      timeUnixNano: string;
      attributes: SpanAttributes;
    }[] = [];
    let closed = false;

    return {
      traceId,
      spanId,
      set: (key, value) => {
        attributes[key] = value;
      },
      addEvent: (name, eventAttributes) => {
        events.push({
          name,
          timeUnixNano: options.nowNanos().toString(),
          attributes: eventAttributes,
        });
      },
      end: (outcome, message) => {
        // Ending twice would report the same work as two executions, which moves every rate derived from it.
        if (closed) return;
        closed = true;
        options.exporter.record({
          traceId,
          spanId,
          parentSpanId: parent?.spanId ?? '',
          name: span.name,
          kind: span.kind,
          startTimeUnixNano,
          endTimeUnixNano: options.nowNanos().toString(),
          attributes,
          events,
          status:
            outcome === 'error'
              ? { code: STATUS_ERROR, ...(message === undefined ? {} : { message }) }
              : { code: STATUS_OK },
        });
      },
    };
  };

  return {
    start,
    within: (span, body) => active.run(span, body),
    current: () => active.getStore(),
  };
};
