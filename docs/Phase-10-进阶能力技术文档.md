# Phase 10：从「工具调用器」到「编码工作流引擎」

> 参考 Claude Code 和 OpenCode 的核心能力，补齐编码 Agent 的工程化短板。
> 设计原则：轻量化（单文件实现）、可扩展（接口优先）、零新依赖（用 Node.js 标准库）。

---

## 总览

| 子阶段 | 核心内容 | 难度 | 参考来源 |
|--------|---------|------|---------|
| **10.1 Hook 系统** | PreToolUse / PostToolUse 生命周期钩子 | ⭐⭐ | Claude Code hooks.json |
| **10.2 项目记忆文件** | AGENTS.md 自动加载 + 压缩后重注入 | ⭐⭐ | Claude Code CLAUDE.md |
| **10.3 Git 集成工具** | auto-commit、commit-msg 生成、diff 摘要 | ⭐⭐ | Claude Code git workflow |
| **10.4 死循环检测与重试** | doom-loop 检测 + LLM 调用指数退避重试 | ⭐⭐⭐ | OpenCode doom_loop + retry |
| **10.5 自定义命令** | 用户定义 slash 命令 + 模板 | ⭐⭐ | OpenCode commands / Claude Code /commands |

### 依赖关系

```
10.1 Hook 系统（地基，后续都依赖它）
    │
    ├── 10.2 项目记忆文件
    ├── 10.3 Git 集成
    ├── 10.4 死循环检测与重试
    │       │
    └── 10.5 自定义命令
```

### 为什么是这 5 个

对比 Claude Code 和 OpenCode，MiniHarness 最大的工程化短板是：

1. **没有 Hook** → 无法插拔工具执行逻辑（审计、自动格式化、LSP 反馈都要改 loop.ts）
2. **没有项目记忆** → 每次会话都从零开始，不知道项目约定
3. **没有 Git 工具** → Agent 不能自动提交、生成 commit message
4. **没有死循环检测** → Agent 可能用相同参数反复调用同一个工具
5. **没有自定义命令** → 用户无法定义自己的工作流模板

---

## Phase 10.1 Hook 系统

**目标**：在工具执行前/后插入可插拔的钩子函数，不改 loop.ts 就能扩展行为。

**你将学到**：生命周期钩子设计、拦截器模式、事件 vs 钩子的区别。

### 为什么最先做

Hook 是后续所有阶段的基座：

- **被动反馈**（LSP 诊断）→ PostToolUse 钩子
- **自动格式化**→ PostToolUse 钩子
- **审计日志**→ PreToolUse + PostToolUse 钩子
- **工具限流**→ PreToolUse 钩子

### 设计思路：参考 Claude Code 的 hooks.json，但更轻量

Claude Code 用 shell 命令做钩子（配置文件驱动），MiniHarness 用 TypeScript 函数做钩子（代码驱动），更轻量、更类型安全。

| | Claude Code | MiniHarness |
|---|---|---|
| 钩子定义 | JSON 配置 + shell 命令 | TypeScript 函数注册 |
| 钩子类型 | command / prompt / notification | 函数（同步返回决策） |
| 触发时机 | PreToolUse / PostToolUse / Stop / SessionStart | PreToolUse / PostToolUse |
| 匹配方式 | regex matcher | 函数内自行判断 |

### 具体步骤

#### 第 1 步：定义 Hook 类型

新建 `src/hooks/types.ts`：

```ts
// src/hooks/types.ts
import type { ToolInvocation, Permission } from "../safety/types.ts";

export interface PreToolUseContext {
  toolName: string;
  args: Record<string, unknown>;
  workspace: string;
}

export interface PostToolUseContext {
  toolName: string;
  args: Record<string, unknown>;
  result: { ok: boolean; output?: string; error?: string };
  workspace: string;
}

export type HookAction =
  | { type: "continue" }
  | { type: "deny"; reason: string }
  | { type: "modify"; patch: Record<string, unknown> }
  | { type: "append"; extraOutput: string };

export type PreToolUseHook = (ctx: PreToolUseContext) => HookAction | Promise<HookAction>;
export type PostToolUseHook = (ctx: PostToolUseContext) => void | Promise<void>;
```

#### 第 2 步：Hook 注册表

新建 `src/hooks/registry.ts`：

