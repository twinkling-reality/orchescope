import type { MetadataValue, SpanKind, SpanStatus } from '@orchescope/schema';
import {
  type FieldValue,
  asBigInt,
  asBytes,
  asNumber,
  asString,
  decodeDouble,
  eachField,
  toHex,
} from './protobuf.ts';

/**
 * OTLP decoding for both encodings the OpenTelemetry SDKs send.
 *
 * Field numbers follow opentelemetry-proto `trace/v1/trace.proto` and `common/v1/common.proto`. The JSON
 * form deviates from canonical ProtoJSON in three ways that a stock decoder gets wrong, and all three are
 * handled here: trace and span identifiers are lowercase hex strings rather than base64, enum values are
 * integers, and 64 bit integers are decimal strings on the wire while a reader must also accept numbers.
 * Unknown fields are ignored in both encodings, as the specification requires.
 */

export type RawSpan = {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | undefined;
  readonly name: string;
  readonly kind: SpanKind;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly status: SpanStatus;
  readonly statusMessage: string | undefined;
  readonly attributes: Readonly<Record<string, MetadataValue>>;
  readonly events: readonly {
    readonly name: string;
    readonly timeUnixNano: string;
    readonly attributes: Readonly<Record<string, MetadataValue>>;
  }[];
};

export type RawScopeSpans = {
  readonly scopeName: string | undefined;
  readonly spans: readonly RawSpan[];
};

export type RawResourceSpans = {
  readonly resourceAttributes: Readonly<Record<string, MetadataValue>>;
  readonly scopeSpans: readonly RawScopeSpans[];
};

export type DecodedTraceRequest = {
  readonly resourceSpans: readonly RawResourceSpans[];
  /** Problems that did not stop decoding, reported back through OTLP partial success. */
  readonly rejected: readonly { readonly reason: string; readonly count: number }[];
};

const SPAN_KINDS: readonly SpanKind[] = [
  'unspecified',
  'internal',
  'server',
  'client',
  'producer',
  'consumer',
];

const spanKindOf = (value: number): SpanKind => SPAN_KINDS[value] ?? 'unspecified';

const statusOf = (value: number): SpanStatus =>
  value === 1 ? 'ok' : value === 2 ? 'error' : 'unset';

/** common.v1.AnyValue */
const decodeAnyValue = (bytes: Uint8Array): MetadataValue => {
  let result: MetadataValue = '';
  eachField(bytes, (field, value) => {
    switch (field) {
      case 1:
        result = asString(value);
        break;
      case 2:
        result = asNumber(value) !== 0;
        break;
      case 3:
        result = Number(asBigInt(value));
        break;
      case 4:
        result = value.wire === 1 ? decodeDouble(value.value) : Number(asBigInt(value));
        break;
      case 5: {
        const items: (string | number | boolean)[] = [];
        eachField(asBytes(value), (innerField, innerValue) => {
          if (innerField !== 1) return;
          const item = decodeAnyValue(asBytes(innerValue));
          if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
            items.push(item);
          }
        });
        result = items;
        break;
      }
      case 7:
        result = toHex(asBytes(value));
        break;
      default:
        break;
    }
  });
  return result;
};

/** common.v1.KeyValue */
const decodeKeyValue = (
  bytes: Uint8Array,
): { readonly key: string; readonly value: MetadataValue } => {
  let key = '';
  let value: MetadataValue = '';
  eachField(bytes, (field, entry) => {
    if (field === 1) key = asString(entry);
    else if (field === 2) value = decodeAnyValue(asBytes(entry));
  });
  return { key, value };
};

const decodeAttributes = (
  entries: readonly Uint8Array[],
): Readonly<Record<string, MetadataValue>> => {
  const attributes: Record<string, MetadataValue> = {};
  for (const entry of entries) {
    const pair = decodeKeyValue(entry);
    if (pair.key.length > 0) attributes[pair.key] = pair.value;
  }
  return attributes;
};

const decodeEvent = (bytes: Uint8Array): RawSpan['events'][number] => {
  let name = '';
  let timeUnixNano = '0';
  const attributeBytes: Uint8Array[] = [];
  eachField(bytes, (field, value) => {
    if (field === 1) timeUnixNano = asBigInt(value).toString();
    else if (field === 2) name = asString(value);
    else if (field === 3) attributeBytes.push(asBytes(value));
  });
  return { name, timeUnixNano, attributes: decodeAttributes(attributeBytes) };
};

