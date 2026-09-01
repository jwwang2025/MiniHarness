import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  TelemetryCollector,
  estimateCostUsd,
  estimateTotalCostUsd,
  PRICING,
  formatMetrics,
} from "../src/telemetry/index.ts";

// ---------- 极简测试框架（与项目其它测试保持一致） ----------
let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  [PASS] ${name}`);
  } catch (e) {
    failed++;
    const msg = e instanceof Error ? e.message : String(e);
    failures.push(`${name}\n      ${msg}`);
    console.log(`  [FAIL] ${name}\n      ${msg}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      `${message}\n        expected: ${JSON.stringify(expected)}\n        actual:   ${JSON.stringify(actual)}`,
    );
  }
}

function assertClose(actual: number, expected: number, message: string, eps = 1e-9): void {
  if (Math.abs(actual - expected) > eps) {
    throw new Error(
      `${message}\n        expected: ~${expected}\n        actual:   ${actual}\n        diff:     ${Math.abs(actual - expected)}`,
    );
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// formatMetrics / collector 不依赖 cwd，但真实 API 测试需要项目根目录的 .env
const originalCwd = process.cwd();

// ---------- 主流程 ----------
async function main(): Promise<void> {
  // ============================================================
  // 1. pricing.ts —— 真实定价表与成本计算
  // ============================================================
  console.log("\n--- pricing ---");

  await test("PRICING 表每个模型的 prompt/completion 定价均为正数", async () => {
    const entries = Object.entries(PRICING);
    assert(entries.length > 0, "定价表不应为空");
    for (const [model, p] of entries) {
      assert(p.prompt > 0, `模型 ${model} 的 prompt 定价应为正数，实际 ${p.prompt}`);
      assert(p.completion > 0, `模型 ${model} 的 completion 定价应为正数，实际 ${p.completion}`);
      assert(p.completion > p.prompt || p.prompt > 0, `模型 ${model} 定价关系异常`);
    }
  });

  await test("estimateCostUsd 按 prompt/completion 分开精确计价（deepseek-chat）", async () => {
    // 1000 prompt * $0.14/1M + 500 completion * $0.28/1M = 0.00028
    assertClose(estimateCostUsd("deepseek-chat", 1000, 500), 0.00028,
      "deepseek-chat 成本计算不符");
  });

  await test("estimateCostUsd 精确计价（gpt-4o）", async () => {
    // 1000 prompt * $2.50/1M + 500 completion * $10/1M = 0.0075
    assertClose(estimateCostUsd("gpt-4o", 1000, 500), 0.0075,
      "gpt-4o 成本计算不符");
  });

  await test("estimateCostUsd 未知模型返回 0（不抛错）", async () => {
    assertEqual(estimateCostUsd("nonexistent-model", 1000, 1000), 0,
      "未知模型应返回 0");
  });

  await test("estimateCostUsd 零 token 返回 0", async () => {
    assertEqual(estimateCostUsd("deepseek-chat", 0, 0), 0, "零 token 应返回 0");
  });

  await test("estimateTotalCostUsd 按 completion 价保守估算", async () => {
    // 1M tokens * $0.28/1M = $0.28（deepseek-chat 的 completion 价）
    assertClose(estimateTotalCostUsd("deepseek-chat", 1_000_000), 0.28,
      "保守估算应按 completion 价计算");
    const total = 50_000;
    assert(
      estimateTotalCostUsd("deepseek-chat", total) >= estimateCostUsd("deepseek-chat", total, 0),
      "保守估算应 >= 纯 prompt 计价",
    );
  });

  await test("estimateTotalCostUsd 未知模型返回 0", async () => {
    assertEqual(estimateTotalCostUsd("nonexistent-model", 999), 0, "未知模型应返回 0");
  });

  // ============================================================
  // 2. TelemetryCollector —— 初始状态
  // ============================================================
  console.log("\n--- collector 初始状态 ---");

  await test("构造后初始 RunMetrics：计数全 0、成本 0、success=false", async () => {
    const c = new TelemetryCollector("写一个快排", "deepseek-chat", "sess-42");
    const run = c.getRun();
    assertEqual(run.task, "写一个快排", "task 应被记录");
    assertEqual(run.sessionId, "sess-42", "sessionId 应被记录");
    assertEqual(run.turns.length, 0, "初始无轮次");
    assertEqual(run.totalPromptTokens, 0, "初始 prompt tokens 为 0");
    assertEqual(run.totalCompletionTokens, 0, "初始 completion tokens 为 0");
    assertEqual(run.totalTokens, 0, "初始 total tokens 为 0");
    assertEqual(run.estimatedCostUsd, 0, "初始成本为 0");
    assertEqual(run.toolCallCount, 0, "初始工具调用数为 0");
    assertEqual(run.success, false, "初始 success 应为 false");
    assert(run.startTime > 0, "startTime 应为正数");
    assertEqual(run.endTime, undefined, "未 finish 时 endTime 应为 undefined");
  });

  await test("sessionId 可省略", async () => {
    const c = new TelemetryCollector("无会话任务", "gpt-4o");
    assertEqual(c.getRun().sessionId, undefined, "未传 sessionId 应为 undefined");
  });

  // ============================================================
  // 3. TelemetryCollector —— 完整生命周期（真实计时）
  // ============================================================
  console.log("\n--- collector 生命周期 ---");

  await test("两轮完整运行：token 累计、成本按真实定价表结算、工具记录回填", async () => {
    const c = new TelemetryCollector("成本统计集成", "deepseek-chat", "sess-e2e");

    // 第 1 轮：1 次模型调用 + 2 次工具调用（1 成功 allow / 1 失败 deny）
    c.startTurn(0);
    c.startModelCall();
    await sleep(25);
    c.endModelCall({ promptTokens: 100, completionTokens: 50, totalTokens: 150 });
    c.startToolCall("read_file");
    await sleep(15);
    c.endToolCall(true, "allow");
    c.startToolCall("write_file");
    await sleep(5);
    c.endToolCall(false, "deny");
    c.endTurn();

    // 第 2 轮：纯模型调用
    c.startTurn(1);
    c.startModelCall();
    await sleep(10);
    c.endModelCall({ promptTokens: 200, completionTokens: 100, totalTokens: 300 });
    c.endTurn();

    const run = c.finish(true);

    // 轮次结构
    assertEqual(run.turns.length, 2, "应有 2 轮记录");
    const t0 = run.turns[0]!;
    assertEqual(t0.round, 0, "第 1 轮 round 应为 0");
    assertEqual(t0.promptTokens, 100, "第 1 轮 promptTokens 应来自 usage");
    assertEqual(t0.completionTokens, 50, "第 1 轮 completionTokens 应来自 usage");
    assertEqual(t0.totalTokens, 150, "第 1 轮 totalTokens 应来自 usage");
    assertEqual(t0.toolCalls.length, 2, "第 1 轮应有 2 次工具调用");
    assertEqual(t0.toolCalls[0]!.name, "read_file", "工具 1 名称应一致");
    assertEqual(t0.toolCalls[0]!.ok, true, "工具 1 应成功");
    assertEqual(t0.toolCalls[0]!.safetyDecision, "allow", "工具 1 审批应为 allow");
    assert(t0.toolCalls[0]!.durationMs >= 10,
      `工具 1 真实耗时应 >= 10ms，实际 ${t0.toolCalls[0]!.durationMs}`);
    assertEqual(t0.toolCalls[1]!.ok, false, "工具 2 应失败");
    assertEqual(t0.toolCalls[1]!.safetyDecision, "deny", "工具 2 审批应为 deny");
    assert(t0.toolCalls[1]!.durationMs > 0, "工具 2 耗时应为正数");
    assert(t0.modelDurationMs >= 20,
      `模型真实耗时应 >= 20ms，实际 ${t0.modelDurationMs}`);
    assert(t0.durationMs >= t0.modelDurationMs, "轮次耗时 >= 模型耗时（时钟单调性）");

    const t1 = run.turns[1]!;
    assertEqual(t1.round, 1, "第 2 轮 round 应为 1");
    assertEqual(t1.promptTokens, 200, "第 2 轮 promptTokens 应来自 usage");
    assertEqual(t1.totalTokens, 300, "第 2 轮 totalTokens 应来自 usage");
    assertEqual(t1.toolCalls.length, 0, "第 2 轮无工具调用");

    // 汇总
    assertEqual(run.totalPromptTokens, 300, "prompt tokens 应跨轮累计");
    assertEqual(run.totalCompletionTokens, 150, "completion tokens 应跨轮累计");
    assertEqual(run.totalTokens, 450, "total tokens 应跨轮累计");
    assertEqual(run.toolCallCount, 2, "工具调用数应累计");
    assert(run.totalDurationMs! > 0, "总耗时应为正数");
    assert(run.endTime! >= run.startTime, "endTime 应 >= startTime");
    assertEqual(run.success, true, "finish(true) 后 success 应为 true");
    assertEqual(run.error, undefined, "成功时 error 应为 undefined");

    // 成本：300*0.14/1M + 150*0.28/1M = 0.000084
    assertClose(run.estimatedCostUsd, 0.000084, "成本应等于定价表精确计算值");
    assertClose(run.estimatedCostUsd, estimateCostUsd("deepseek-chat", 300, 150),
      "成本应与 estimateCostUsd 直接计算一致");
  });

  await test("usage 缺失：token 保持 0，但模型耗时仍被记录", async () => {
    const c = new TelemetryCollector("无 usage 场景", "deepseek-chat");
    c.startTurn(0);
    c.startModelCall();
    await sleep(10);
    c.endModelCall(undefined); // Provider 未返回 usage
    c.endTurn();
    const run = c.finish(true);

    const t0 = run.turns[0]!;
    assertEqual(t0.promptTokens, 0, "无 usage 时 promptTokens 应保持 0");
    assertEqual(t0.completionTokens, 0, "无 usage 时 completionTokens 应保持 0");
    assertEqual(t0.totalTokens, 0, "无 usage 时 totalTokens 应保持 0");
    assert(t0.modelDurationMs > 0, "模型耗时仍应被记录");
    assertEqual(run.totalTokens, 0, "汇总 token 应为 0");
    assertEqual(run.estimatedCostUsd, 0, "无 token 则成本为 0");
  });

  await test("未开启 turn 时调用 endModelCall/endToolCall 不抛错且不影响 run", async () => {
    const c = new TelemetryCollector("边界场景", "deepseek-chat");
    // 真实行为：early return，不抛错
    c.endModelCall({ promptTokens: 5, completionTokens: 5, totalTokens: 10 });
    c.endToolCall(true, "allow");
    const run = c.getRun();
    assertEqual(run.turns.length, 0, "不应产生轮次");
    assertEqual(run.totalTokens, 0, "token 不应被污染");
  });

  await test("finish(false, err)：记录失败与错误信息，成本仍按已消耗 token 结算", async () => {
    const c = new TelemetryCollector("失败任务", "deepseek-chat");
    c.startTurn(0);
    c.startModelCall();
    await sleep(5);
    c.endModelCall({ promptTokens: 100, completionTokens: 50, totalTokens: 150 });
    c.endTurn();
    const run = c.finish(false, "达到最大轮数限制");

    assertEqual(run.success, false, "success 应为 false");
    assertEqual(run.error, "达到最大轮数限制", "error 应被记录");
    assert(run.endTime !== undefined, "endTime 应被设置");
    assert(run.totalDurationMs! >= 0, "totalDurationMs 应被设置");
    assert(run.estimatedCostUsd > 0, "失败运行也应按已消耗 token 计费");
    assertClose(run.estimatedCostUsd, estimateCostUsd("deepseek-chat", 100, 50),
      "失败成本应与定价表一致");
  });

  await test("成本只在 finish 时结算（finish 前 estimatedCostUsd 为 0）", async () => {
    const c = new TelemetryCollector("延迟结算", "deepseek-chat");
    c.startTurn(0);
    c.startModelCall();
    await sleep(5);
    c.endModelCall({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    c.endTurn();
    assertEqual(c.getRun().estimatedCostUsd, 0, "finish 前成本应为 0");
    const run = c.finish(true);
    assert(run.estimatedCostUsd > 0, "finish 后成本应大于 0");
  });

  // ============================================================
  // 4. formatMetrics —— 真实 RunMetrics 的报告渲染
  // ============================================================
  console.log("\n--- formatMetrics ---");

  await test("成功运行：输出真实 token / 成本 / 工具统计，最慢工具降序", async () => {
    const c = new TelemetryCollector("格式化测试", "gpt-4o", "sess-fmt");
    c.startTurn(0);
    c.startModelCall();
    await sleep(5);
    c.endModelCall({ promptTokens: 300, completionTokens: 150, totalTokens: 450 });
    c.startToolCall("slow_tool");
    await sleep(30);
    c.endToolCall(true, "allow");
    c.startToolCall("fast_tool");
    await sleep(2);
    c.endToolCall(false, "deny");
    c.endTurn();
    const run = c.finish(true);

    const out = formatMetrics(run);
    assert(out.includes("✓ 运行报告"), "成功运行应以 ✓ 开头");
    assert(out.includes("session: sess-fmt"), "应输出 sessionId");
    assert(out.includes("prompt: 300"), `应输出真实 prompt tokens，输出:\n${out}`);
    assert(out.includes("completion: 150"), `应输出真实 completion tokens，输出:\n${out}`);
    assert(out.includes("total: 450"), `应输出真实 total tokens，输出:\n${out}`);
    assert(out.includes(`估算成本 $${run.estimatedCostUsd.toFixed(4)}`),
      `应输出按定价表结算的成本，输出:\n${out}`);
    assert(out.includes("最慢工具"), "有工具调用时应输出最慢工具");
    assert(out.indexOf("slow_tool") < out.indexOf("fast_tool"),
      `最慢工具应按耗时降序排列，输出:\n${out}`);
    assert(out.includes("成功率 50"), `1/2 工具成功应显示 50，输出:\n${out}`);
    assert(!out.includes("最慢轮次"), "单轮运行不应输出最慢轮次");
  });

  await test("多轮运行：输出最慢轮次且降序", async () => {
    const c = new TelemetryCollector("多轮格式化", "gpt-4o");
    c.startTurn(0);
    c.startModelCall();
    await sleep(25); // 第 0 轮更慢
    c.endModelCall({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    c.endTurn();
    c.startTurn(1);
    c.startModelCall();
    await sleep(2);
    c.endModelCall({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    c.endTurn();
    const out = formatMetrics(c.finish(true));
    assert(out.includes("最慢轮次"), "两轮以上应输出最慢轮次");
    assert(out.indexOf("round 0") < out.indexOf("round 1"),
      `最慢轮次应按耗时降序，输出:\n${out}`);
  });

  await test("失败运行：输出 ✗ 与错误信息", async () => {
    const c = new TelemetryCollector("失败格式化", "gpt-4o");
    c.startTurn(0);
    c.startModelCall();
    await sleep(5);
    c.endModelCall({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    c.endTurn();
    const out = formatMetrics(c.finish(false, "达到最大轮数限制"));
    assert(out.includes("✗"), "失败运行应以 ✗ 开头");
    assert(out.includes("运行失败: 达到最大轮数限制"), `应输出错误信息，输出:\n${out}`);
  });

  await test("无 sessionId 时输出不含 session 行", async () => {
    const c = new TelemetryCollector("无会话", "gpt-4o");
    c.startTurn(0);
    c.startModelCall();
    await sleep(2);
    c.endModelCall({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    c.endTurn();
    const out = formatMetrics(c.finish(true));
    assert(!out.includes("session:"), `无 sessionId 不应输出 session 行，输出:\n${out}`);
  });

  // ============================================================
  // 5. 端到端 —— 真实 API 全链路（gate：存在 .env 且配置了 API Key）
  // ============================================================
  console.log("\n--- 真实 API 端到端（runAgent → usage → 采集 → 成本结算） ---");

  const envPath = join(originalCwd, ".env");
  if (!existsSync(envPath)) {
    console.log("  [SKIP] 未找到 .env，跳过真实 API 端到端测试");
  } else {
    process.loadEnvFile(envPath);
    if (!process.env.MINIHARNESS_API_KEY) {
      console.log("  [SKIP] .env 未配置 MINIHARNESS_API_KEY，跳过真实 API 端到端测试");
    } else {
      await test("真实 Provider + runAgent：usage 真实流入采集器并算出成本", async () => {
        // 动态导入：避免无 .env 的环境在模块加载阶段崩溃
        const { createProvider } = await import("../src/provider/index.ts");
        const { runAgent } = await import("../src/agent/index.ts");
        const provider = createProvider();

        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 60_000);
        try {
          const res = await runAgent(
            "请直接回复两个字：你好。不要调用任何工具。",
            provider,
            { workspace: originalCwd },
            ctrl.signal,
            { safetyOptions: { autoApprove: true } },
          );

          const m = res.metrics;
          assert(m !== undefined, "runAgent 应返回 metrics");
          assertEqual(m!.success, true, "真实任务应成功完成");
          assert(m!.turns.length >= 1, "应至少有一轮模型调用");
          assert(m!.totalPromptTokens > 0, "真实 API usage 应产出 promptTokens");
          assert(m!.totalCompletionTokens > 0, "真实 API usage 应产出 completionTokens");
          assert(m!.totalTokens > 0, "真实 API usage 应产出 totalTokens");
          assert(m!.totalDurationMs! > 0, "总耗时应为正数");
          assert(m!.turns[0]!.modelDurationMs > 0, "模型调用真实耗时应为正数");

          if (PRICING[provider.model]) {
            assert(m!.estimatedCostUsd > 0, "已知定价模型应算出成本 > 0");
            assertClose(
              m!.estimatedCostUsd,
              estimateCostUsd(provider.model, m!.totalPromptTokens, m!.totalCompletionTokens),
              "成本应与定价表精确计算一致",
            );
          } else {
            console.log(`    （模型 ${provider.model} 不在定价表中，跳过成本断言）`);
          }
        } finally {
          clearTimeout(timer);
        }
      });
    }
  }
}

try {
  await main();
} catch (e) {
  failed++;
  console.error("\n测试运行异常:", e);
}

// ---------- 汇总 ----------
console.log(`\n${"=".repeat(50)}`);
console.log(`passed: ${passed}, failed: ${failed}`);
if (failures.length > 0) {
  console.log("\n失败用例:");
  for (const f of failures) console.log(`  - ${f}`);
}

process.exit(failed > 0 ? 1 : 0);