```ts
// src/hooks/registry.ts
import type { PreToolUseHook, PostToolUseHook } from "./types.ts";

const preHooks: PreToolUseHook[] = [];
const postHooks: PostToolUseHook[] = [];

export function onPreToolUse(hook: PreToolUseHook) {
  preHooks.push(hook);
  return () => {
    const i = preHooks.indexOf(hook);
    if (i >= 0) preHooks.splice(i, 1);
  };
}

export function onPostToolUse(hook: PostToolUseHook) {
  postHooks.push(hook);
  return () => {
    const i = postHooks.indexOf(hook);
    if (i >= 0) postHooks.splice(i, 1);
  };
}

export async function runPreToolUse(ctx: {
  toolName: string;
  args: Record<string, unknown>;
  workspace: string;
}) {
  for (const hook of preHooks) {
    const action = await hook(ctx);
    if (action.type === "deny") return action;
    if (action.type === "modify") Object.assign(ctx.args, action.patch);
  }
  return { type: "continue" } as const;
}

export async function runPostToolUse(ctx: {
  toolName: string;
  args: Record<string, unknown>;
  result: { ok: boolean; output?: string; error?: string };
  workspace: string;
}) {
  for (const hook of postHooks) {
    await hook(ctx);
  }
}

export function clearHooks() {
  preHooks.length = 0;
  postHooks.length = 0;
}
```

#### 第 3 步：在 agent loop 中接入钩子

修改 `src/agent/loop.ts`，在工具执行前/后插入钩子调用：

```ts
// src/agent/loop.ts（在工具执行逻辑中追加）

import { runPreToolUse, runPostToolUse } from "../hooks/registry.ts";

// ... 在安全检查之后、工具执行之前：
const preAction = await runPreToolUse({ toolName, args, workspace });
if (preAction.type === "deny") {
  // 钩子拒绝了执行，构造一个失败结果
  const denyResult = { ok: false, error: `Hook denied: ${preAction.reason}` };
  onEvent?.({ type: "tool_result", name: toolName, ok: false, output: denyResult.error });
  messages.push({ role: "tool", tool_call_id: call.id, content: denyResult.error });
  continue;
}

// 执行工具（已有代码）
const result = await tool.execute(args, { workspace });

// 工具执行之后（已有结果之后追加）：
await runPostToolUse({ toolName, args, result, workspace });
```

#### 第 4 步：创建 barrel export

新建 `src/hooks/index.ts`：

```ts
// src/hooks/index.ts
export type { PreToolUseContext, PostToolUseContext, HookAction, PreToolUseHook, PostToolUseHook } from "./types.ts";
export { onPreToolUse, onPostToolUse, runPreToolUse, runPostToolUse, clearHooks } from "./registry.ts";
```

#### 第 5 步：内置审计日志钩子（示例）

在 `src/index.ts` 中注册一个审计钩子：

```ts
// src/index.ts（在 MCP 初始化之后追加）
import { onPostToolUse } from "./hooks/index.ts";

onPostToolUse(({ toolName, args, result, workspace }) => {
  const ts = new Date().toISOString();
  const status = result.ok ? "OK" : "FAIL";
  const detail = result.ok ? result.output?.slice(0, 80) : result.error?.slice(0, 80);
  console.error(`[audit] ${ts} ${toolName} ${status} ${detail ?? ""}`);
});
```

### 验收标准

- [ ] `onPreToolUse` 注册的钩子能在工具执行前被调用
- [ ] `PreToolUseHook` 返回 `{ type: "deny" }` 时阻止工具执行，Agent 收到拒绝原因
- [ ] `onPostToolUse` 注册的钩子能在工具执行后被调用
- [ ] 钩子注册函数返回取消注册函数，调用后钩子不再触发
- [ ] 审计钩子能记录每次工具调用的名称、结果状态、时间戳
- [ ] 不注册任何钩子时，agent loop 行为和之前完全一致

---

## Phase 10.2 项目记忆文件

**目标**：Agent 启动时自动读取 `AGENTS.md`，把项目约定注入系统提示词。

**你将学到**：上下文注入策略、分层记忆设计、压缩后重注入。

### 为什么做这个

