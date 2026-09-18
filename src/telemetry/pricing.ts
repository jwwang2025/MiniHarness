export const PRICING: Record<string, { prompt: number; completion: number }> = {
  "deepseek-chat":     { prompt: 0.14, completion: 0.28 },
  "deepseek-reasoner": { prompt: 0.55, completion: 2.19 },
  "gpt-4o":            { prompt: 2.50, completion: 10.00 },
  "gpt-4o-mini":       { prompt: 0.15, completion: 0.60 },
};

export function estimateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const p = PRICING[model];
  if (!p) return 0;
  return (promptTokens * p.prompt + completionTokens * p.completion) / 1_000_000;
}

export function estimateTotalCostUsd(model: string, totalTokens: number): number {
  const p = PRICING[model];
  if (!p) return 0;
  return (totalTokens * p.completion) / 1_000_000;
}