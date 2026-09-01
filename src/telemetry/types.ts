export interface ToolCallMetrics {
  name: string;
  durationMs: number;
  ok: boolean;
  safetyDecision: "allow" | "ask" | "deny";
}

export interface TurnMetrics {
  round: number;
  durationMs: number;
  modelDurationMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  toolCalls: ToolCallMetrics[];
}

export interface RunMetrics {
  sessionId?: string;
  task: string;
  startTime: number;
  endTime?: number;
  totalDurationMs?: number;
  turns: TurnMetrics[];
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  toolCallCount: number;
  success: boolean;
  error?: string;
}