Claude Code 的 CLAUDE.md 是它最实用的功能之一 [$TRAE_REF](https://code.claude.com/docs/en/memory)：

- 每次会话自动加载项目规则（代码风格、架构约定、禁止事项）
- 上下文压缩后从磁盘重新注入，不会丢失
- 支持路径特定规则

MiniHarness 目前每次会话都从零开始，Agent 不知道项目约定。

### 设计思路

| | Claude Code | MiniHarness |
|---|---|---|
| 文件名 | CLAUDE.md | AGENTS.md |
| 加载时机 | 会话启动 + 压缩后重注入 | 会话启动 + 压缩后重注入 |
| 大小限制 | 前 200 行 / 25KB | 前 100 行 / 10KB |
| 路径 | 项目根 + 父目录递归 | 仅项目根 |

### 具体步骤

#### 第 1 步：记忆加载器

新建 `src/agent/memory.ts`：

```ts
// src/agent/memory.ts
import { readFile } from "node:fs/promises";
import { existsFile } from "../session/store.ts";

const MAX_LINES = 100;
const MAX_BYTES = 10_000;

export async function loadProjectMemory(workspace: string): Promise<string> {
  const path = `${workspace}/AGENTS.md`;
  if (!await existsFile(path)) return "";

  try {
    let content = await readFile(path, "utf-8");
    const lines = content.split("\n");
    if (lines.length > MAX_LINES) {
      content = lines.slice(0, MAX_LINES).join("\n") + "\n...(AGENTS.md 已截断)";
    }
    if (content.length > MAX_BYTES) {
      content = content.slice(0, MAX_BYTES) + "\n...(AGENTS.md 已截断)";
    }
    return content.trim();
  } catch {
    return "";
  }
}

export function buildSystemPromptWithMemory(base: string, memory: string): string {
  if (!memory) return base;
  return `${base}

# 项目约定（来自 AGENTS.md）
${memory}`;
}
```

#### 第 2 步：在 agent loop 中注入

修改 `src/agent/loop.ts`：

```ts
// src/agent/loop.ts
import { loadProjectMemory, buildSystemPromptWithMemory } from "./memory.ts";

// 在构建系统消息时（循环外或首轮）：
const memory = await loadProjectMemory(workspace);
const fullSystemPrompt = buildSystemPromptWithMemory(SYSTEM_PROMPT, memory);
// 用 fullSystemPrompt 替代原来的 SYSTEM_PROMPT 构建 system 消息
```

#### 第 3 步：压缩后重注入

在 `src/agent/context.ts` 的 `truncate()` 函数中，压缩后重新加载 AGENTS.md：

```ts
// src/agent/context.ts
import { loadProjectMemory } from "./memory.ts";

// 在 truncate() 生成摘要后，重新注入 system 消息：
const memory = await loadProjectMemory(workspace);
const systemContent = memory
  ? `${SYSTEM_PROMPT}\n\n# 项目约定（来自 AGENTS.md）\n${memory}`
  : SYSTEM_PROMPT;
// 确保压缩后的消息列表以 system 消息开头
```

#### 第 4 步：创建 AGENTS.md 模板

在项目根目录创建 `AGENTS.md`：

```markdown
# MiniHarness 项目约定

## 代码风格
- TypeScript 严格模式，禁用 any
- 单文件实现，不建子目录（除非超过 200 行）
- 不加注释，除非逻辑非显而易见

## 架构规则
- 工具必须实现 Tool 接口，通过 register() 注册
- Provider 必须实现 Provider 接口，通过工厂创建
- 所有安全检查走 safety/policy.ts，不在工具内部硬编码

## 禁止事项
- 不引入新 npm 依赖（除 package.json 已有的）
- 不修改 .anvil/ 目录下的会话文件
- 不在工具内部调用其他工具（避免循环依赖）
```

### 验收标准

- [ ] 项目根目录有 `AGENTS.md` 时，系统提示词包含其内容
- [ ] 没有 `AGENTS.md` 时，系统提示词和之前一致
- [ ] AGENTS.md 超过 100 行时被截断，并标注 `...(已截断)`
- [ ] 上下文压缩后，AGENTS.md 内容被重新注入 system 消息
- [ ] Agent 能遵守 AGENTS.md 中的约定（如不用 any）

---

## Phase 10.3 Git 集成工具

**目标**：Agent 能查看 git 状态、生成 commit message、自动提交。

**你将学到**：Git CLI 封装、自然语言→结构化操作、diff 摘要生成。

### 为什么做这个

Claude Code 和 OpenCode 都有 Git 集成 [$TRAE_REF](https://code.claude.com/docs/en/settings)：

- 查看暂存状态 → `git status`
- 生成 commit message → 分析 diff + LLM 生成
- 自动提交 → `git commit`

MiniHarness 已有 `mcp__shell__shell_run` 可以执行 git 命令，但 Agent 需要自己拼命令字符串。封装成专用工具更安全、更高效。

### 设计思路：专用工具而非裸 shell

用 `mcp__shell__shell_run` 执行 git 问题是：Agent 需要知道 git 命令的参数，容易出错。封装成 `git-status`、`git-commit` 等专用工具，参数更简单，安全策略更精确。

### 具体步骤

#### 第 1 步：Git 工具集

新建 `src/tools/git-tools.ts`：

```ts
// src/tools/git-tools.ts
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { Tool, ToolContext } from "./types.ts";
import { register } from "./registry.ts";

const execP = promisify(exec);

async function git(args: string[], workspace: string) {
  const { stdout } = await execP(`git ${args.join(" ")}`, {
    cwd: workspace,
    timeout: 10_000,
    maxBuffer: 256 * 1024,
  });
  return stdout.trim();
}

const gitStatusTool: Tool = {
  name: "git-status",
  description: "查看 Git 工作区状态（精简版），返回已修改/已暂存/未跟踪文件列表。",
  inputSchema: { type: "object", properties: {} },
  async execute(_args: Record<string, unknown>, ctx: ToolContext) {
    try {
      const status = await git(["status", "--porcelain"], ctx.workspace);
      if (!status) return { ok: true, output: "工作区干净，无未提交变更。" };
      const lines = status.split("\n");
      const staged = lines.filter(l => l[0] !== " " && l[0] !== "?").map(l => l.slice(3));
      const modified = lines.filter(l => l[1] === "M").map(l => l.slice(3));
      const untracked = lines.filter(l => l[0] === "?").map(l => l.slice(3));
      const parts: string[] = [];
      if (staged.length) parts.push(`已暂存: ${staged.join(", ")}`);
      if (modified.length) parts.push(`已修改: ${modified.join(", ")}`);
      if (untracked.length) parts.push(`未跟踪: ${untracked.join(", ")}`);
      return { ok: true, output: parts.join("\n") || "无变更" };
    } catch (e) { return { ok: false, error: String(e) }; }
  },
};

const gitDiffTool: Tool = {
  name: "git-diff",
  description: "查看 Git 差异（已暂存或未暂存），返回 diff 内容。",
  inputSchema: {
    type: "object",
    properties: { staged: { type: "boolean", description: "是否查看已暂存的 diff，默认 true" } },
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext) {
    const { staged = true } = z.object({ staged: z.boolean().default(true) }).parse(args);
    try {
      const flag = staged ? "--cached" : "";
      let diff = await git(["diff", flag, "--stat"], ctx.workspace);
      if (!diff) return { ok: true, output: "无差异。" };
      const detail = await git(["diff", flag, "--"], ctx.workspace);
      const truncated = detail.length > 5000
        ? detail.slice(0, 5000) + `\n...(diff 截断，共 ${detail.length} 字符)`
        : detail;
      return { ok: true, output: `${diff}\n\n${truncated}` };
    } catch (e) { return { ok: false, error: String(e) }; }
  },
};

const gitCommitTool: Tool = {
  name: "git-commit",
  description: "提交已暂存的变更。需要 commit message。执行 git add -A + git commit。",
  inputSchema: {
    type: "object",
    properties: { message: { type: "string", description: "Commit message" } },
    required: ["message"],
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext) {
    const { message } = z.object({ message: z.string().min(1) }).parse(args);
    try {
      await git(["add", "-A"], ctx.workspace);
      const result = await git(["commit", "-m", `"${message.replace(/"/g, '\\"')}"`], ctx.workspace);
      return { ok: true, output: result };
    } catch (e) { return { ok: false, error: String(e) }; }
  },
};

export function registerGitTools() {
  register(gitStatusTool);
  register(gitDiffTool);
  register(gitCommitTool);
}
```

#### 第 2 步：注册并更新安全策略

修改 `src/index.ts`：

```ts
import { registerGitTools } from "./tools/git-tools.ts";

registerFileTools();
registerGitTools();
```

修改 `src/safety/policy.ts`：

```ts
const DEFAULT_POLICY: Record<string, Permission> = {
    // ... 已有策略
    "git-status": "allow",     // 只读，放行
    "git-diff": "allow",       // 只读，放行
    "git-commit": "ask",       // 写操作，需确认
};
```

#### 第 3 步：更新系统提示词

在 `src/agent/system-prompt.ts` 追加工具说明：

```ts
// 在可用工具列表追加：
// - git-status：查看工作区状态
// - git-diff：查看代码差异
// - git-commit：暂存并提交变更（需要 commit message）

// 在工作规则追加：
// 改完代码后用 git-status 查看变更，用 git-diff 确认内容，最后用 git-commit 提交
```

### 验收标准

- [ ] `git-status` 能正确返回工作区文件状态
- [ ] `git-diff` 能返回已暂存/未暂存的 diff 内容
- [ ] `git-commit` 能执行 `git add -A + git commit -m "message"`
- [ ] 安全策略生效：git-status/git-diff 为 allow，git-commit 为 ask
- [ ] Agent 能自动生成 commit message 并提交

---

## Phase 10.4 死循环检测与重试

**目标**：防止 Agent 用相同参数反复调用同一工具，并对 LLM 调用失败自动重试。

**你将学到**：调用指纹、指数退避、断路器模式。

### 为什么做这个

OpenCode 有 `doom_loop` 权限：同一工具以相同参数调用 3 次后触发 [$TRAE_REF](https://opencode.ai/docs/permissions)。Claude Code 也有类似的循环检测。

MiniHarness 的 Agent 循环目前没有这个保护——如果模型卡在某个错误上，会无限重试（直到 10 轮上限）。

### 具体步骤

#### 第 1 步：死循环检测器

新建 `src/agent/loop-guard.ts`：

```ts
// src/agent/loop-guard.ts
interface CallRecord {
  toolName: string;
  argHash: string;
  count: number;
  lastAttempt: number;
}

const MAX_REPEAT = 3;
const WINDOW_MS = 60_000; // 1 分钟窗口
const records: CallRecord[] = [];

function hashArgs(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args, Object.keys(args).sort());
  } catch {
    return JSON.stringify(args);
  }
}

