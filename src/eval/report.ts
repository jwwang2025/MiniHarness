import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { EvalReport } from "./types.ts";

const BASELINE_PATH = ".anvil/eval-baseline.json";

export async function loadBaseline(): Promise<EvalReport | null> {
    const data = await readFile(BASELINE_PATH, "utf-8");
    return JSON.parse(data) as EvalReport;
}

export async function saveBaseline(report: EvalReport): Promise<void> {
    await mkdir(dirname(BASELINE_PATH), { recursive: true });
    await writeFile(BASELINE_PATH, JSON.stringify(report, null, 2), "utf-8");
}
export async function compareWithBaseline(report: EvalReport, baseline: EvalReport): EvalReport {
    const prevPass = new Set(baseline.results.filter((r) => r.passed).map((r) => r.taskId));
    const currPass = new Set(report.results.filter((r) => r.passed).map((r) => r.taskId));
    return {
        ...report,
        baseline: {
            passRate: report.summary.passedRate,
            regressions: [...prevPass].filter((id) => !currPass.has(id)),
            improvements: [...currPass].filter((id) => !prevPass.has(id)),
        },
    };
}

export function formatReport(report: EvalReport): string {
    const lines: string[] = [
        "=== Eval Report ===",
        `通过率: ${report.summary.passed}/${report.summary.total} (${(report.summary.passedRate * 100).toFixed(1)}%)`,
        `平均轮数: ${report.summary.avgRounds.toFixed(1)}`,
        `总 token: ${report.summary.totalTokens}`,
        `总成本: $${report.summary.totalCost.toFixed(4)}`,
        `耗时: ${(report.summary.durationMs / 1000).toFixed(1)}s`,
    ];

    if (report.baseline) {
        lines.push("", `基线通过率: ${(report.baseline.passRate * 100).toFixed(1)}%`);
        if (report.baseline.regressions.length)
        lines.push(`⚠️  回归: ${report.baseline.regressions.join(", ")}`);
        if (report.baseline.improvements.length)
        lines.push(`✨ 进步: ${report.baseline.improvements.join(", ")}`);
    }

    lines.push("", "=== 任务详情 ===");
    for (const r of report.results) {
        const tag = r.passed ? "✓" : "✗";
        const meta = `${r.rounds}轮 ${r.tokens}tok $${r.cost.toFixed(4)}`;
        lines.push(`${tag} [${r.taskId}] ${meta}${r.error ? ` (${r.error})` : ""}`);
    }
    return lines.join("\n");
}