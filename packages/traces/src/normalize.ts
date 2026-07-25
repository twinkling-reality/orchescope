import type {
  MetadataValue,
  NormalizedSpan,
  SideEffectRecord,
  TraceBundle,
  TraceSource,
} from '@orchescope/schema';
import {
  type Attributes,
  ORCHESCOPE,
  classifyOperation,
  observedNameFor,
  readNumber,
  readString,
} from './attributes.ts';
import type { DecodedTraceRequest, RawSpan } from './otlp.ts';

/**
 * Span normalisation.
 *
 * Nanosecond timestamps are kept as strings because a nanosecond epoch does not fit in a double, and the
 * duration is computed once with BigInt arithmetic. Attribute values are truncated to a configured budget
 * so that a single enormous prompt cannot make a trace bundle unusable, and the truncation is recorded.
 */

export type NormalizeOptions = {
  readonly runId: string;
  readonly capturedAt: string;
  readonly source: TraceSource;
  readonly maxSpans: number;
  readonly maxAttributeBytes: number;
};

export type NormalizedResult = {
  readonly bundle: TraceBundle;
  /** Span identifier to the service that reported it, used when attributing spans across processes. */
  readonly serviceBySpanId: ReadonlyMap<string, string>;
};

const NANOS_PER_MS = 1_000_000n;

const durationMs = (start: string, end: string): number => {
  try {
    const from = BigInt(start);
    const to = BigInt(end);
    if (to <= from) return 0;
    const delta = to - from;
    const whole = delta / NANOS_PER_MS;
    const remainder = delta % NANOS_PER_MS;
    return Number(whole) + Number(remainder) / 1_000_000;
  } catch {
    return 0;
  }
};

const truncateValue = (value: MetadataValue, maxBytes: number): MetadataValue => {
  if (typeof value === 'string' && value.length > maxBytes) {
    return `${value.slice(0, maxBytes)}[truncated]`;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 64).map((item) =>
      typeof item === 'string' && item.length > maxBytes ? `${item.slice(0, maxBytes)}[truncated]` : item,
    );
  }
  return value;
};

const boundAttributes = (attributes: Attributes, maxBytes: number): Attributes => {
  const bounded: Record<string, MetadataValue> = {};
  for (const [key, value] of Object.entries(attributes)) {
    bounded[key] = truncateValue(value, maxBytes);
  }
  return bounded;
};

const sideEffectsFrom = (span: RawSpan): readonly SideEffectRecord[] => {
  const records: SideEffectRecord[] = [];
  for (const event of span.events) {
    if (event.name !== ORCHESCOPE.sideEffectEvent) continue;
    const kind = readString(event.attributes, ORCHESCOPE.sideEffectKind, 'kind');
    const target = readString(event.attributes, ORCHESCOPE.sideEffectTarget, 'target');
    if (kind === undefined || target === undefined) continue;
    const key = readString(event.attributes, ORCHESCOPE.sideEffectKey, 'idempotency_key');
    const outcome = readString(event.attributes, ORCHESCOPE.sideEffectOutcome, 'outcome');
    const attempt = readNumber(span.attributes, ORCHESCOPE.retryAttempt);
    records.push({
      kind,
      target,
      ...(key === undefined ? {} : { idempotencyKey: key }),
      traceId: span.traceId,
      spanId: span.spanId,
      spanName: span.name,
      outcome:
        outcome === 'succeeded' || outcome === 'failed' || outcome === 'partial' ? outcome : 'unknown',
      ...(attempt === undefined ? {} : { retryAttempt: attempt }),
      timeUnixNano: event.timeUnixNano,
    });
  }
  return records;
};