export function checkLoop(toolName: string, args: Record<string, unknown>): { blocked: boolean; reason?: string } {
  const hash = hashArgs(args);
  const now = Date.now();
  const existing = records.find(r => r.toolName === toolName && r.argHash === hash);

  if (existing) {
    if (now - existing.lastAttempt > WINDOW_MS) {
      existing.count = 1;
      existing.lastAttempt = now;
      return { blocked: false };
    }
    existing.count++;
    existing.lastAttempt = now;
    if (existing.count >= MAX_REPEAT) {
      return { blocked: true, reason: `工具 ${toolName} 以相同参数连续调用 ${existing.count} 次，疑似死循环。请改变策略或参数。` };
    }
  } else {
    records.push({ toolName, argHash: hash, count: 1, lastAttempt: now });
  }
  return { blocked: false };
}

export function resetLoopGuard() {
  records.length = 0;
}
```

#### 第 2 步：在 agent loop 中接入

修改 `src/agent/loop.ts`：

```ts
// src/agent/loop.ts
import { checkLoop } from "./loop-guard.ts";

// 在工具执行之前（安全检查之后）：
const loopCheck = checkLoop(toolName, args);
if (loopCheck.blocked) {
  const msg = loopCheck.reason!;
  onEvent?.({ type: "tool_result", name: toolName, ok: false, output: msg });
  messages.push({ role: "tool", tool_call_id: call.id, content: msg });
  continue;
}
```

#### 第 3 步：LLM 调用重试

新建 `src/agent/retry.ts`：

```ts
// src/agent/retry.ts
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

