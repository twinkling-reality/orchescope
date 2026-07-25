/**
 * Cost accounting.
 *
 * Orchescope ships no price table. Model prices change and a stale table would turn a measurement
 * into a wrong number, so cost is reported only when the trace carried it or when the user supplied
 * prices. Everything else is reported as token counts, which are measured.
 */

export type TokenPrice = {
  /** Price in USD per one million input tokens. */
  readonly inputPerMillion: number;
  /** Price in USD per one million output tokens. */
  readonly outputPerMillion: number;
};

/** Keyed by `provider/model`, for example `openai/gpt-4o-mini`. */
export type PriceTable = Readonly<Record<string, TokenPrice>>;

export type TokenUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
};

export type CostEstimate =
  | { readonly known: true; readonly costUsd: number; readonly priceKey: string }
  | { readonly known: false; readonly reason: string };

export const priceKey = (provider: string | undefined, model: string | undefined): string =>
  `${provider ?? 'unknown'}/${model ?? 'unknown'}`;

export const estimateCost = (
  prices: PriceTable,
  provider: string | undefined,
  model: string | undefined,
  usage: TokenUsage,
): CostEstimate => {
  const key = priceKey(provider, model);
  const price = prices[key];
  if (price === undefined) {
    return { known: false, reason: `no configured price for ${key}` };
  }
  const costUsd =
    (usage.inputTokens / 1_000_000) * price.inputPerMillion +
    (usage.outputTokens / 1_000_000) * price.outputPerMillion;
  return { known: true, costUsd, priceKey: key };
};

/** Sums only the costs that are actually known, and says how many were not. */
export const totalKnownCost = (
  estimates: readonly CostEstimate[],
): { readonly costUsd: number; readonly unknownCount: number } => {
  let costUsd = 0;
  let unknownCount = 0;
  for (const estimate of estimates) {
    if (estimate.known) costUsd += estimate.costUsd;
    else unknownCount += 1;
  }
  return { costUsd, unknownCount };
};
