/**
 * 模型定价（$/1M tokens）—— prompt 和 completion 分开计价
 * 数据来源：各厂商官方定价页
 */
export const PRICING: Record<string, { prompt: number; completion: number }> = {
  "deepseek-chat":     { prompt: 0.14, completion: 0.28 },
  "deepseek-reasoner": { prompt: 0.55, completion: 2.19 },
  "gpt-4o":            { prompt: 2.50, completion: 10.00 },
  "gpt-4o-mini":       { prompt: 0.15, completion: 0.60 },
};

/**
 * 精确成本计算（基于 Provider 返回的 usage）
 */
export function estimateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const p = PRICING[model];
  if (!p) return 0;
  return (promptTokens * p.prompt + completionTokens * p.completion) / 1_000_000;
}

/**
 * token 估算成本（无 usage 时兜底，用于 eval runner 等非精确场景）
 */
export function estimateTotalCostUsd(model: string, totalTokens: number): number {
  const p = PRICING[model];
  if (!p) return 0;
  // 按 completion 价算最保守（贵的那头）
  return (totalTokens * p.completion) / 1_000_000;
}