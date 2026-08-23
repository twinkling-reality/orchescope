import { isTestFile, moduleNamespace } from '@orchescope/domain';
import type { ModuleFacts } from '@orchescope/source-analysis';
import { calleeName } from '@orchescope/source-analysis';
import { entryDeclaresKey } from './idempotency-key.ts';

/**
 * What the function performing an operation showed about repeating it.
 *
 * "No idempotency key was found on the operation" was true of every retry Orchescope reported, because
 * nothing ever looked: the field existed and no adapter populated it. One reported finding named a call
 * whose sink derives a content addressed delivery identifier and enforces it with `ON CONFLICT DO
 * NOTHING`, which is verbatim the remediation the finding then prescribed. Looking one frame in is the
 * difference between a rule that read the code and a rule that assumed the worst about it.
 *
 * The evidence is deliberately coarse. It cannot prove the key covers the retried operation, so it is
 * not used to declare the retry safe; it is used to stop the rules asserting an absence they never
 * checked.
 *
 * It is recorded per function, and reading it per module was a defect of its own. Any `maxAttempts`
 * anywhere in a file became attempt ceiling evidence for every retry in it, so a `const maxAttempts` in
 * an unrelated bounded poll suppressed the finding for an infinite retry against a payment endpoint
 * twenty four lines away. The rules were declining honestly and about the wrong function, and a reader
 * saw `clear` and an empty findings array.
 */
export type SinkEvidence = {
  readonly deduplicates: string | undefined;
  readonly ceiling: string | undefined;
};

export type SinkEvidenceIndex = ReadonlyMap<string, SinkEvidence>;

/**
 * The key a function is recorded under.
 *
 * A module namespace and a scope, because that is what both callers can produce: a call site knows the
 * function it sits in, and a name resolves to the module and function that define it. A fact written at
 * module scope belongs to the module and to no function in it, which is the point.
 */
export const sinkKey = (namespace: string, scope: string | undefined): string =>
  `${namespace}#${scope ?? ''}`;

const DEDUPLICATING_SQL = /\bon\s+conflict\b|\bon\s+duplicate\s+key\b|\bmerge\s+into\b/i;
const DEDUPLICATING_NAME = /idempot|dedup|deterministic/i;
/** How a repository spells an attempt ceiling, read both where it is declared and where it is tested. */
export const ATTEMPT_CEILING_NAME = /max_?(attempts|retries|tries)/i;

type Draft = { deduplicates?: string; ceiling?: string };

/**
 * The function a text sits in, which is not what a text records.
 *
 * A text belongs to the constant holding it, because that is what names a prompt, so a statement
 * assigned to `const statement` reports `statement` and not the function around it. One hop through the
 * definition of that name reaches the function, and the hop is taken only when the name is a value
 * rather than a scope: a name nothing else in the module is written inside is holding something, and a
 * name that other facts record as their own scope is a function and is already the answer.
 */
const functionAround = (module: ModuleFacts, holder: string | undefined): string | undefined => {
  if (holder === undefined) return undefined;
  const scopes = new Set<string | undefined>([
    ...module.calls.map((call) => call.enclosing),
    ...module.definitions.map((definition) => definition.enclosing),
    ...module.controlFlow.map((construct) => construct.enclosing),
  ]);
  if (scopes.has(holder)) return holder;
  return module.definitions.find(
    (definition) =>
      definition.name === holder ||
      (definition.enclosing !== undefined &&
        `${definition.enclosing}.${definition.name}` === holder),
  )?.enclosing;
};

const scopeIn = (drafts: Map<string | undefined, Draft>, scope: string | undefined): Draft => {
  const existing = drafts.get(scope);
  if (existing !== undefined) return existing;
  const created: Draft = {};
  drafts.set(scope, created);
  return created;
};

/**
 * Read in the order the evidence is worth stating. A statement that deduplicates on conflict says more
 * than a name that reads like a key derivation, which says more than an argument spelled like a key.
 */
const readModule = (module: ModuleFacts, drafts: Map<string | undefined, Draft>): void => {
  for (const text of module.texts) {
    if (!DEDUPLICATING_SQL.test(text.value)) continue;
    scopeIn(drafts, functionAround(module, text.enclosing)).deduplicates ??=
      'its statement deduplicates on conflict';
  }
  for (const call of module.calls) {
    const name = calleeName(call);
    if (!DEDUPLICATING_NAME.test(name)) continue;
    scopeIn(drafts, call.enclosing).deduplicates ??= `it derives a key with ${name}`;
  }
  for (const call of module.calls) {
    const keyed = call.args.some(
      (argument) => argument.kind === 'object' && entryDeclaresKey(argument.entries, 1),
    );
    if (!keyed) continue;
    scopeIn(drafts, call.enclosing).deduplicates ??= 'it sends an idempotency key';
  }
  /*
   * A constant is not proof that the retry honours it, so this stops the assertion rather than making
   * the opposite one: `no attempt limit could be established from the source` was reported about a
   * codebase that declares `const DELIVERY_MAX_ATTEMPTS = 6` and enforces it with a terminal status.
   */
  for (const definition of module.definitions) {
    if (!ATTEMPT_CEILING_NAME.test(definition.name)) continue;
    scopeIn(drafts, definition.enclosing).ceiling ??= `it declares ${definition.name}`;
  }
};

/**
 * Every function that showed something, across the repository.
 *
 * Read before anything is judged, because the sink of a retried operation is usually in a different
 * module from the retry, and a rule that asserts an absence has to have looked everywhere it could.
 * A test harness is skipped: what a fake shows about deduplicating describes the harness.
 */
export const readSinkEvidence = (modules: readonly ModuleFacts[]): SinkEvidenceIndex => {
  const index = new Map<string, SinkEvidence>();
  for (const module of modules) {
    if (isTestFile(module.file)) continue;
    const drafts = new Map<string | undefined, Draft>();
    readModule(module, drafts);
    const namespace = moduleNamespace(module.file);
    for (const [scope, draft] of drafts) {
      if (draft.deduplicates === undefined && draft.ceiling === undefined) continue;
      index.set(sinkKey(namespace, scope), {
        deduplicates: draft.deduplicates,
        ceiling: draft.ceiling,
      });
    }
  }
  return index;
};

/**
 * What the sink showed, carried on the relation so a rule can decline to assert what nobody established.
 *
 * The evidence is recorded rather than resolved into `idempotency: 'declared'`, because `declared` means
 * a key was found on the operation and a name that reads like a key derivation is not that. What it
 * supports is a refusal: the rules stop claiming an absence they never checked, and say how many they
 * left alone.
 */
export const sinkMetadata = (sink: SinkEvidence | undefined): Record<string, string> => ({
  ...(sink?.deduplicates === undefined ? {} : { deduplicatesAtSink: sink.deduplicates }),
  ...(sink?.ceiling === undefined ? {} : { attemptCeiling: sink.ceiling }),
});