const decodeSpan = (bytes: Uint8Array): RawSpan => {
  let traceId = '';
  let spanId = '';
  let parentSpanId: string | undefined;
  let name = '';
  let kind: SpanKind = 'unspecified';
  let startTimeUnixNano = '0';
  let endTimeUnixNano = '0';
  let status: SpanStatus = 'unset';
  let statusMessage: string | undefined;
  const attributeBytes: Uint8Array[] = [];
  const events: RawSpan['events'][number][] = [];

  eachField(bytes, (field, value) => {
    switch (field) {
      case 1:
        traceId = toHex(asBytes(value));
        break;
      case 2:
        spanId = toHex(asBytes(value));
        break;
      case 4: {
        const parent = toHex(asBytes(value));
        parentSpanId = parent.length === 0 ? undefined : parent;
        break;
      }
      case 5:
        name = asString(value);
        break;
      case 6:
        kind = spanKindOf(Number(asBigInt(value)));
        break;
      case 7:
        startTimeUnixNano = asBigInt(value).toString();
        break;
      case 8:
        endTimeUnixNano = asBigInt(value).toString();
        break;
      case 9:
        attributeBytes.push(asBytes(value));
        break;
      case 11:
        events.push(decodeEvent(asBytes(value)));
        break;
      case 15:
        eachField(asBytes(value), (statusField, statusValue) => {
          if (statusField === 2) statusMessage = asString(statusValue);
          else if (statusField === 3) status = statusOf(Number(asBigInt(statusValue)));
        });
        break;
      default:
        break;
    }
  });

  return {
    traceId,
    spanId,
    parentSpanId,
    name,
    kind,
    startTimeUnixNano,
    endTimeUnixNano,
    status,
    statusMessage,
    attributes: decodeAttributes(attributeBytes),
    events,
  };
};

const decodeScopeSpans = (bytes: Uint8Array): RawScopeSpans => {
  let scopeName: string | undefined;
  const spans: RawSpan[] = [];
  eachField(bytes, (field, value) => {
    if (field === 1) {
      eachField(asBytes(value), (scopeField, scopeValue) => {
        if (scopeField === 1) scopeName = asString(scopeValue);
      });
    } else if (field === 2) {
      spans.push(decodeSpan(asBytes(value)));
    }
  });
  return { scopeName, spans };
};

const decodeResourceSpans = (bytes: Uint8Array): RawResourceSpans => {
  const attributeBytes: Uint8Array[] = [];
  const scopeSpans: RawScopeSpans[] = [];
  eachField(bytes, (field, value) => {
    if (field === 1) {
      eachField(asBytes(value), (resourceField, resourceValue) => {
        if (resourceField === 1) attributeBytes.push(asBytes(resourceValue));
      });
    } else if (field === 2) {
      scopeSpans.push(decodeScopeSpans(asBytes(value)));
    }
  });
  return { resourceAttributes: decodeAttributes(attributeBytes), scopeSpans };
};

export const decodeTraceProtobuf = (bytes: Uint8Array): DecodedTraceRequest => {
  const resourceSpans: RawResourceSpans[] = [];
  eachField(bytes, (field, value) => {
    if (field === 1) resourceSpans.push(decodeResourceSpans(asBytes(value)));
  });
  return { resourceSpans, rejected: [] };
};

const jsonAnyValue = (value: unknown): MetadataValue => {
  if (typeof value !== 'object' || value === null) return '';
  const record = value as Record<string, unknown>;
  if (typeof record['stringValue'] === 'string') return record['stringValue'];
  if (typeof record['boolValue'] === 'boolean') return record['boolValue'];
  if (record['intValue'] !== undefined) return Number(record['intValue']);
  if (record['doubleValue'] !== undefined) return Number(record['doubleValue']);
  if (typeof record['bytesValue'] === 'string') return record['bytesValue'];
  const array = record['arrayValue'];
  if (typeof array === 'object' && array !== null) {
    const values = (array as { values?: unknown }).values;
    if (Array.isArray(values)) {
      const items: (string | number | boolean)[] = [];
      for (const item of values) {
        const decoded = jsonAnyValue(item);
        if (
          typeof decoded === 'string' ||
          typeof decoded === 'number' ||
          typeof decoded === 'boolean'
        ) {
          items.push(decoded);
        }
      }
      return items;
    }
  }
  return '';
};

