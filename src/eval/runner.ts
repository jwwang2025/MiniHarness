import { exec } from "node:child_process";
import { promisify } from "node:util";
import { runAgent } from "../agent/loop.ts";
import { estimateMessagesTokens } from "../agent/tokens.ts";
import { createProvider } from "../provider/index.ts";
import type { EvalTask, EvalResult, EvalReport } from "./types.ts";

const execP = promisify(exec);
const TIMEOUT_MS = 60_000;

// Provider 无状态，模块级创建一次即可
const provider = createProvider();

const PRICING: Record<string, number> = {
  "deepseek-chat": 0.14,
  "deepseek-reasoner": 0.55,
  "gpt-4o": 2.50,
  "gpt-4o-mini": 0.15,
};

export function estimateCost(tokens: number): number {
  return (tokens / 1_000_000) * (PRICING[provider.model] ?? 0);
}

async function verify(task: EvalTask, answer: string, workspace: string): Promise<boolean> {
    const v = task.verify;
    if (v.type === "contain") { 
        return answer.toLowerCase().includes(v.expected.toLowerCase());
    }
    if (v.type === "regex") {
        return new RegExp(v.pattern, "i").test(answer);
    }
    return execP(v.command, { cwd: workspace, timeout: TIMEOUT_MS })
    .then(() => true)
    .catch(() => false);
}

export async function runEvalTask(task: EvalTask, workspace: string): Promise<EvalResult> {
    const startTime = Date.now();
    await task.setup?.();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let rounds = 0;

    const result = await runAgent(task.description, provider, { workspace }, ctrl.signal, {
        safetyOptions: { autoApprove: true },
        onEvent: (e) => { if (e.type === "thinking") rounds = e.round + 1; },
    }).then(
        async (res) => {
        const finalTokens = estimateMessagesTokens(res.messages);
        const totalTokens = Math.round(finalTokens * Math.max(rounds, 1) * 0.7);
        const passed = await verify(task, res.answer, workspace);
        return {
            taskId: task.id,
            passed,
            answer: res.answer,
            rounds,
            tokens: totalTokens,
            cost: estimateCost(totalTokens),
            durationMs: Date.now() - startTime,
        } satisfies EvalResult;
    }).catch((e) => ({
        taskId: task.id,
        passed: false,
        answer: "",
        rounds,
        tokens: 0,
        cost: 0,
        durationMs: Date.now() - startTime,
        error: String(e),
        }),
    );

    clearTimeout(timer);
    await task.teardown?.();
    return result;
}

export function buildReport(results: EvalResult[]): EvalReport {
    const total = results.length;
    const passed = results.filter(r => r.passed).length;
    const passedRate = passed / total;
    const avgRounds = results.reduce((acc, r) => acc + r.rounds, 0) / Math.max(total, 1);
    const totalTokens = results.reduce((acc, r) => acc + r.tokens, 0);
    const totalCost = results.reduce((acc, r) => acc + r.cost, 0);
    const durationMs = results.reduce((acc, r) => acc + r.durationMs, 0);
    return {
        results,
        summary: {
            total,
            passed,
            passedRate,
            avgRounds,
            totalTokens,
            totalCost,
            durationMs,
        },
        createdAt: Date.now(),
    };
}
