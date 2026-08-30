# Phase 8：进阶能力技术文档

> 适用阶段：已完成 Phase 0-5（核心循环 + 工具 + 上下文 + 安全 + 会话）
> 目标：让 MiniHarness 从「能用的 demo」进化到「接近生产级的框架」
> 原则：每个子阶段独立可验收，完成一个再进下一个

---

## 目录

- [Phase 8.0 总览：为什么要有这一阶段](#phase-80-总览为什么要有这一阶段)
- [Phase 8.1 评测框架 Eval](#phase-81-评测框架-eval)
- [Phase 8.2 多 Provider 抽象](#phase-82-多-provider-抽象)
- [Phase 8.3 成本与可观测性](#phase-83-成本与可观测性)
- [Phase 8.4 MCP 协议支持](#phase-84-mcp-协议支持)
- [Phase 8.5 子代理与任务分解](#phase-85-子代理与任务分解)

---

## Phase 8.0 总览：为什么要有这一阶段

你已经完成了 Phase 0-5，Agent 能跑、能调用工具、能处理长上下文、有安全边界、会话可持久化。这已经是一个**完整的最小 Agent 框架**了。

但要让它真正「好用」，还缺几样关键东西：

| 问题 | 解决后你能得到什么 |
|------|-------------------|
| 改了 prompt 不知道变好了还是变差了 | 评测框架量化能力变化，拒绝「凭感觉」 |
| 模型写死在配置里，换个模型要改代码 | 一行配置切换 OpenAI / Qwen / Ollama 本地模型 |
| 不知道跑一次花了多少钱、用了多少 token | 成本面板 + 用量统计，帮你优化和预算 |
| 工具只能写死在代码里 | 接入 MCP 后，任何 MCP 服务器的工具都能即插即用 |
| 大任务 Agent 一个人干容易乱 | 子代理把任务拆开并行干，效率和质量双提升 |

### 子阶段依赖关系

```
8.1 评测框架 Eval  ←  最先做！不依赖任何其他进阶特性
         │
         ▼
8.2 多 Provider 抽象  ←  地基（后续阶段大多依赖它）
         │
    ┌────┴────┐
    ▼         ▼
8.3 可观测性  8.4 MCP  ←  并行，互不依赖
    │         │
    └────┬────┘
         ▼
    8.5 子代理
```

> **建议顺序**：先做 8.1 Eval（建立基线，衡量你所有后续改动的效果），然后 8.2 多 Provider（地基），之后 8.3 和 8.4 可以挑一个先做，最后 8.5 子代理。

---

## Phase 8.1 评测框架 Eval

**目标**：建立一个 benchmark 任务集，每次改动后跑一遍，量化 Agent 的能力变化，拒绝「凭感觉调参」。

**你将学到**：Agent 评测方法论、评分标准设计、自动化评测、回归检测。

### 为什么要最先做

这是所有后续改动的「度量衡」。你改了系统提示词、加了新工具、换了模型——Agent 是变好了还是变差了？

没有评测，你只能「感觉好像变聪明了」。有了评测，每次改动都有数据支撑。

**好消息是**：Eval 完全不依赖 Phase 8 的其他特性，用你现有的 Phase 0-5 代码就能直接实现。

### 设计思路

```
┌─────────────────────────────┐
│      Eval 任务集             │
│  (一个个 task 定义)          │
│  - 输入任务描述              │
│  - 预期结果 / 验证条件       │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│      Eval 执行器             │
│  逐个运行任务，收集结果       │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│      评分器 + 报告            │
│  通过率 · 平均耗时 · 成本    │
│  历史对比 · 回归检测          │
└─────────────────────────────┘
```

### 具体步骤

#### 第 1 步：定义评测任务格式

新建 `src/eval/types.ts`：

```ts
// src/eval/types.ts
export interface EvalTask {
  id: string;
  name: string;
  category: string;        // 分类，如 "file" / "code" / "multi_tool"
  description: string;     // 发给 Agent 的任务描述

  /** 验证方式 */
  verify: "contains" | "script" | "model-graded";

  // 对于 contains 验证：结果中必须包含的字符串
  expectedContains?: string[];

  // 对于 script 验证：退出码 0 = 通过
  setupScript?: string;    // 评测前执行的准备脚本
  verifyScript?: string;   // 验证脚本（通过 stdin 接收 Agent 输出）

  // 超时（秒）
  timeout?: number;

  // 难度分，用于加权统计
  difficulty: 1 | 2 | 3 | 4 | 5;
}

export interface EvalResult {
  taskId: string;
  passed: boolean;
  score: number;           // 0-1 之间的得分
  durationMs: number;
  tokens: number;
  costUsd: number;
  output?: string;
  error?: string;
}

export interface EvalReport {
  timestamp: number;
  totalTasks: number;
  passed: number;
  failed: number;
  passRate: number;        // 0-1
  avgScore: number;
  totalDurationMs: number;
  totalTokens: number;
  totalCostUsd: number;
  results: EvalResult[];
  model: string;
}
```

#### 第 2 步：写价格估算（可选但推荐）

新建 `src/eval/pricing.ts`，用来估算每次评测的花费：

```ts
// src/eval/pricing.ts
// 每 1M tokens 的价格（美元），仅供粗略估算
const PRICING: Record<string, { input: number; output: number }> = {
  "deepseek-chat": { input: 0.14, output: 0.28 },
  "deepseek-reasoner": { input: 0.55, output: 2.19 },
  "gpt-4o": { input: 5.0, output: 15.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "qwen-plus": { input: 0.8, output: 2.0 },
  "qwen-turbo": { input: 0.15, output: 0.3 },
};

const DEFAULT_PRICE = { input: 1.0, output: 3.0 };

export function estimateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  let price = PRICING[model];
  if (!price) {
    const key = Object.keys(PRICING).find(
      (k) => model.startsWith(k) || k.startsWith(model),
    );
    price = key ? PRICING[key] : DEFAULT_PRICE;
  }
  return (promptTokens / 1_000_000) * price.input
       + (completionTokens / 1_000_000) * price.output;
}
```

> 如果暂时不想做成本统计，可以跳过这一步，后面在 8.3 里再完善。

#### 第 3 步：写评测执行器

新建 `src/eval/runner.ts`。核心思路：循环跑每个任务，调用你已有的 `runAgent`，然后验证结果。

```ts
// src/eval/runner.ts
import { runAgent } from "../agent/loop.js";
import type { ToolContext } from "../tools/types.js";
import type { EvalTask, EvalResult, EvalReport } from "./types.js";
import { estimateCostUsd } from "./pricing.js";
import { estimateMessagesTokens } from "../agent/tokens.js";
import { model } from "../config.js";

export interface EvalRunnerOptions {
  toolCtx: ToolContext;
  tasks: EvalTask[];
  signal?: AbortSignal;
  approvalMode?: "auto-allow" | "auto-deny"; // 评测时自动处理权限
  onProgress?: (taskId: string, status: "running" | "passed" | "failed") => void;
}

export async function runEval(opts: EvalRunnerOptions): Promise<EvalReport> {
  const { toolCtx, tasks, signal, approvalMode = "auto-allow", onProgress } = opts;
  const results: EvalResult[] = [];
  const startTime = Date.now();

  for (const task of tasks) {
    if (signal?.aborted) break;
    onProgress?.(task.id, "running");

    const result = await runSingleTask(task, toolCtx, approvalMode, signal);
    results.push(result);
    onProgress?.(task.id, result.passed ? "passed" : "failed");
  }

  const totalDurationMs = Date.now() - startTime;
  const passed = results.filter((r) => r.passed).length;

  return {
    timestamp: Date.now(),
    totalTasks: tasks.length,
    passed,
    failed: tasks.length - passed,
    passRate: passed / tasks.length,
    avgScore: results.reduce((s, r) => s + r.score, 0) / tasks.length,
    totalDurationMs,
    totalTokens: results.reduce((s, r) => s + r.tokens, 0),
    totalCostUsd: results.reduce((s, r) => s + r.costUsd, 0),
    results,
    model,
  };
}

async function runSingleTask(
  task: EvalTask,
  toolCtx: ToolContext,
  approvalMode: "auto-allow" | "auto-deny",
  signal?: AbortSignal,
): Promise<EvalResult> {
  const startTime = Date.now();

  try {
    // 超时控制
    const timeout = task.timeout ?? 120; // 默认 120 秒
    const timeoutCtrl = new AbortController();
    const timer = setTimeout(() => timeoutCtrl.abort(new Error("超时")), timeout * 1000);

    // 如果有上级 signal，也监听
    if (signal) {
      signal.addEventListener("abort", () => timeoutCtrl.abort(signal.reason), { once: true });
    }

    // 评测模式下，安全策略设为 auto-allow（否则每个 write-file 都要手动确认，没法自动跑）
    // 注意：你需要改造一下 safety/approver.ts 支持自动批准模式
    // 如果暂时不想改，可以只测只读类任务（read-file、list-dir）
    const safetyOptions = approvalMode === "auto-allow"
      ? { /* 自动批准的配置，后面会讲怎么加 */ }
      : undefined;

    const { answer, messages } = await runAgent(
      task.description,
      toolCtx,
      timeoutCtrl.signal,
      // { safetyOptions }, // 等你加了 auto-allow 再打开
    );

    clearTimeout(timer);

    // 计算 token（用你已有的 estimateMessagesTokens）
    const totalTokens = estimateMessagesTokens(messages);
    const cost = estimateCostUsd(model, Math.floor(totalTokens * 0.7), Math.floor(totalTokens * 0.3));

    // 验证结果
    const score = await verifyTask(task, answer);

    return {
      taskId: task.id,
      passed: score >= 0.5,  // 得分过半算通过
      score,
      durationMs: Date.now() - startTime,
      tokens: totalTokens,
      costUsd: cost,
      output: answer,
    };
  } catch (e) {
    return {
      taskId: task.id,
      passed: false,
      score: 0,
      durationMs: Date.now() - startTime,
      tokens: 0,
      costUsd: 0,
      error: String(e),
    };
  }
}

async function verifyTask(task: EvalTask, output: string): Promise<number> {
  switch (task.verify) {
    case "contains": {
      const expected = task.expectedContains ?? [];
      if (expected.length === 0) return 1;
      const matched = expected.filter((s) => output.includes(s)).length;
      return matched / expected.length;
    }
    case "script": {
      if (!task.verifyScript) return 1;
      try {
        const { execSync } = await import("node:child_process");
        execSync(task.verifyScript, {
          input: output,
          timeout: 10000,
          stdio: ["pipe", "pipe", "pipe"],
        });
        return 1;
      } catch {
        return 0;
      }
    }
    default:
      return 0;
  }
}
```

#### 第 4 步：给 approver 加自动批准模式

评测要全自动跑，不能每次 write-file 都停下来问用户。修改 `src/safety/approver.ts`：

```ts
// 在 approver.ts 里加一个 autoApprove 选项
// 思路：如果 safetyOptions 里有 autoApprove 字段，就直接返回对应结果，不用问用户

// 修改后的 approve 函数大致长这样：
export async function approve(
  inv: ToolInvocation,
  policyPerm: Permission,
  opts: SafetyOptions = {},
): Promise<{ permission: Permission }> {
  // 如果是自动批准模式，直接返回
  if (opts.autoApprove === "allow") {
    return { permission: "allow" };
  }
  if (opts.autoApprove === "deny") {
    return { permission: "deny" };
  }

  // ... 原有的交互式审批逻辑不变
}
```

别忘记在 `safety/types.ts` 里给 `SafetyOptions` 加上 `autoApprove?: "allow" | "deny"` 字段。

#### 第 5 步：写报告生成器

新建 `src/eval/reporter.ts`：

```ts
// src/eval/reporter.ts
import type { EvalReport, EvalResult } from "./types.js";

export function formatReport(report: EvalReport): string {
  const lines: string[] = [];

  lines.push("=".repeat(56));
  lines.push("  MiniHarness Eval Report");
  lines.push("=".repeat(56));
  lines.push(`模型: ${report.model}`);
  lines.push(`时间: ${new Date(report.timestamp).toLocaleString()}`);
  lines.push("");
  lines.push(`任务总数: ${report.totalTasks}`);
  lines.push(`通过: ${report.passed} / ${report.totalTasks} (${(report.passRate * 100).toFixed(1)}%)`);
  lines.push(`平均得分: ${(report.avgScore * 100).toFixed(1)}%`);
  lines.push("");
  lines.push(`总耗时: ${(report.totalDurationMs / 1000).toFixed(1)}s`);
  lines.push(`总 Token: ${report.totalTokens}`);
  lines.push(`估算花费: $${report.totalCostUsd.toFixed(4)} USD`);
  lines.push("");
  lines.push("─── 详细结果 ───");

  for (const r of report.results) {
    const icon = r.passed ? "✓" : "✗";
    const scorePct = (r.score * 100).toFixed(0).padStart(4);
    const dur = `${(r.durationMs / 1000).toFixed(1)}s`.padStart(7);
    const cost = `$${r.costUsd.toFixed(4)}`.padStart(9);
    lines.push(`  ${icon} ${r.taskId.padEnd(22)} ${scorePct}% ${dur} ${cost}`);
    if (r.error) {
      lines.push(`      错误: ${r.error.slice(0, 70)}`);
    }
  }

  lines.push("=".repeat(56));
  return lines.join("\n");
}

/**
 * 和历史报告对比，找出回归（变差的任务）和进步
 */
export function compareReports(current: EvalReport, baseline: EvalReport): string {
  const lines: string[] = [];
  lines.push("\n─── 与基线对比 ───");
  lines.push(
    `基线通过率: ${(baseline.passRate * 100).toFixed(1)}% → 当前: ${(current.passRate * 100).toFixed(1)}%`,
  );

  const regressions: EvalResult[] = [];
  const improvements: EvalResult[] = [];

  for (const cur of current.results) {
    const base = baseline.results.find((r) => r.taskId === cur.taskId);
    if (!base) continue;
    if (cur.score < base.score - 0.01) regressions.push(cur);
    if (cur.score > base.score + 0.01) improvements.push(cur);
  }

  if (regressions.length > 0) {
    lines.push(`\n⚠️  回归任务 (${regressions.length}):`);
    for (const r of regressions) {
      const base = baseline.results.find((x) => x.taskId === r.taskId)!;
      lines.push(`  ${r.taskId}: ${(base.score * 100).toFixed(0)}% → ${(r.score * 100).toFixed(0)}%`);
    }
  }

  if (improvements.length > 0) {
    lines.push(`\n🎉 进步任务 (${improvements.length}):`);
    for (const r of improvements) {
      const base = baseline.results.find((x) => x.taskId === r.taskId)!;
      lines.push(`  ${r.taskId}: ${(base.score * 100).toFixed(0)}% → ${(r.score * 100).toFixed(0)}%`);
    }
  }

  if (regressions.length === 0 && improvements.length === 0) {
    lines.push("\n无显著变化");
  }

  return lines.join("\n");
}
```

#### 第 6 步：创建评测任务集

新建 `evals/tasks.json`。先从你已有的工具能测的任务开始：

```json
[
  {
    "id": "read-package-name",
    "name": "读取 package.json 并说出项目名",
    "category": "file",
    "description": "读取 package.json 文件，找出这个项目的 name 字段的值，只回答项目名称本身，不要其他解释。",
    "verify": "contains",
    "expectedContains": ["MiniHarness"],
    "difficulty": 1
  },
  {
    "id": "list-src-dir",
    "name": "列出 src 目录内容",
    "category": "file",
    "description": "列出 src 目录下的所有文件和子目录，然后用一句话告诉我有哪些子目录。",
    "verify": "contains",
    "expectedContains": ["agent", "tools"],
    "difficulty": 1
  },
  {
    "id": "read-tool-types",
    "name": "读取工具类型定义文件",
    "category": "file",
    "description": "读取 src/tools/types.ts 文件，告诉我 Tool 接口里有哪些字段（属性名）。",
    "verify": "contains",
    "expectedContains": ["name", "description", "execute"],
    "difficulty": 2
  },
  {
    "id": "count-lines-config",
    "name": "统计配置文件行数",
    "category": "file",
    "description": "读取 src/config.ts 文件，然后告诉我这个文件大约有多少行代码（你可以数一下行数）。直接回答数字。",
    "verify": "script",
    "verifyScript": "node -e \"const fs=require('fs');const lines=fs.readFileSync('src/config.ts','utf8').split('\\n').length;const input=process.argv[1]||'';const nums=input.match(/\\d+/g);const ok=nums&&nums.some(n=>Math.abs(parseInt(n)-lines)<=2);process.exit(ok?0:1)\"",
    "difficulty": 2
  },
  {
    "id": "multi-read-compare",
    "name": "比较两个文件的工具数量",
    "category": "multi_tool",
    "description": "先读取 src/tools/registry.ts，再读取 src/tools/file-tools.ts，然后告诉我：file-tools.ts 里注册了几个工具？",
    "verify": "contains",
    "expectedContains": ["3"],
    "difficulty": 3
  },
  {
    "id": "find-system-prompt",
    "name": "找到系统提示词文件",
    "category": "multi_tool",
    "description": "在项目中找到定义系统提示词（system prompt）的文件，告诉我那个文件的路径，以及提示词里是否提到了'工具'这个词。",
    "verify": "contains",
    "expectedContains": ["system-prompt.ts"],
    "difficulty": 3
  }
]
```

> 提示：如果你还没有 `search` / `grep` 工具，第 6 个任务可能需要 Agent 一个个目录翻。没关系——**这正好是评测的意义**：它能测出 Agent 在没有搜索工具时的能力边界。等你以后加了搜索工具，再跑一次评测，就能看到分数提升。

#### 第 7 步：加 eval CLI 命令

在 `src/index.ts` 里加 `eval` 命令：

```ts
// src/index.ts（追加 import）
import { runEval } from "./eval/runner.js";
import { formatReport, compareReports } from "./eval/reporter.js";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

// ... 其他函数不变 ...

// 新增 eval 命令
async function evalCmd() {
  const tasksPath = rest[0] || "evals/tasks.json";
  const baselinePath = rest[1]; // 可选：基线报告路径

  console.error(`[Eval] 加载任务: ${tasksPath}`);
  const tasksData = await readFile(tasksPath, "utf8");
  const tasks = JSON.parse(tasksData);

  console.error(`[Eval] 共 ${tasks.length} 个任务，开始执行...\n`);

  const report = await runEval({
    toolCtx: ctx,
    tasks,
    signal: ctrl.signal,
    approvalMode: "auto-allow", // 评测模式自动批准
    onProgress: (id, status) => {
      const icon = status === "passed" ? "✓" : status === "failed" ? "✗" : "…";
      console.error(`  ${icon} ${id}`);
    },
  });

  // 打印报告
  console.error("\n" + formatReport(report));

  // 如果有基线，对比
  if (baselinePath) {
    try {
      const baselineData = await readFile(baselinePath, "utf8");
      const baseline = JSON.parse(baselineData);
      console.error(compareReports(report, baseline));
    } catch (e) {
      console.error(`\n基线报告读取失败: ${e}`);
    }
  }

  // 保存报告
  const reportDir = ".anvil/evals";
  await mkdir(reportDir, { recursive: true });
  const reportPath = join(reportDir, `report-${Date.now()}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.error(`\n报告已保存: ${reportPath}`);
}

// 在 commands 里加上 eval
const commands: Record<string, () => Promise<void>> = {
  ask,
  chat,
  resume,
  sessions,
  eval: evalCmd,
};
```

#### 第 8 步：跑第一次，建立基线

```bash
# 确保目录存在
mkdir -p evals
# 把上面的 tasks.json 写进 evals/tasks.json

# 跑第一次评测
pnpm dev eval evals/tasks.json

# 跑完后，把生成的报告复制为基线（替换文件名）
cp .anvil/evals/report-xxxxxxxxxx.json evals/baseline.json

# 以后每次改完代码跑：
pnpm dev eval evals/tasks.json evals/baseline.json
# 就能直接看到和基线比，哪些进步了、哪些退步了
```

### 验收标准

- [ ] 至少有 5 个评测任务，覆盖不同难度和不同工具。
- [ ] 运行 `pnpm dev eval` 能自动跑完所有任务并生成报告。
- [ ] 报告包含：通过率、平均得分、总耗时、总 token、估算花费。
- [ ] 有基线报告后，再次运行能对比出进步和回归。
- [ ] 故意改坏一个东西（比如把系统提示词改乱），评测能检测到通过率下降。

### 进阶方向（以后再做）

- **model-graded 验证**：用一个更强的模型来评判 Agent 的输出质量（适合开放式问题）
- **分类统计**：按 category 分组统计通过率，看哪类任务弱
- **CI 集成**：把评测放进 GitHub Actions，每次 PR 自动跑
- **难度加权**：高难度任务权重更高，总分更合理

---

## Phase 8.2 多 Provider 抽象

**目标**：把「写死的 OpenAI 调用」抽成一个 `Provider` 接口，支持多模型厂商切换，配置即切换。

**你将学到**：接口抽象设计、工厂模式、策略模式、如何写出「可替换」的代码。

### 为什么要做

现在你的 `src/provider/openai.ts` 直接从 `config.ts` 读 `apiKey/baseUrl/model`，然后调 `fetch`。这在只有一个模型时没问题，但当你想：

- 试试 Qwen 的效果
- 本地用 Ollama 离线跑
- 同一个 Agent 不同任务用不同模型

……就得改代码。Provider 抽象就是把「怎么调模型」藏在接口后面，外面的 Agent Loop 只依赖接口，不依赖具体实现。

### 设计思路

```
┌─────────────┐
│  Agent Loop │   ←  只依赖 Provider 接口
└──────┬──────┘
       │
       ▼
┌─────────────────────┐
│   Provider 接口      │
│  - chat(messages)    │
│  - streamChat(...)   │
│  - getModelInfo()    │
└──────────┬──────────┘
           │
     ┌─────┴─────┐
     ▼           ▼
┌─────────┐ ┌─────────┐ ┌─────────┐
│ OpenAI  │ │ Qwen    │ │ Ollama  │  ... 更多实现
│ Provider│ │ Provider│ │ Provider│
└─────────┘ └─────────┘ └─────────┘
```

**核心原则**：Agent Loop 永远不直接 import 具体的 Provider 实现，只 import 接口 + 工厂函数。

### 具体步骤

#### 第 1 步：定义 Provider 接口

新建 `src/provider/types.ts`，把所有和模型相关的类型都挪到这里：

```ts
// src/provider/types.ts
export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCallDelta {
  id: string;
  name: string;
  arguments: string;
  index: number;
}

export interface StreamDelta {
  text?: string;
  toolCalls?: ToolCallDelta[];
}

export interface ChatMessage {
  role: Role;
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

export interface ChatTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatResult {
  content: string;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * 统一的模型 Provider 接口
 * 所有模型厂商都实现这个接口
 */
export interface Provider {
  /** 模型标识名，如 "deepseek-chat" */
  readonly model: string;

  /** 普通非流式调用，返回完整结果 */
  chat(
    messages: ChatMessage[],
    tools: ChatTool[],
    signal?: AbortSignal,
  ): Promise<ChatResult>;

  /** 流式调用，异步迭代器逐个产出 delta */
  streamChat(
    messages: ChatMessage[],
    tools: ChatTool[],
    signal?: AbortSignal,
  ): Promise<AsyncIterable<StreamDelta>>;
}
```

> **注意**：把 `ChatMessage` 从 `config.ts` 移到 `provider/types.ts`，因为它本质上是 Provider 层的概念。`config.ts` 只负责配置加载。

#### 第 2 步：改写 OpenAI Provider 为类

把 `src/provider/openai.ts` 从「一堆函数」改成「实现 Provider 接口的类」：

```ts
// src/provider/openai.ts
import type { Provider, ChatMessage, ChatTool, ChatResult, StreamDelta } from "./types.js";

export interface OpenAIProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export class OpenAIProvider implements Provider {
  readonly model: string;
  private apiKey: string;
  private baseUrl: string;

  constructor(config: OpenAIProviderConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl.replace(/\/$/, ""); // 去掉末尾斜杠
    this.model = config.model;
  }

  async chat(
    messages: ChatMessage[],
    tools: ChatTool[],
    signal?: AbortSignal,
  ): Promise<ChatResult> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        tools: tools.length > 0 ? tools : undefined,
      }),
      signal: signal ?? null,
    });

    if (!res.ok) {
      throw new Error(`API error: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    const choice = data.choices[0];
    const toolCalls = (choice.message.tool_calls ?? []).map(
      (tc: { id: string; function: { name: string; arguments: string } }) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      }),
    );

    return {
      content: choice.message.content ?? "",
      toolCalls,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
    };
  }

  async streamChat(
    messages: ChatMessage[],
    tools: ChatTool[],
    signal?: AbortSignal,
  ): Promise<AsyncIterable<StreamDelta>> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        stream: true,
      }),
      signal: signal ?? null,
    });

    if (!res.ok || !res.body) {
      throw new Error(`API error: ${res.status} ${await res.text()}`);
    }

    return this.parseSSE(res.body);
  }

  private async *parseSSE(body: ReadableStream<Uint8Array>): AsyncIterable<StreamDelta> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const data = line.trim();
        if (!data.startsWith("data:")) continue;
        const json = data.slice(5).trim();
        if (json === "[DONE]") return;

        try {
          const parsed = JSON.parse(json);
          const delta = parsed.choices?.[0]?.delta;
          if (!delta) continue;

          const result: StreamDelta = {};
          if (delta.content) result.text = delta.content;

          if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
            result.toolCalls = delta.tool_calls.map((tc: any) => ({
              index: tc.index,
              id: tc.id ?? "",
              name: tc.function?.name ?? "",
              arguments: tc.function?.arguments ?? "",
            }));
          }

          if (result.text || result.toolCalls) yield result;
        } catch {
          // 忽略解析失败的片段
        }
      }
    }
  }
}
```

#### 第 3 步：创建 Provider 工厂

新建 `src/provider/factory.ts`，根据配置创建对应的 Provider：

```ts
// src/provider/factory.ts
import { OpenAIProvider } from "./openai.js";
import type { Provider } from "./types.js";
import { providerConfig } from "../config.js";

/**
 * 根据配置创建 Provider 实例
 * 目前只有 OpenAI 兼容实现，后续可以加 switch-case 支持更多
 */
export function createProvider(): Provider {
  // 所有 OpenAI 兼容的厂商（DeepSeek、Qwen、GLM 等）都走这个
  return new OpenAIProvider({
    apiKey: providerConfig.apiKey,
    baseUrl: providerConfig.baseUrl,
    model: providerConfig.model,
  });
}
```

#### 第 4 步：改 config.ts，把 Provider 配置独立出来

```ts
// src/config.ts（修改后）
process.loadEnvFile();
import { z } from "zod";

const env = z
  .object({
    MINIHARNESS_API_KEY: z.string().min(1),
    MINIHARNESS_BASE_URL: z.string().url(),
    MINIHARNESS_MODEL: z.string().min(1),
    MINIHARNESS_PROVIDER: z.enum(["openai", "deepseek", "qwen", "ollama"]).default("openai"),
  })
  .parse(process.env);

export const providerConfig = {
  type: env.MINIHARNESS_PROVIDER,
  apiKey: env.MINIHARNESS_API_KEY,
  baseUrl: env.MINIHARNESS_BASE_URL,
  model: env.MINIHARNESS_MODEL,
};

// 工作目录等其他配置也放这里
export const workspaceConfig = {
  defaultWorkspace: process.cwd(),
};

// ChatMessage 类型建议移到 provider/types.ts
// 这里可以保留一个 re-export 兼容旧代码
export type { ChatMessage } from "./provider/types.js";
```

#### 第 5 步：改造 Agent Loop，依赖 Provider 接口

把 `src/agent/loop.ts` 里直接 import `chatWithTools` 的地方，改成接收一个 `provider` 参数：

```ts
// src/agent/loop.ts（关键修改点）
import type { Provider, ChatMessage } from "../provider/types.js";
import { toOpenAITools } from "../tools/registry.js";
import type { ToolContext } from "../tools/types.js";
// ... 其他 import

export interface LoopOptions {
  provider: Provider;          // ← 新增：注入 Provider
  onEvent?: (e: LoopEvent) => void;
  safetyOptions?: SafetyOptions;
  session?: Session;
  maxTurns?: number;           // ← 顺便把 MAX_ROUNDS 改成可配置
}

export async function runAgent(
  task: string,
  ctx: ToolContext,
  signal?: AbortSignal,
  opts: LoopOptions,
): Promise<AgentResult> {
  const { provider, maxTurns = 10 } = opts;
  // ... 其他初始化

  const tools = toOpenAITools();

  for (let round = 0; round < maxTurns; round++) {
    // ... 上下文压缩不变

    // 把原来的 chatWithTools(messages, tools, signal) 改成：
    const result = await provider.chat(messages, tools, signal);
    const { content, toolCalls: rawToolCalls, usage } = result;

    // ... 后续逻辑不变，toolCalls 用 rawToolCalls

    // 新增：把 usage 通过事件传出去（为 Phase 8.3 观测性做准备）
    if (usage) {
      opts.onEvent?.({ type: "usage", round, ...usage });
    }
  }
}
```

别忘了在 `LoopEvent` 类型里加上 `usage` 事件。

#### 第 6 步：改造入口 index.ts

```ts
// src/index.ts（关键修改点）
import { createProvider } from "./provider/factory.js";

const provider = createProvider();
const ctx = { workspace: process.cwd() };

// 在每个调用 runAgent 的地方，加上 provider
async function ask() {
  // ...
  const { answer } = await runAgent(question, ctx, ctrl.signal, {
    provider,
    onEvent: logEvent,
    session,
  });
  // ...
}

// chat / resume 同理，都加上 provider 参数
```

#### 第 7 步（可选）：加一个 Ollama Provider

如果你本地装了 Ollama，可以再写一个 `src/provider/ollama.ts` 来验证抽象是否正确。Ollama 也兼容 OpenAI 格式的 API，所以你只需要继承 OpenAIProvider 改一下 baseUrl 就行，或者直接在 `.env` 里把 `MINIHARNESS_BASE_URL` 指到 `http://localhost:11434/v1`。

### 验收标准

- [ ] 在 `.env` 里改 `MINIHARNESS_MODEL` 为另一个模型名（比如从 `deepseek-chat` 改成 `qwen-plus`，如果有 Qwen 的 key），Agent 能正常工作，代码一行不用改。
- [ ] `src/agent/loop.ts` 里没有直接 import `openai.ts`，只依赖 `provider/types.ts` 的接口。
- [ ] 新增一个 Provider 实现（比如 Ollama），只需要加一个文件 + 在 factory 里加一个 case，Agent Loop 完全不用动。

---

## Phase 8.3 成本与可观测性

**目标**：追踪每次 Agent 运行的 token 用量、花费、每轮耗时、工具调用情况，让你清楚知道「钱花在哪了、时间花在哪了」。

**你将学到**：指标收集模式、结构化日志、成本核算、性能剖析。

### 为什么要做

Agent 跑一次任务可能调用模型 10 轮 + 20 个工具，你需要知道：

- 这次任务花了多少钱？
- 哪一步最耗时？是模型推理还是工具执行？
- 哪个工具调用最多？
- 失败率多少？

没有这些数据，你优化就是「凭感觉」。

### 前置依赖

需要先完成 **8.2 多 Provider 抽象**（因为 `usage` 数据来自 Provider 层）。如果 Provider 返回了 `usage` 字段，就用精确值；没有就用 token 估算。

### 设计思路

在 Agent Loop 的各个关键节点埋点，收集数据，最后汇总成一个「运行报告」。

```
┌─────────────────────────────────────────┐
│              Agent Loop                 │
│                                         │
│  thinking ─► model ─► tool ─► tool ...  │
│     │          │        │               │
│     └─── 埋点 ──┴────────┘               │
│              │                          │
│              ▼                          │
│         Telemetry 收集器                │
│              │                          │
│              ▼                          │
│         运行报告 + 日志                  │
└─────────────────────────────────────────┘
```

### 具体步骤

#### 第 1 步：定义指标类型

新建 `src/telemetry/types.ts`：

```ts
export interface TurnMetrics {
  round: number;
  durationMs: number;              // 本轮总耗时
  modelDurationMs: number;         // 模型调用耗时
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  toolCalls: ToolCallMetrics[];
}

export interface ToolCallMetrics {
  name: string;
  durationMs: number;
  ok: boolean;
  safetyDecision: "allow" | "ask" | "deny";
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
```

#### 第 2 步：写 Telemetry 收集器

新建 `src/telemetry/collector.ts`：

```ts
// src/telemetry/collector.ts
import { estimateCostUsd } from "../eval/pricing.js"; // 复用 pricing
import type { RunMetrics, TurnMetrics, ToolCallMetrics } from "./types.js";

export class TelemetryCollector {
  private run: RunMetrics;
  private currentTurn?: TurnMetrics;
  private turnStart = 0;
  private modelStart = 0;
  private toolStart = 0;

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

  endModelCall(usage: { promptTokens: number; completionTokens: number; totalTokens: number }): void {
    if (this.currentTurn) {
      this.currentTurn.modelDurationMs = Date.now() - this.modelStart;
      this.currentTurn.promptTokens = usage.promptTokens;
      this.currentTurn.completionTokens = usage.completionTokens;
      this.currentTurn.totalTokens = usage.totalTokens;
    }
  }

  startToolCall(name: string): void {
    this.toolStart = Date.now();
    this.run.toolCallCount++;
  }

  endToolCall(name: string, ok: boolean, safetyDecision: "allow" | "ask" | "deny"): void {
    if (this.currentTurn) {
      this.currentTurn.toolCalls.push({
        name,
        durationMs: Date.now() - this.toolStart,
        ok,
        safetyDecision,
      });
    }
  }

  endTurn(): void {
    if (this.currentTurn) {
      this.currentTurn.durationMs = Date.now() - this.turnStart;
      this.run.turns.push(this.currentTurn);
      this.run.totalPromptTokens += this.currentTurn.promptTokens;
      this.run.totalCompletionTokens += this.currentTurn.completionTokens;
      this.run.totalTokens += this.currentTurn.totalTokens;
    }
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
```

#### 第 3 步：把 Telemetry 接入 Agent Loop

修改 `src/agent/loop.ts`，在关键位置调用 collector。

核心改动点：
- `LoopOptions` 加一个可选的 `telemetry?: TelemetryCollector`
- 每轮开始时 `collector.startTurn(round)`
- 调模型前后 `startModelCall()` / `endModelCall(usage)`
- 调工具前后 `startToolCall(name)` / `endToolCall(name, ok, decision)`
- 每轮结束 `collector.endTurn()`
- `AgentResult` 里加上 `metrics?: RunMetrics`

#### 第 4 步：在 CLI 里打印报告

修改 `src/index.ts`，在 `ask` / `chat` 命令结束后打印一个简洁的运行报告：

```ts
function printMetrics(metrics: RunMetrics) {
  console.error("\n─── 运行报告 ───");
  console.error(`总耗时: ${(metrics.totalDurationMs! / 1000).toFixed(1)}s`);
  console.error(`模型轮数: ${metrics.turns.length}`);
  console.error(`工具调用: ${metrics.toolCallCount} 次`);
  console.error(`Token 用量: ${metrics.totalTokens} (prompt: ${metrics.totalPromptTokens}, completion: ${metrics.totalCompletionTokens})`);
  console.error(`估算花费: $${metrics.estimatedCostUsd.toFixed(4)} USD`);

  // 最慢的 3 个工具调用
  const allTools = metrics.turns.flatMap((t) => t.toolCalls);
  const slowest = [...allTools].sort((a, b) => b.durationMs - a.durationMs).slice(0, 3);
  if (slowest.length > 0) {
    console.error("\n最慢工具 TOP3:");
    for (const t of slowest) {
      console.error(`  ${t.name}: ${t.durationMs}ms`);
    }
  }
}
```

### 验收标准

- [ ] 跑完一个任务后，CLI 末尾能看到「运行报告」：总耗时、轮数、token 用量、估算花费。
- [ ] 报告里能看到最慢的 3 个工具调用，帮你定位性能瓶颈。
- [ ] 估算的花费和实际 API 账单在同一个数量级（不用精确到分，数量级对就行）。
- [ ] 任务失败时也能输出报告，显示失败原因。

---

## Phase 8.4 MCP 协议支持

**目标**：接入 MCP（Model Context Protocol），让任何 MCP 服务器提供的工具都能被你的 Agent 即插即用。

**你将学到**：MCP 协议原理、Stdio 子进程通信、工具动态注册、JSON-RPC 协议。

### 什么是 MCP

MCP 是一个开放协议，用来让 AI 模型安全地访问外部工具和数据。简单说：

- **MCP 服务器**：提供工具的一方（比如「文件系统 MCP」「GitHub MCP」「数据库 MCP」）
- **MCP 客户端**：使用工具的一方（就是你的 Agent Harness）
- 双方通过 **JSON-RPC** 通信，传输层可以是 **Stdio**（子进程）或 **HTTP**

接入 MCP 后，你不用自己写各种工具了——社区里现成的 MCP 服务器直接就能用。

### 设计思路

```
┌──────────────┐
│  Agent Loop  │
└──────┬───────┘
       │ 使用工具
       ▼
┌──────────────┐         JSON-RPC over Stdio          ┌──────────────┐
│  Tool 注册表  │ ◄──────────────────────────────►   │  MCP 服务器  │
│ (本地+MCP)   │                                     │ (外部进程)   │
└──────────────┘                                     └──────────────┘
```

**关键设计**：MCP 工具和你自己写的本地工具，最终都注册到同一个 `ToolRegistry` 里，Agent Loop 完全感知不到区别。

### 具体步骤

#### 第 1 步：了解 MCP 协议的三个核心消息

MCP 基于 JSON-RPC 2.0，你只需要理解这几对请求/响应：

| 客户端 → 服务器 | 作用 |
|-----------------|------|
| `initialize` | 握手，协商协议版本和能力 |
| `tools/list` | 获取服务器提供的所有工具列表 |
| `tools/call` | 调用一个具体工具 |

先不用深究完整协议，能跑通这三个就够了。

#### 第 2 步：写 MCP 客户端基础类

新建 `src/mcp/client.ts`：

```ts
// src/mcp/client.ts
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export class MCPClient {
  private proc: ChildProcess;
  private pending = new Map<string, { resolve: (r: any) => void; reject: (e: Error) => void }>();
  private buffer = "";
  private initialized = false;

  constructor(private command: string, private args: string[] = []) {}

  /** 启动子进程并初始化 */
  async start(): Promise<void> {
    this.proc = spawn(this.command, this.args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.proc.stdout!.on("data", (chunk) => this.handleData(chunk.toString()));
    this.proc.stderr!.on("data", (chunk) => {
      console.error(`[MCP stderr] ${chunk.toString()}`);
    });

    // 握手：initialize
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "MiniHarness", version: "1.0.0" },
    });

    // 服务器发 initialized 通知后才算完成
    await this.request("notifications/initialized", {});
    this.initialized = true;
  }

  /** 获取工具列表 */
  async listTools(): Promise<MCPTool[]> {
    if (!this.initialized) throw new Error("MCP 未初始化");
    const result = await this.request("tools/list", {});
    return (result as any).tools as MCPTool[];
  }

  /** 调用工具 */
  async callTool(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }> {
    if (!this.initialized) throw new Error("MCP 未初始化");
    const result = await this.request("tools/call", { name, arguments: args });
    return result as any;
  }

  /** 关闭子进程 */
  stop(): void {
    this.proc.kill();
  }

  // ---------- 内部方法 ----------

  private request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = randomUUID();
    const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };

    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    this.proc.stdin!.write(JSON.stringify(request) + "\n");
    return promise;
  }

  private handleData(data: string): void {
    this.buffer += data;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as JsonRpcResponse;
        if (msg.id != null) {
          const pending = this.pending.get(String(msg.id));
          if (pending) {
            this.pending.delete(String(msg.id));
            if (msg.error) {
              pending.reject(new Error(`MCP error: ${msg.error.message}`));
            } else {
              pending.resolve(msg.result);
            }
          }
        }
      } catch (e) {
        console.error(`[MCP parse error] ${e}`);
      }
    }
  }
}
```

> **关于协议版本**：MCP 协议还在快速演进，`2024-11-05` 是一个常用的版本号。如果和你的 MCP 服务器不兼容，查一下对方文档用的版本。

#### 第 3 步：写 MCP 工具适配器

MCP 的工具和你本地的 `Tool` 接口不一样，需要一个适配器把 MCP 工具包装成本地 Tool：

新建 `src/mcp/tool-adapter.ts`：

```ts
// src/mcp/tool-adapter.ts
import type { Tool, ToolContext, ToolResult } from "../tools/types.js";
import { MCPClient } from "./client.js";

/**
 * 把一个 MCP 工具包装成 MiniHarness 的 Tool 接口
 * 这样 Agent Loop 完全感知不到工具是本地的还是 MCP 的
 */
export function createMCPTool(
  client: MCPClient,
  mcpTool: { name: string; description: string; inputSchema: Record<string, unknown> },
): Tool {
  return {
    name: `mcp__${mcpTool.name}`, // 加前缀避免和本地工具重名
    description: mcpTool.description,
    inputSchema: mcpTool.inputSchema,

    async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
      try {
        const result = await client.callTool(mcpTool.name, args);

        // MCP 返回的 content 是数组，可能有 text、image 等
        const textParts = result.content
          .filter((c) => c.type === "text" && c.text)
          .map((c) => c.text)
          .join("\n");

        if (result.isError) {
          return { ok: false, error: textParts || "MCP 工具执行失败" };
        }
        return { ok: true, output: textParts || "(无输出)" };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },
  };
}

/**
 * 从 MCP 服务器拉取所有工具并注册
 */
export async function registerMCPTools(
  client: MCPClient,
  registerFn: (tool: Tool) => void,
): Promise<void> {
  const tools = await client.listTools();
  for (const t of tools) {
    const adapted = createMCPTool(client, t);
    registerFn(adapted);
    console.error(`[MCP] 注册工具: ${adapted.name}`);
  }
}
```

#### 第 4 步：配置 MCP 服务器

在 `config.ts` 里加上 MCP 配置：

```ts
// .env 配置示例：
// MCP_SERVERS="fs:npx -y @modelcontextprotocol/server-filesystem ./"

export interface MCPServerConfig {
  name: string;
  command: string;
  args: string[];
}

export function parseMCPServers(configStr?: string): MCPServerConfig[] {
  if (!configStr) return [];
  return configStr.split(";").filter(Boolean).map((s) => {
    const [name, ...rest] = s.split(":");
    const full = rest.join(":");
    const parts = full.trim().split(/\s+/);
    return {
      name: name.trim(),
      command: parts[0] || "",
      args: parts.slice(1),
    };
  });
}
```

#### 第 5 步：在入口里启动 MCP

修改 `src/index.ts`，在注册工具的地方加上 MCP 工具。启动所有 MCP 服务器，把工具注册进注册表。

#### 第 6 步：安全策略适配 MCP 工具

MCP 工具名字带 `mcp__` 前缀，需要在安全策略里处理。MCP 工具默认走 `ask` 策略，因为不知道它会做什么。

### 验收标准

- [ ] 配置一个最简单的 MCP 服务器（比如 `@modelcontextprotocol/server-filesystem`），启动后 Agent 的工具列表里能看到 MCP 提供的工具。
- [ ] Agent 能调用 MCP 工具并拿到结果，流程和调用本地工具完全一样。
- [ ] 关掉 MCP 服务器，Agent 调用 MCP 工具会返回错误但不会崩溃。
- [ ] MCP 工具默认走 `ask` 权限策略，需要用户确认才能执行。

---

## Phase 8.5 子代理与任务分解

**目标**：让主 Agent 能把复杂任务拆分成子任务，派发给子 Agent 并行执行，最后汇总结果。

**你将学到**：任务分解模式、子代理编排、结果聚合、并行控制。

### 为什么要做

单个 Agent 处理复杂任务时容易「顾此失彼」——比如让它同时改 5 个文件，它可能改到第 3 个就忘了第 1 个的上下文。

子代理的思路是：

- **主 Agent**：负责理解任务、拆分子任务、分配工作、汇总结果
- **子 Agent**：负责执行具体的小任务，每个只关注一件事

这就像一个项目经理 + 多个工程师的团队协作。

### 前置依赖

- **8.2 多 Provider 抽象**（子 Agent 也需要调模型）
- **8.3 可观测性**（可选，但有了之后能看到子代理的开销）

### 设计思路

```
用户任务
   │
   ▼
┌──────────┐
│ 主 Agent  │  ── 分解任务 ──►  子任务列表: [A, B, C]
└────┬─────┘
     │
     ├──────────┬──────────┐
     ▼          ▼          ▼
┌────────┐ ┌────────┐ ┌────────┐
│子Agent A│ │子Agent B│ │子Agent C│   并行执行
│(子工具集)│ │(子工具集)│ │(子工具集)│
└───┬────┘ └───┬────┘ └───┬────┘
    │           │           │
    └───────────┼───────────┘
                ▼
         结果汇总给主 Agent
                │
                ▼
         主 Agent 输出最终答案
```

### 具体步骤

#### 第 1 步：定义子任务类型

新建 `src/agent/subagent/types.ts`：

```ts
export interface SubTask {
  id: string;
  title: string;
  description: string;
  dependencies: string[];  // 依赖哪些子任务的 id
  tools?: string[];        // 允许使用的工具名（不传则用全部）
}

export interface SubTaskResult {
  taskId: string;
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
}

export interface DecompositionResult {
  tasks: SubTask[];
  plan: string;
}
```

#### 第 2 步：写任务分解器

主 Agent 的第一个工作是「把大任务拆成小任务」。用一个专门的函数 + 专门的 system prompt 来做：

```ts
// src/agent/subagent/decomposer.ts
const DECOMPOSE_SYSTEM_PROMPT = `你是一个任务分解专家。你的职责是把用户的复杂任务拆分成可以并行执行的子任务。

规则：
1. 每个子任务应该是一个独立的、可验证的小目标
2. 子任务之间尽量减少依赖，能并行就并行
3. 如果有依赖关系，在 dependencies 字段里列出前置任务的 id
4. 子任务数量控制在 2-8 个之间
5. 每个子任务的 description 要写得足够具体
6. 只返回 JSON，不要任何其他文字`;
```

调用模型分解任务，解析返回的 JSON，得到子任务列表。

#### 第 3 步：写子 Agent 执行器

每个子任务由一个独立的子 Agent 来执行。复用你已有的 `runAgent`，但：
- 独立的消息历史（不污染主 Agent 的上下文）
- 可以限制可用工具
- 有最大轮数限制（子任务不需要太多轮）

#### 第 4 步：写编排器（按依赖关系执行）

编排器负责：
1. 按依赖关系排序子任务
2. 没有依赖的可以并行执行（控制最大并行数）
3. 把已完成子任务的结果传给后续子任务

核心是一个拓扑排序 + 有限并行的循环。

#### 第 5 步：写结果汇总器

所有子任务完成后，主 Agent 需要把结果汇总成一个最终回答。用另一个专门的 prompt 让模型做汇总。

#### 第 6 步：暴露给用户一个「子代理模式」

在 CLI 加一个命令，比如 `pnpm dev subagent "任务描述"`，触发子代理模式。

### 验收标准

- [ ] 给一个复杂任务（比如「给项目加一个新工具，同时更新 README 和测试」），子代理模式能正确分解为 2+ 个子任务。
- [ ] 没有依赖关系的子任务能并行执行（你能在日志里看到同时跑）。
- [ ] 有依赖关系的子任务会等前置任务完成后再开始。
- [ ] 最终汇总结果合理，包含所有子任务的关键信息。
- [ ] 某个子任务失败时，汇总结果里能清楚看到失败原因，不会整体崩溃。

---

## 写在最后

恭喜你读到这里！Phase 8 是从「demo」到「生产级」的关键一跃。

**几个真心建议**：

1. **先做 Eval，建立基线**：这是你所有后续改动的「度量衡」。
2. **不要贪多**：每个子阶段做完、跑通、验收过了，再进下一个。
3. **多 Provider 是地基**：后面的可观测性、子代理都建在它上面。
4. **成本意识**：跑评测、跑子代理都要花钱，记得设好上限。

等你把 Phase 8 都做完，你的 MiniHarness 就不再是「跟着教程写的玩具」了——它是一个有完整抽象、生态接入、可观测、可衡量的真正框架。

**慢慢来，比较快。** 🚀