export const normalizeTraces = (
  decoded: DecodedTraceRequest,
  options: NormalizeOptions,
): NormalizedResult => {
  const spans: NormalizedSpan[] = [];
  const sideEffects: SideEffectRecord[] = [];
  const services = new Set<string>();
  const serviceBySpanId = new Map<string, string>();
  const rejected: { reason: string; count: number }[] = [...decoded.rejected];
  let dropped = 0;

  for (const resourceSpans of decoded.resourceSpans) {
    const serviceName =
      readString(resourceSpans.resourceAttributes, 'service.name') ?? 'unknown_service';
    services.add(serviceName);

    for (const scopeSpans of resourceSpans.scopeSpans) {
      for (const raw of scopeSpans.spans) {
        if (spans.length >= options.maxSpans) {
          dropped += 1;
          continue;
        }
        if (raw.traceId.length !== 32 || raw.spanId.length !== 16) {
          rejected.push({ reason: 'span identifier had the wrong length', count: 1 });
          continue;
        }
        const attributes = boundAttributes(raw.attributes, options.maxAttributeBytes);
        const operation = classifyOperation(raw.name, attributes);
        const retryAttempt = readNumber(attributes, ORCHESCOPE.retryAttempt);
        const span: NormalizedSpan = {
          traceId: raw.traceId,
          spanId: raw.spanId,
          ...(raw.parentSpanId === undefined ? {} : { parentSpanId: raw.parentSpanId }),
          name: raw.name.length === 0 ? 'unnamed' : raw.name,
          kind: raw.kind,
          operation,
          startTimeUnixNano: raw.startTimeUnixNano,
          endTimeUnixNano: raw.endTimeUnixNano,
          durationMs: durationMs(raw.startTimeUnixNano, raw.endTimeUnixNano),
          status: raw.status,
          ...(raw.statusMessage === undefined ? {} : { statusMessage: raw.statusMessage.slice(0, 1000) }),
          attributes,
          events: raw.events.map((event) => ({
            name: event.name,
            timeUnixNano: event.timeUnixNano,
            attributes: boundAttributes(event.attributes, options.maxAttributeBytes),
          })),
          serviceName,
          ...(scopeSpans.scopeName === undefined ? {} : { scopeName: scopeSpans.scopeName }),
          ...(retryAttempt === undefined ? {} : { retryAttempt }),
        };
        spans.push(span);
        serviceBySpanId.set(span.spanId, serviceName);
        sideEffects.push(...sideEffectsFrom(raw));
        void observedNameFor(operation, span.name, attributes);
      }
    }
  }

  const bundle: TraceBundle = {
    schemaVersion: 1,
    runId: options.runId,
    capturedAt: options.capturedAt,
    source: options.source,
    services: [...services],
    spans,
    sideEffects,
    droppedSpanCount: dropped,
    rejected,
    metadata: {},
  };

  return { bundle, serviceBySpanId };
};

/** Merges bundles captured from several exports in one run into a single bundle. */
export const mergeBundles = (bundles: readonly TraceBundle[], runId: string): TraceBundle => {
  const first = bundles[0];
  if (first === undefined) {
    throw new Error('mergeBundles requires at least one bundle');
  }
  const seen = new Set<string>();
  const spans: NormalizedSpan[] = [];
  for (const bundle of bundles) {
    for (const span of bundle.spans) {
      const key = `${span.traceId}:${span.spanId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      spans.push(span);
    }
  }
  const rejected = new Map<string, number>();
  for (const bundle of bundles) {
    for (const entry of bundle.rejected) {
      rejected.set(entry.reason, (rejected.get(entry.reason) ?? 0) + entry.count);
    }
  }
  return {
    schemaVersion: 1,
    runId,
    capturedAt: first.capturedAt,
    source: first.source,
    services: [...new Set(bundles.flatMap((bundle) => bundle.services))],
    spans,
    sideEffects: bundles.flatMap((bundle) => bundle.sideEffects),
    droppedSpanCount: bundles.reduce((total, bundle) => total + bundle.droppedSpanCount, 0),
    rejected: [...rejected].map(([reason, count]) => ({ reason, count })),
    metadata: {},
  };
};
