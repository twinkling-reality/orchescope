import process from 'node:process';
import { hexOf, mix64 } from './random.ts';

/**
 * A zero dependency OTLP/HTTP JSON span exporter.
 *
 * Protocol details that a stock JSON encoder gets wrong and that are handled here: trace and span
 * identifiers are lowercase hex strings rather than base64, span kind and status code are integers, and
 * the nanosecond timestamps are decimal strings because a nanosecond epoch does not fit in a double.
 *
 * Identifiers and timestamps come from the seed rather than from the wall clock, so the exported trace of
 * a run is a function of its inputs alone. The virtual epoch below is a fixed origin: runs are compared by
 * structure, never by when they happened.
 */

const VIRTUAL_EPOCH_NANOS = 1_764_600_000_000_000_000n;
const BATCH_LIMIT = 256;
const EXPORT_TIMEOUT_MS = 2_000;

export const SPAN_KIND_INTERNAL = 1;
export const SPAN_KIND_CLIENT = 3;
export const SIDE_EFFECT_EVENT = 'orchescope.side_effect';

/**
 * The attribute vocabulary, mirrored by name from `packages/traces/src/attributes.ts`. This application is
 * an audit target and must not import Orchescope packages, so the names are duplicated here on purpose.
 */
export const ATTR = {
  operationName: 'gen_ai.operation.name',
  providerName: 'gen_ai.provider.name',
  requestModel: 'gen_ai.request.model',
  responseModel: 'gen_ai.response.model',
  inputTokens: 'gen_ai.usage.input_tokens',
  outputTokens: 'gen_ai.usage.output_tokens',
  agentName: 'gen_ai.agent.name',
  toolName: 'gen_ai.tool.name',
  toolType: 'gen_ai.tool.type',
  conversationId: 'gen_ai.conversation.id',
  dataSourceId: 'gen_ai.data_source.id',
  workflowName: 'gen_ai.workflow.name',
  codeFilePath: 'code.file.path',
  codeFunctionName: 'code.function.name',
  codeLineNumber: 'code.line.number',
  repositoryName: 'vcs.repository.name',
  component: 'orchescope.component',
  retryAttempt: 'orchescope.retry.attempt',
  taskSuccess: 'orchescope.task.success',
  taskOutput: 'orchescope.task.output',
  userIntervention: 'orchescope.user_intervention',
  policyViolation: 'orchescope.policy_violation',
  approvalGranted: 'orchescope.approval.granted',
  faultInjected: 'orchescope.fault.injected',
  queueWaitMs: 'orchescope.queue.wait_ms',
  sideEffectKind: 'orchescope.side_effect.kind',
  sideEffectTarget: 'orchescope.side_effect.target',
  sideEffectKey: 'orchescope.side_effect.idempotency_key',
  sideEffectOutcome: 'orchescope.side_effect.outcome',
} as const;

export type AttributeValue = string | number | boolean;
export type SpanAttributes = Readonly<Record<string, AttributeValue>>;

/** Where in this repository a span was opened, so a finding can be joined back to source. */
export type CodeSite = {
  readonly file: string;
  readonly functionName: string;
  readonly line: number;
};

export type SpanOptions = {
  readonly name: string;
  readonly kind: number;
  readonly site: CodeSite;
  readonly attributes?: SpanAttributes;
};

export type Span = {
  readonly traceId: string;
  readonly spanId: string;
  readonly set: (key: string, value: AttributeValue) => void;
  readonly addEvent: (name: string, attributes: SpanAttributes) => void;
  readonly end: (outcome: 'ok' | 'error', message?: string) => void;
};

export type Trace = {
  readonly traceId: string;
  readonly start: (options: SpanOptions, parent: Span | undefined) => Span;
  readonly run: <T>(
    options: SpanOptions,
    parent: Span | undefined,
    body: (span: Span) => Promise<T>,
  ) => Promise<T>;
};

type OtlpAnyValue =
  | { readonly stringValue: string }
  | { readonly boolValue: boolean }
  | { readonly intValue: string }
  | { readonly doubleValue: number };

type OtlpKeyValue = { readonly key: string; readonly value: OtlpAnyValue };

