import type { RunMetrics } from "./types.ts";

export function formatMetrics(metrics: RunMetrics): string {
    const lines: string[] = [];
    const totalMs = metrics.totalDurationMs ?? 0;
    const turns = metrics.turns.length;
    const toolCallCount = metrics.toolCallCount;
    const successRate = toolCallCount
        ? (metrics.turns.flatMap((turn) => turn.toolCalls).filter((tc) => tc.ok).length / toolCallCount) * 100
        : "-";

    lines.push(`\n${metrics.success === false ? "✗" : "✓"} 运行报告`);
    if (metrics.sessionId) lines.push(`  session: ${metrics.sessionId}`);
    lines.push(`  耗时 ${(totalMs / 1000).toFixed(1)}s  ·  ${turns} 轮模型  ·  ${toolCallCount} 次工具  ·  成功率 ${successRate}`);
    lines.push(`  tokens  prompt: ${metrics.totalPromptTokens}  completion: ${metrics.totalCompletionTokens}  total: ${metrics.totalTokens}`);
    lines.push(`  估算成本 $${metrics.estimatedCostUsd.toFixed(4)}`);

    const allToolCalls = metrics.turns.flatMap((turn) => turn.toolCalls);
    if (allToolCalls.length) {
        const top3 = [...allToolCalls].sort((a, b) => b.durationMs - a.durationMs).slice(0, 3);
        lines.push(`  最慢工具:`);
        for(const tc of top3) {
            lines.push(`    ${(tc.durationMs / 1000).toFixed(2)}s  ${tc.name}  ${tc.ok ? "✓" : "✗"}  [${tc.safetyDecision}]`);
        }
    }

    if(metrics.turns.length >= 2) {
        const top3Turns = [...metrics.turns].sort((a, b) => b.durationMs - a.durationMs).slice(0, 3);
        lines.push(`  最慢轮次:`);
        for(const tc of top3Turns) {
             lines.push(`    round ${tc.round}  ${(tc.durationMs / 1000).toFixed(2)}s  model ${(tc.modelDurationMs / 1000).toFixed(2)}s  tools ${tc.toolCalls.length}`);
        }
    }

    if(metrics.error) {
        lines.push(`  运行失败: ${metrics.error}`);
    }
    return lines.join("\n");
}