const jsonAttributes = (value: unknown): Readonly<Record<string, MetadataValue>> => {
  if (!Array.isArray(value)) return {};
  const attributes: Record<string, MetadataValue> = {};
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const key = record['key'];
    if (typeof key !== 'string' || key.length === 0) continue;
    attributes[key] = jsonAnyValue(record['value']);
  }
  return attributes;
};

/** OTLP/JSON encodes 64 bit integers as decimal strings, and readers must also accept numbers. */
const jsonNanos = (value: unknown): string => {
  if (typeof value === 'string' && /^\d+$/.test(value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value).toString();
  return '0';
};

const jsonIdentifier = (value: unknown): string =>
  typeof value === 'string' ? value.toLowerCase() : '';

const jsonSpan = (value: unknown): RawSpan | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const traceId = jsonIdentifier(record['traceId']);
  const spanId = jsonIdentifier(record['spanId']);
  if (traceId.length === 0 || spanId.length === 0) return undefined;
  const parent = jsonIdentifier(record['parentSpanId']);
  const statusRecord = record['status'];
  const statusCode =
    typeof statusRecord === 'object' && statusRecord !== null
      ? Number((statusRecord as Record<string, unknown>)['code'] ?? 0)
      : 0;
  const statusMessage =
    typeof statusRecord === 'object' && statusRecord !== null
      ? (statusRecord as Record<string, unknown>)['message']
      : undefined;

  const events: RawSpan['events'][number][] = [];
  if (Array.isArray(record['events'])) {
    for (const entry of record['events']) {
      if (typeof entry !== 'object' || entry === null) continue;
      const eventRecord = entry as Record<string, unknown>;
      events.push({
        name: typeof eventRecord['name'] === 'string' ? eventRecord['name'] : '',
        timeUnixNano: jsonNanos(eventRecord['timeUnixNano']),
        attributes: jsonAttributes(eventRecord['attributes']),
      });
    }
  }

  return {
    traceId,
    spanId,
    parentSpanId: parent.length === 0 ? undefined : parent,
    name: typeof record['name'] === 'string' ? record['name'] : '',
    kind: spanKindOf(Number(record['kind'] ?? 0)),
    startTimeUnixNano: jsonNanos(record['startTimeUnixNano']),
    endTimeUnixNano: jsonNanos(record['endTimeUnixNano']),
    status: statusOf(statusCode),
    statusMessage: typeof statusMessage === 'string' ? statusMessage : undefined,
    attributes: jsonAttributes(record['attributes']),
    events,
  };
};

export const decodeTraceJson = (payload: unknown): DecodedTraceRequest => {
  const rejected: { reason: string; count: number }[] = [];
  const resourceSpans: RawResourceSpans[] = [];
  const root = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
  const list = root['resourceSpans'];
  if (!Array.isArray(list)) {
    return { resourceSpans: [], rejected: [{ reason: 'resourceSpans was missing or not an array', count: 1 }] };
  }
  let malformed = 0;
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) {
      malformed += 1;
      continue;
    }
    const record = entry as Record<string, unknown>;
    const resource = record['resource'];
    const resourceAttributes =
      typeof resource === 'object' && resource !== null
        ? jsonAttributes((resource as Record<string, unknown>)['attributes'])
        : {};
    const scopeSpans: RawScopeSpans[] = [];
    const scopes = record['scopeSpans'];
    if (Array.isArray(scopes)) {
      for (const scope of scopes) {
        if (typeof scope !== 'object' || scope === null) {
          malformed += 1;
          continue;
        }
        const scopeRecord = scope as Record<string, unknown>;
        const scopeInfo = scopeRecord['scope'];
        const scopeName =
          typeof scopeInfo === 'object' && scopeInfo !== null
            ? (scopeInfo as Record<string, unknown>)['name']
            : undefined;
        const spans: RawSpan[] = [];
        if (Array.isArray(scopeRecord['spans'])) {
          for (const span of scopeRecord['spans']) {
            const decoded = jsonSpan(span);
            if (decoded === undefined) malformed += 1;
            else spans.push(decoded);
          }
        }
        scopeSpans.push({
          scopeName: typeof scopeName === 'string' ? scopeName : undefined,
          spans,
        });
      }
    }
    resourceSpans.push({ resourceAttributes, scopeSpans });
  }
  if (malformed > 0) {
    rejected.push({ reason: 'spans missing a trace or span identifier', count: malformed });
  }
  return { resourceSpans, rejected };
};

export type { FieldValue };
