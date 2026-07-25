import { OrchescopeError } from '@orchescope/domain';
import type { BenchmarkDimension, ScenarioVariant } from '@orchescope/schema';

/**
 * Variant construction for one benchmark dimension.
 *
 * A benchmark varies exactly one dimension. Varying the agent count and the traffic concurrency in the same
 * experiment produces a number that cannot be attributed to either, so the dimension is named and every
 * variant differs from its siblings in that one field only.
 *
 * `git_ref` has no field on a variant because a variant cannot check out a commit. The value is recorded as
 * `ORCHESCOPE_GIT_REF` so the target and the report both see which reference was measured; moving the
 * working tree to that reference remains the caller's job.
 */

const MAX_COUNT = 1024;
const MAX_VALUES = 32;
const GIT_REF_ENV = 'ORCHESCOPE_GIT_REF';

const reject = (message: string, detail: Record<string, string | number>): never => {
  throw new OrchescopeError('INVALID_ARGUMENT', message, {
    detail,
    remediation: 'Pass dimension values as a comma separated list, for example 1,2,4,8.',
  });
};

const positiveInteger = (dimension: BenchmarkDimension, value: number | string): number => {
  const parsed = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_COUNT) {
    return reject(
      `Dimension ${dimension} needs a whole number from 1 to ${MAX_COUNT}, received ${String(value)}.`,
      { dimension, value: String(value) },
    );
  }
  return parsed;
};

const nonEmptyText = (dimension: BenchmarkDimension, value: number | string): string => {
  const text = String(value).trim();
  if (text.length === 0) {
    return reject(`Dimension ${dimension} needs a non empty value.`, { dimension });
  }
  return text;
};

const modelOf = (value: number | string): { provider: string; model: string } => {
  const text = nonEmptyText('model_config', value);
  const separator = text.indexOf('/');
  const provider = text.slice(0, separator);
  const model = text.slice(separator + 1);
  if (separator <= 0 || model.length === 0) {
    return reject(
      'A model_config value is written as provider/model, for example openai/gpt-4o-mini.',
      { value: text },
    );
  }
  return { provider, model };
};

type VariantFields = Omit<ScenarioVariant, 'id'>;

const FIELD_BUILDERS: Readonly<
  Record<BenchmarkDimension, (value: number | string) => VariantFields>
> = {
  agent_count: (value) => ({ agents: positiveInteger('agent_count', value) }),
  worker_count: (value) => ({ workers: positiveInteger('worker_count', value) }),
  traffic_concurrency: (value) => ({ concurrency: positiveInteger('traffic_concurrency', value) }),
  topology: (value) => ({ topology: nonEmptyText('topology', value) }),
  model_config: (value) => ({ model: modelOf(value) }),
  prompt_version: (value) => ({ promptVersion: nonEmptyText('prompt_version', value) }),
  tool_config: (value) => ({ toolConfig: nonEmptyText('tool_config', value) }),
  git_ref: (value) => ({ env: { [GIT_REF_ENV]: nonEmptyText('git_ref', value) } }),
};

const variantId = (
  dimension: BenchmarkDimension,
  value: number | string,
  baseId: string | undefined,
): string => {
  const label = `${dimension}=${String(value).trim()}`;
  return baseId === undefined ? label : `${baseId}/${label}`;
};

export const buildVariants = (input: {
  readonly dimension: BenchmarkDimension;
  readonly values: readonly (number | string)[];
  readonly base?: ScenarioVariant;
}): readonly ScenarioVariant[] => {
  const build = FIELD_BUILDERS[input.dimension];
  return input.values.map((value) => {
    const fields = build(value);
    const env = { ...(input.base?.env ?? {}), ...(fields.env ?? {}) };
    return {
      ...(input.base ?? {}),
      ...fields,
      id: variantId(input.dimension, value, input.base?.id),
      ...(Object.keys(env).length === 0 ? {} : { env }),
    };
  });
};

/**
 * Parses the comma separated numeric values of a counted dimension. Bounds are checked here rather than at
 * the first spawn, so a mistyped value fails before any process starts.
 */
export const parseDimensionValues = (raw: string): readonly number[] => {
  const parts = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    return reject('A benchmark dimension needs at least one value.', {
      received: raw.slice(0, 100),
    });
  }
  if (parts.length > MAX_VALUES) {
    return reject(`A benchmark takes at most ${MAX_VALUES} values, received ${parts.length}.`, {
      count: parts.length,
    });
  }
  const values: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      reject(`"${part}" is not a whole number.`, { value: part });
    }
    const value = Number(part);
    if (value < 1 || value > MAX_COUNT) {
      reject(`${value} is outside the supported range of 1 to ${MAX_COUNT}.`, { value });
    }
    if (values.includes(value)) {
      reject(`${value} appears more than once, so two variants would be identical.`, { value });
    }
    values.push(value);
  }
  return values;
};