type OtlpEvent = {
  readonly name: string;
  readonly timeUnixNano: string;
  readonly attributes: readonly OtlpKeyValue[];
};

type OtlpSpan = {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string;
  readonly name: string;
  readonly kind: number;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly attributes: readonly OtlpKeyValue[];
  readonly events: readonly OtlpEvent[];
  readonly status: { readonly code: number; readonly message?: string };
};

const anyValue = (value: AttributeValue): OtlpAnyValue => {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
};

const keyValues = (attributes: SpanAttributes): readonly OtlpKeyValue[] =>
  Object.entries(attributes).map(([key, value]) => ({ key, value: anyValue(value) }));

let batch: OtlpSpan[] = [];
let exports: Promise<void> = Promise.resolve();

const endpointOf = (): string | undefined => {
  const value = process.env['ORCHESCOPE_OTLP_ENDPOINT'];
  return value === undefined || value.length === 0 ? undefined : value.replace(/\/+$/, '');
};

const send = async (spans: readonly OtlpSpan[]): Promise<void> => {
  const endpoint = endpointOf();
  if (endpoint === undefined || spans.length === 0) return;
  const payload = {
    resourceSpans: [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'orchescope-demo' } }],
        },
        scopeSpans: [{ scope: { name: 'orchescope-demo' }, spans }],
      },
    ],
  };
  try {
    const response = await fetch(`${endpoint}/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS),
    });
    await response.text();
  } catch {
    // A target that fails because its exporter could not reach a collector would report the collector's
    // health as its own. Export failures are dropped instead.
  }
};

const enqueueBatch = (): void => {
  const spans = batch;
  batch = [];
  exports = exports.then(() => send(spans));
};

const record = (span: OtlpSpan): void => {
  if (endpointOf() === undefined) return;
  batch.push(span);
  if (batch.length >= BATCH_LIMIT) enqueueBatch();
};

/** Awaits every in flight export. Called once before the process exits. */
export const flushTelemetry = async (): Promise<void> => {
  enqueueBatch();
  await exports;
};

/** Binds a repository relative file path so each module reports its own source location. */
export const sourceFile =
  (file: string) =>
  (functionName: string, line: number): CodeSite => ({ file, functionName, line });

export const createTrace = (seed: number, index: number): Trace => {
  const base = mix64(BigInt(seed) * 0x100000001n + BigInt(index));
  const traceId = `${hexOf(base, 16)}${hexOf(mix64(base ^ 0x5bf03635n), 16)}`;
  let counter = 0;
  let clock = VIRTUAL_EPOCH_NANOS + BigInt(index) * 1_000_000_000n;

  const tick = (): bigint => {
    counter += 1;
    clock += 200_000n + BigInt(counter % 9) * 50_000n;
    return clock;
  };

  const start = (options: SpanOptions, parent: Span | undefined): Span => {
    const spanId = hexOf(mix64(base ^ (BigInt(counter + 1) << 17n)), 16);
    const startTimeUnixNano = tick();
    const attributes: Record<string, AttributeValue> = {
      [ATTR.codeFilePath]: options.site.file,
      [ATTR.codeFunctionName]: options.site.functionName,
      [ATTR.codeLineNumber]: options.site.line,
      ...options.attributes,
    };
    const events: OtlpEvent[] = [];
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
          timeUnixNano: tick().toString(),
          attributes: keyValues(eventAttributes),
        });
      },
      end: (outcome, message) => {
        if (closed) return;
        closed = true;
        record({
          traceId,
          spanId,
          parentSpanId: parent?.spanId ?? '',
          name: options.name,
          kind: options.kind,
          startTimeUnixNano: startTimeUnixNano.toString(),
          endTimeUnixNano: tick().toString(),
          attributes: keyValues(attributes),
          events,
          status:
            outcome === 'error'
              ? { code: 2, ...(message === undefined ? {} : { message }) }
              : { code: 1 },
        });
      },
    };
  };

  return {
    traceId,
    start,
    run: async (options, parent, body) => {
      const span = start(options, parent);
      try {
        const value = await body(span);
        span.end('ok');
        return value;
      } catch (error) {
        span.end('error', error instanceof Error ? error.message : 'span body failed');
        throw error;
      }
    },
  };
};