export async function withRetry<T>(
  fn: () => Promise<T>,
  shouldRetry: (e: unknown) => boolean = () => true,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt === MAX_RETRIES || !shouldRetry(e)) throw e;
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}

export function isRetryableError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /timeout|rate.?limit|429|503|ECONNRESET|ECONNREFUSED/i.test(msg);
}
```

#### 第 4 步：在 provider 调用处接入重试

修改 `src/agent/loop.ts` 中流式调用的部分：

```ts
// src/agent/loop.ts
import { withRetry, isRetryableError } from "./retry.ts";

// 包裹 streamChat 调用：
const stream = await withRetry(
  () => provider.streamChat(messages, { model, tools: toolDefs, signal }),
  isRetryableError,
);
```

### 验收标准

- [ ] 同一工具以相同参数连续调用 3 次后，第 4 次被拦截，Agent 收到死循环提示
- [ ] 超过 1 分钟窗口后，相同参数调用不被拦截
- [ ] LLM 调用超时/限流时，自动重试最多 3 次
- [ ] 重试间隔为指数退避（1s → 2s → 4s）
- [ ] 非重试错误（如参数错误）不会触发重试

---

## Phase 10.5 自定义命令

**目标**：用户可以定义 slash 命令（如 `/test`、`/review`），扩展 Agent 的工作流。

**你将学到**：命令模板系统、动态加载、提示词模板。

### 为什么做这个

Claude Code 有 `/commands`，OpenCode 有 `.opencode/commands/` [$TRAE_REF](https://opencode.ai/docs/commands)。用户可以定义自己的工作流：

- `/test` → "运行测试，分析失败原因，自动修复"
- `/review` → "审查当前 diff，提出改进建议"
- `/deploy` → "构建项目，部署到 staging"

MiniHarness 的 REPL 已有 `:exit` 等内置命令，但没有用户自定义命令的机制。

### 设计思路

| | Claude Code | OpenCode | MiniHarness |
|---|---|---|---|
| 命令文件 | `.claude/commands/*.md` | `.opencode/commands/*.md` | `.anvil/commands/*.md` |
| 格式 | Markdown + frontmatter | Markdown + frontmatter | Markdown（纯提示词模板） |
| 参数 | `$ARGUMENTS` | `$ARGUMENTS` | `$ARGS` |
| 触发 | `/command-name` | `/command-name` | `:command-name` |

### 具体步骤

#### 第 1 步：命令加载器

新建 `src/cli/commands.ts`：

```ts
// src/cli/commands.ts
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface CustomCommand {
  name: string;
  prompt: string;
}

const COMMANDS_DIR = ".anvil/commands";

export async function loadCustomCommands(workspace: string): Promise<Map<string, CustomCommand>> {
  const dir = join(workspace, COMMANDS_DIR);
  const commands = new Map<string, CustomCommand>();
  try {
    const files = await readdir(dir);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const name = file.slice(0, -3);
      const content = await readFile(join(dir, file), "utf-8");
      commands.set(name, { name, prompt: content.trim() });
    }
  } catch {
    // 目录不存在或读取失败，返回空 Map
  }
  return commands;
}

export function formatCommandPrompt(cmd: CustomCommand, args: string): string {
  return cmd.prompt.replaceAll("$ARGS", args);
}
```

#### 第 2 步：在 REPL 中集成

修改 `src/cli/repl.ts`：

```ts
// src/cli/repl.ts
import { loadCustomCommands, formatCommandPrompt } from "./commands.ts";

// 在 REPL 初始化时加载命令：
const customCommands = await loadCustomCommands(workspace);

// 在命令解析逻辑中（处理 `:xxx` 的地方）追加：
const colonIdx = input.indexOf(":");
if (colonIdx === 0) {
  const [cmdName, ...rest] = input.slice(1).split(" ");
  if (customCommands.has(cmdName)) {
    const cmd = customCommands.get(cmdName)!;
    const userArgs = rest.join(" ");
    const prompt = formatCommandPrompt(cmd, userArgs);
    // 用 prompt 作为 user message 发给 agent
    await runAgent(prompt, provider, ctx, signal, { onEvent, session });
    continue;
  }
}
```

#### 第 3 步：创建示例命令

创建 `.anvil/commands/test.md`：

```markdown
运行项目的测试套件（pnpm test），分析任何失败的测试用例。

如果有测试失败：
1. 读取失败的测试文件
2. 分析失败原因（断言不匹配、超时、异常等）
3. 提出修复建议

参数: $ARGS
```

创建 `.anvil/commands/review.md`：

```markdown
审查当前的 Git 差异（git-diff），从以下角度分析：

1. 代码质量：命名、结构、可读性
2. 潜在 bug：边界条件、空值处理、类型安全
3. 安全性：输入验证、路径穿越、命令注入
4. 性能：不必要的循环、重复计算

输出格式：按严重程度排序的问题列表。
```

### 验收标准

- [ ] `.anvil/commands/` 目录下的 `.md` 文件被识别为自定义命令
- [ ] 在 REPL 中输入 `:test` 能触发对应命令的提示词
- [ ] `:test 运行所有测试` 中的 "运行所有测试" 替换 `$ARGS`
- [ ] 不存在的命令给出提示而非崩溃
- [ ] 命令文件修改后重新进入 REPL 能加载最新内容
