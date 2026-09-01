import { estimateCostUsd } from "./pricing.ts";
import type { RunMetrics, TurnMetrics, ToolCallMetrics } from "./types.ts";

export class TelemetryCollector {
  private run: RunMetrics;
  private currentTurn?: TurnMetrics;
  private turnStart = 0;  // 一轮循环开始时间戳（毫秒）
  private modelStart = 0; // 调用大模型开始时间戳
  private toolStart = 0;  // 工具调用开始时间戳

  constructor(task: string, private model: string, sessionId?: string) {
    this.run = {
      sessionId,
      task,
      startTime: Date.now(),
      turns: [],
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      toolCallCount: 0,
      success: false,
    };
  }

  startTurn(round: number): void {
    this.turnStart = Date.now();
    this.currentTurn = {
      round,
      durationMs: 0,
      modelDurationMs: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      toolCalls: [],
    };
  }

  startModelCall(): void {
    this.modelStart = Date.now();
  }

  /** usage 来自 Provider 流式事件的最后一个 chunk，可能 undefined */
  endModelCall(usage?: { promptTokens: number; completionTokens: number; totalTokens: number }): void {
    if (!this.currentTurn) return;
    this.currentTurn.modelDurationMs = Date.now() - this.modelStart;
    if (usage) {
      this.currentTurn.promptTokens = usage.promptTokens;
      this.currentTurn.completionTokens = usage.completionTokens;
      this.currentTurn.totalTokens = usage.totalTokens;
    }
  }

  /** start 时先 push 占位记录（只有 name），end 时回填其余字段 */
  startToolCall(name: string): void {
    this.toolStart = Date.now();
    this.run.toolCallCount++;
    this.currentTurn?.toolCalls.push({
      name,
      durationMs: 0,
      ok: true,
      safetyDecision: "allow",
    });
  }

  endToolCall(ok: boolean, safetyDecision: "allow" | "ask" | "deny"): void {
    if (!this.currentTurn) return;
    const rec = this.currentTurn.toolCalls[this.currentTurn.toolCalls.length - 1];
    if (!rec) return;
    rec.durationMs = Date.now() - this.toolStart;
    rec.ok = ok;
    rec.safetyDecision = safetyDecision;
  }

  endTurn(): void {
    if (!this.currentTurn) return;
    this.currentTurn.durationMs = Date.now() - this.turnStart;
    this.run.turns.push(this.currentTurn);
    this.run.totalPromptTokens += this.currentTurn.promptTokens;
    this.run.totalCompletionTokens += this.currentTurn.completionTokens;
    this.run.totalTokens += this.currentTurn.totalTokens;
  }

  finish(success: boolean, error?: string): RunMetrics {
    this.run.endTime = Date.now();
    this.run.totalDurationMs = this.run.endTime - this.run.startTime;
    this.run.success = success;
    this.run.error = error;
    this.run.estimatedCostUsd = estimateCostUsd(
      this.model,
      this.run.totalPromptTokens,
      this.run.totalCompletionTokens,
    );
    return this.run;
  }

  getRun(): RunMetrics {
    return this.run;
  }
}