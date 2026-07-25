import { noteFault, type RequestContext } from './context.ts';
import { DemoFailure, sleep, sleepBounded, withDeadline } from './failures.ts';
import type { FaultDecision, FaultKind } from './faults.ts';
import { hashText, indexOf } from './random.ts';
import { ATTR, SPAN_KIND_CLIENT, type Span, sourceFile } from './telemetry.ts';

/**
 * The scripted model provider.
 *
 * There is no network call and no credential here: a reply is looked up in a fixed table keyed by the prompt
 * digest and the seed, so the same prompt in the same run always produces the same answer. Token counts are
 * derived from the real prompt and the real reply, which is what makes the token attributes usable as
 * evidence rather than decoration.
 *
 * GOOD ARCHITECTURE 8b: every model call runs under an explicit deadline and a bounded retry with
 * exponential backoff. The attempt number is on every span, so the retry is visible rather than implied.
 *
 * INTENTIONAL ISSUE 5: the fallback model is configured and only the third attempt uses it, so a healthy
 * run never exercises the fallback path at all.
 */

const site = sourceFile('apps/demo/src/model.ts');

const PROVIDER_NAME = 'orchescope-demo';
const MODEL_DEADLINE_MS = 60;
const MAX_MODEL_ATTEMPTS = 3;
const BACKOFF_MS: readonly number[] = [8, 16, 32];
const CHARS_PER_TOKEN = 4;

const MODEL_FAULTS: readonly FaultKind[] = [
  'model_timeout',
  'model_rate_limited',
  'model_server_error',
  'model_malformed_structured_output',
];

export type ModelPurpose = 'plan' | 'delegate' | 'aggregate' | 'answer';

export type ModelRequest = {
  readonly purpose: ModelPurpose;
  readonly prompt: string;
  /** Plan calls ask for a JSON object. A malformed answer is a recoverable condition, not a crash. */
  readonly structured: boolean;
};

export type ModelReply = {
  readonly model: string;
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly structured: Record<string, string> | undefined;
};

const SCRIPTS: Readonly<Record<ModelPurpose, readonly string[]>> = {
  plan: [
    '{"decision":"refund","steps":"lookup_account,check_inventory,search_policies","tone":"apologetic"}',
    '{"decision":"refund","steps":"lookup_account,check_inventory,search_policies","tone":"neutral"}',
    '{"decision":"replace","steps":"lookup_account,check_inventory,search_policies","tone":"neutral"}',
  ],
  delegate: [
    'Account is in good standing and the order is inside the refund window.',
    'Order qualifies for a refund; the warehouse can restock the returned unit.',
    'No blocking condition found; proceed with the refund the orchestrator planned.',
  ],
  aggregate: [
    'Worker findings agree: refund the order and notify the customer.',
    'Worker findings agree with one caveat about restock time; refund anyway.',
  ],
  answer: [
    'Your refund is approved and the amount will appear on your original payment method.',
    'Refund approved. You will receive a confirmation message shortly.',
    'Refund approved for the delayed order, and the replacement unit is back in stock.',
  ],
};

const tokensOf = (text: string): number => Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));

const faultFor = (
  context: RequestContext,
  model: string,
  attempt: number,
): FaultDecision | undefined => {
  for (const kind of MODEL_FAULTS) {
    const decision = context.faults.decide(kind, model, attempt);
    if (decision !== undefined) return decision;
  }
  return undefined;
};

const parseStructured = (text: string): Record<string, string> | undefined => {
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
  if (typeof payload !== 'object' || payload === null) return undefined;
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (typeof value === 'string') fields[key] = value;
  }
  return fields;
};

const scriptedReply = async (
  context: RequestContext,
  request: ModelRequest,
  fault: FaultDecision | undefined,
): Promise<string> => {
  if (fault?.kind === 'model_timeout') {
    await sleepBounded(Math.max(fault.delayMs, MODEL_DEADLINE_MS * 2));
  }
  if (fault?.kind === 'model_rate_limited') {
    throw new DemoFailure('rate_limited', 'the demo provider rejected the call with a rate limit');
  }
  if (fault?.kind === 'model_server_error') {
    throw new DemoFailure('failed', 'the demo provider answered with a server error');
  }
  // Yielding once keeps concurrent requests genuinely interleaved without introducing real latency.
  await sleep(0);
  const table = SCRIPTS[request.purpose];
  const chosen =
    table[indexOf(table.length, hashText(request.prompt), context.config.seed, request.purpose)] ??
    '';
  if (fault?.kind === 'model_malformed_structured_output') {
    return chosen.slice(0, Math.max(4, Math.floor(chosen.length / 3)));
  }
  return chosen;
};

const attemptCall = (
  context: RequestContext,
  parent: Span,
  agentName: string,
  request: ModelRequest,
  attempt: number,
  model: string,
): Promise<ModelReply> => {
  const inputTokens = tokensOf(request.prompt);
  return context.trace.run(
    {
      name: `chat ${model}`,
      kind: SPAN_KIND_CLIENT,
      site: site('attemptCall', 144),
      attributes: {
        [ATTR.operationName]: 'chat',
        [ATTR.providerName]: PROVIDER_NAME,
        [ATTR.requestModel]: model,
        [ATTR.agentName]: agentName,
        [ATTR.conversationId]: context.conversationId,
        [ATTR.inputTokens]: inputTokens,
        [ATTR.retryAttempt]: attempt,
      },
    },
    parent,
    async (span) => {
      const fault = faultFor(context, model, attempt);
      if (fault !== undefined) noteFault(span, fault);
      const text = await withDeadline(
        scriptedReply(context, request, fault),
        MODEL_DEADLINE_MS,
        `${model} exceeded its ${MODEL_DEADLINE_MS}ms deadline`,
      );
      const outputTokens = tokensOf(text);
      span.set(ATTR.responseModel, model);
      span.set(ATTR.outputTokens, outputTokens);
      return {
        model,
        text,
        inputTokens,
        outputTokens,
        structured: request.structured ? parseStructured(text) : undefined,
      };
    },
  );
};

export const callModel = async (
  context: RequestContext,
  parent: Span,
  agentName: string,
  request: ModelRequest,
): Promise<ModelReply> => {
  let failure = new DemoFailure('unavailable', 'the model was never reached');
  for (let attempt = 1; attempt <= MAX_MODEL_ATTEMPTS; attempt += 1) {
    // The fallback model is configured for the last attempt only, so a healthy run never reaches it.
    const model =
      attempt < MAX_MODEL_ATTEMPTS ? context.config.model : context.config.fallbackModel;
    try {
      return await attemptCall(context, parent, agentName, request, attempt, model);
    } catch (error) {
      if (!(error instanceof DemoFailure)) throw error;
      failure = error;
      await sleep(BACKOFF_MS[attempt - 1] ?? 32);
    }
  }
  throw failure;
};
