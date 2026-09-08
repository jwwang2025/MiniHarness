# Phase 9：从「框架」到「编码工作流引擎」（含代码）

> 参考 Claude Code 和 OpenCode 的核心能力，合并原 Phase 9 和 Phase 10 的内容
> 原则：轻量化（代码简洁不冗余，可以建子目录）、可扩展（接口优先）、零新依赖
> 前置条件：已完成 Phase 0-8

---

## 目录

- [总览](#总览)
- [9.1 Hook 生命周期系统](#91-hook-生命周期系统)
- [9.2 项目记忆文件](#92-项目记忆文件)
- [9.3 增强工具集（MCP 复用）](#93-增强工具集mcp-复用)
- [9.4 Git 集成工具](#94-git-集成工具)
- [9.5 死循环检测与重试](#95-死循环检测与重试)
- [9.6 自定义命令](#96-自定义命令)
- [9.7 自动测试与修复循环](#97-自动测试与修复循环)
- [9.8 HTTP API 服务](#98-http-api-服务)

---

## 总览

Phase 8 完成后，MiniHarness 有了完整骨架。对比 Claude Code 和 OpenCode，核心短板是：

| 缺什么 | 做了之后 | 参考来源 |
|--------|---------|---------|
| 没有 Hook，无法插拔工具逻辑 | 不改 loop.ts 就能扩展审计/格式化/诊断 | Claude Code hooks [$TRAE_REF](https://code.claude.com/docs/en/hooks-guide) |
| 每次会话从零开始，不知道项目约定 | AGENTS.md 自动加载+压缩后重注入 | Claude Code CLAUDE.md [$TRAE_REF](https://code.claude.com/docs/en/memory) |
| 只有 read/write/list，没法搜索代码 | MCP filesystem 搜索+编辑+shell 执行 | OpenCode tools [$TRAE_REF](https://opencode.ai/docs/tools) |
| Agent 不能自动提交代码 | git-status / git-diff / git-commit | Claude Code git workflow |
| Agent 可能死循环，API 失败不重试 | doom-loop 检测 + 指数退避重试 | OpenCode doom_loop [$TRAE_REF](https://opencode.ai/docs/permissions) |
| 用户无法定义自己的工作流 | `:test` `:review` 等自定义命令 | OpenCode commands [$TRAE_REF](https://opencode.ai/docs/commands) |
| 改完代码不知道对不对 | Agent 自己跑测试、分析失败、自动修复 | Claude Code auto-test |
| 只能命令行用，没法集成到其他系统 | HTTP API，SSE 流式输出 | OpenCode client/server |

### 子阶段依赖关系

```
9.1 Hook 系统 ← 地基，后续都依赖
    │
    ├── 9.2 项目记忆（Hook: SessionStart 加载）
    ├── 9.3 增强工具集（Hook: PostToolUse 诊断）
    ├── 9.4 Git 工具
    ├── 9.5 死循环检测（Hook: PreToolUse 拦截）
    │
    └── 9.6 自定义命令
            │
            └── 9.7 自动测试与修复
                    │
                    └── 9.8 HTTP API
```

### 建议顺序

9.1 必须先做（后续阶段都通过 Hook 接入）。9.2-9.5 可以并行。9.6-9.8 按顺序。

---

## 9.1 Hook 生命周期系统

**目标**：在工具执行前/后插入可插拔的钩子函数。

**参考**：Claude Code 的 PreToolUse/PostToolUse [$TRAE_REF](https://code.claude.com/docs/en/hooks-guide)，OpenCode 的 `tool.execute.before`/`tool.execute.after`。

### 设计思路

Claude Code 用 shell 命令做钩子（JSON 配置驱动），MiniHarness 用 TypeScript 函数做钩子（代码驱动），更轻量、更类型安全。OpenCode 的钩子接口返回可修改的 output 对象 [$TRAE_REF](https://opencode.ai/docs/plugins)，MiniHarness 借鉴这个设计。

### 具体步骤

#### 第 1 步：定义类型

新建 `src/hooks/types.ts`：

```ts
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

#### 第 2 步：注册表

新建 `src/hooks/registry.ts`：

```ts
import type { PreToolUseHook, PostToolUseHook, HookAction } from "./types.ts";

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
}): Promise<HookAction> {
  for (const hook of preHooks) {
    const action = await hook(ctx);
    if (action.type === "deny") return action;
    if (action.type === "modify") Object.assign(ctx.args, action.patch);
  }
  return { type: "continue" };
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

#### 第 3 步：Barrel export

新建 `src/hooks/index.ts`：

```ts
export type { PreToolUseContext, PostToolUseContext, HookAction, PreToolUseHook, PostToolUseHook } from "./types.ts";
export { onPreToolUse, onPostToolUse, runPreToolUse, runPostToolUse, clearHooks } from "./registry.ts";
```

#### 第 4 步：在 agent loop 中接入

修改 `src/agent/loop.ts`，在工具执行前/后插入钩子调用：

```ts
import { runPreToolUse, runPostToolUse } from "../hooks/index.ts";

// 在安全检查之后、工具执行之前：
const preAction = await runPreToolUse({ toolName, args, workspace });
if (preAction.type === "deny") {
  const msg = `Hook denied: ${preAction.reason}`;
  onEvent?.({ type: "tool_result", name: toolName, ok: false, output: msg });
  messages.push({ role: "tool", tool_call_id: call.id, content: msg });
  continue;
}

// 执行工具（已有代码）
const result = await tool.execute(args, { workspace });

// 工具执行之后
await runPostToolUse({ toolName, args, result, workspace });
```

#### 第 5 步：审计钩子示例

在 `src/index.ts` 中注册：

```ts
import { onPostToolUse } from "./hooks/index.ts";

onPostToolUse(({ toolName, result }) => {
  const ts = new Date().toISOString();
  const status = result.ok ? "OK" : "FAIL";
  const detail = result.ok ? result.output?.slice(0, 80) : result.error?.slice(0, 80);
  console.error(`[audit] ${ts} ${toolName} ${status} ${detail ?? ""}`);
});
```

### 验收标准

- [ ] `onPreToolUse` 返回 `{ type: "deny" }` 时阻止执行，Agent 收到原因
- [ ] `onPostToolUse` 在工具执行后被调用
- [ ] 钩子注册返回取消函数，调用后不再触发
- [ ] 不注册任何钩子时，行为和之前完全一致

---

## 9.2 项目记忆文件

**目标**：Agent 启动时自动读取 `AGENTS.md`，把项目约定注入系统提示词。

**参考**：Claude Code 的 CLAUDE.md [$TRAE_REF](https://code.claude.com/docs/en/memory)。Claude Code 在会话启动时加载 CLAUDE.md，压缩后通过 SessionStart 钩子重新注入。

### 设计思路

| | Claude Code | MiniHarness |
|---|---|---|
| 文件名 | CLAUDE.md | AGENTS.md |
| 加载时机 | 会话启动 + 压缩后重注入 | 同左 |
| 大小限制 | 200 行 / 25KB | 100 行 / 10KB |
| 注入位置 | system prompt 尾部 | 同左 |

### 具体步骤

#### 第 1 步：记忆加载器

新建 `src/agent/memory.ts`：

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const MAX_LINES = 100;
const MAX_BYTES = 10_000;

export async function loadProjectMemory(workspace: string): Promise<string> {
  const path = join(workspace, "AGENTS.md");
  try {
    let content = await readFile(path, "utf-8");
    const lines = content.split("\n");
    if (lines.length > MAX_LINES)
      content = lines.slice(0, MAX_LINES).join("\n") + "\n...(AGENTS.md 已截断)";
    if (content.length > MAX_BYTES)
      content = content.slice(0, MAX_BYTES) + "\n...(AGENTS.md 已截断)";
    return content.trim();
  } catch {
    return "";
  }
}

export function buildSystemPromptWithMemory(base: string, memory: string): string {
  return memory ? `${base}\n\n# 项目约定（来自 AGENTS.md）\n${memory}` : base;
}
```

#### 第 2 步：在 agent loop 中注入

修改 `src/agent/loop.ts`：

```ts
import { loadProjectMemory, buildSystemPromptWithMemory } from "./memory.ts";

// 首轮构建 system 消息时：
const memory = await loadProjectMemory(workspace);
const fullSystemPrompt = buildSystemPromptWithMemory(SYSTEM_PROMPT, memory);
// 用 fullSystemPrompt 替代 SYSTEM_PROMPT
```

#### 第 3 步：压缩后重注入

修改 `src/agent/context.ts` 的 `truncate()` 函数：

```ts
import { loadProjectMemory, buildSystemPromptWithMemory } from "./memory.ts";
import { SYSTEM_PROMPT } from "./system-prompt.ts";

// 压缩后重新加载 AGENTS.md，确保 system 消息包含项目约定
const memory = await loadProjectMemory(workspace);
const systemContent = buildSystemPromptWithMemory(SYSTEM_PROMPT, memory);
// 压缩后的消息列表以 system 消息开头
```

#### 第 4 步：创建 AGENTS.md

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
- 所有安全检查走 safety/policy.ts

## 禁止事项
- 不引入新 npm 依赖
- 不修改 .anvil/ 目录下的会话文件
```

### 验收标准

- [ ] 有 AGENTS.md 时，系统提示词包含其内容
- [ ] 没有 AGENTS.md 时，系统提示词和之前一致
- [ ] AGENTS.md 超过 100 行被截断并标注
- [ ] 上下文压缩后，AGENTS.md 被重新注入

---

## 9.3 增强工具集（MCP 复用）

**目标**：补齐搜索、精确编辑、shell 执行，全部通过 MCP 配置实现，零手写代码。

**参考**：OpenCode 内置 grep/glob/bash/edit 工具 [$TRAE_REF](https://opencode.ai/docs/tools)，但 MiniHarness 已有 MCP 协议，直接复用更轻量。

### 设计思路

| 能力 | MCP 服务器 | 工具名 | 状态 |
|------|-----------|--------|------|
| 搜索代码 | @modelcontextprotocol/server-filesystem | `mcp__fs__search_files` | 已配置 |
| 精确编辑 | @modelcontextprotocol/server-filesystem | `mcp__fs__edit_file` | 已配置 |
| 执行命令 | local-terminal-mcp | `mcp__shell__shell_run` | 新增 |

### 具体步骤

#### 第 1 步：配置 .env

修改 `.env`，在 `MINIHARNESS_MCP_SERVERS` 中追加 shell 服务器：

```env
MINIHARNESS_MCP_SERVERS="fs:npx -y @modelcontextprotocol/server-filesystem .;
mem:npx -y @modelcontextprotocol/server-memory|MEMORY_FILE_PATH=${workspace}/.anvil/mcp-memory.jsonl;
shell:npx -y local-terminal-mcp|ALLOW_COMMANDS=^ls,^cat,^pwd,^grep,^wc,^find,^node,^npx,^pnpm,^tsc,^git,^mkdir,^cp,^mv"
```

#### 第 2 步：配置安全策略

修改 `src/safety/policy.ts` 的 `DEFAULT_POLICY`：

```ts
const DEFAULT_POLICY: Record<string, Permission> = {
    "read-file": "allow",
    "list-files": "allow",
    "write-file": "ask",
    "edit-file": "ask",
    "run-shell": "ask",
    // MCP filesystem
    "mcp__fs__search_files": "allow",
    "mcp__fs__list_directory": "allow",
    "mcp__fs__read_file": "allow",
    "mcp__fs__get_file_info": "allow",
    "mcp__fs__write_file": "ask",
    "mcp__fs__edit_file": "ask",
    "mcp__fs__create_directory": "ask",
    "mcp__fs__move_file": "ask",
    // MCP memory
    "mcp__mem__read_entities": "allow",
    "mcp__mem__read_graph": "allow",
    "mcp__mem__search_nodes": "allow",
    "mcp__mem__open_nodes": "allow",
    "mcp__mem__create_entities": "ask",
    "mcp__mem__create_relations": "ask",
    "mcp__mem__add_observations": "ask",
    "mcp__mem__delete_entities": "ask",
    "mcp__mem__delete_relations": "ask",
    "mcp__mem__delete_observations": "ask",
    // MCP shell
    "mcp__shell__shell_run": "ask",
    "mcp__shell__check_command": "allow",
    "mcp__shell__list_rules": "allow",
    "mcp__shell__reload_config": "ask",
};
```

#### 第 3 步：为 shell_run 添加危险命令拦截

在 `src/safety/policy.ts` 的 `checkPolicy()` 中追加：

```ts
if(toolName === "mcp__shell__shell_run" && typeof args.command === "string") {
    const danger = isDangerousCommand(args.command);
    if(danger) {
        logger?.({ kind: "deny", tool: toolName, reason: `命中危险模式：${danger}` });
        return "deny";
    }
}
```

#### 第 4 步：更新系统提示词

修改 `src/agent/system-prompt.ts`：

```ts
export const SYSTEM_PROMPT = `你是一个编码 Agent，工作在一个受限工作区内。

可用工具：
- read-file / list-dir：内置文件读取和目录列表
- write-file：创建或覆盖文件
- mcp__fs__search_files：正则搜索文件内容，返回文件路径和匹配行
- mcp__fs__edit_file：精确编辑文件（替换指定文本，不覆盖整个文件）
- mcp__fs__read_file / mcp__fs__list_directory：MCP 版本的文件读取和目录列表
- mcp__shell__shell_run：执行 shell 命令（有安全限制，危险命令会被拦截）
- mcp__mem__*：跨会话记忆工具

工作规则：
1. 改文件前必须先 read-file 或 mcp__fs__read_file 确认当前内容
2. 小范围修改优先用 mcp__fs__edit_file，大范围重写才用 write-file
3. 找代码定义用 mcp__fs__search_files，不要一个个文件翻
4. 改完代码可以用 mcp__shell__shell_run 跑测试或格式化
5. 工具失败时分析原因再重试，不要盲目重复
6. 任务完成后用一句话总结结果

工具结果会被裁剪以节省上下文，省略部分用 [...省略 N 行...] 标记。`;
```

### 验收标准

- [ ] 启动时控制台显示 `[MCP] shell: N 个工具就绪`
- [ ] `mcp__fs__search_files` 能搜索整个 src 目录
- [ ] `mcp__fs__edit_file` 能精确替换文件文本
- [ ] `mcp__shell__shell_run` 能执行 `pnpm test`
- [ ] 不在白名单的命令（如 `rm`）被拒绝
- [ ] 安全策略生效（搜索 allow，shell ask）

---

## 9.4 Git 集成工具

**目标**：Agent 能查看 git 状态、生成 commit message、自动提交。

**参考**：Claude Code 的 git workflow，OpenCode 的 `/undo`/`/redo`。

### 具体步骤

#### 第 1 步：Git 工具集

新建 `src/tools/git-tools.ts`：

```ts
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { Tool, ToolContext } from "./types.ts";
import { register } from "./registry.ts";

const execP = promisify(exec);

async function git(args: string[], workspace: string) {
  const { stdout } = await execP(`git ${args.join(" ")}`, {
    cwd: workspace, timeout: 10_000, maxBuffer: 256 * 1024,
  });
  return stdout.trim();
}

const gitStatusTool: Tool = {
  name: "git-status",
  description: "查看 Git 工作区状态，返回已暂存/已修改/未跟踪文件列表。",
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
      const stat = await git(["diff", flag, "--stat"], ctx.workspace);
      if (!stat) return { ok: true, output: "无差异。" };
      const detail = await git(["diff", flag, "--"], ctx.workspace);
      const truncated = detail.length > 5000
        ? detail.slice(0, 5000) + `\n...(diff 截断，共 ${detail.length} 字符)` : detail;
      return { ok: true, output: `${stat}\n\n${truncated}` };
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
    // ... 已有
    "git-status": "allow",
    "git-diff": "allow",
    "git-commit": "ask",
};
```

#### 第 3 步：更新系统提示词

在 `src/agent/system-prompt.ts` 追加：

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
- [ ] `git-diff` 能返回已暂存/未暂存的 diff
- [ ] `git-commit` 能执行 `git add -A + git commit -m "message"`
- [ ] 安全策略生效：git-status/git-diff 为 allow，git-commit 为 ask

---

## 9.5 死循环检测与重试

**目标**：防止 Agent 用相同参数反复调用同一工具，LLM 调用失败自动重试。

**参考**：OpenCode 的 doom_loop（3 次触发）[$TRAE_REF](https://opencode.ai/docs/permissions)，OpenCode 的双层重试架构（SDK 层 + session 层指数退避）。

### 设计思路

OpenCode 的 `doom_loop` 本质是一个特殊 permission name，检测逻辑由工具调用层产生请求 [$TRAE_REF](https://opencode.ai/docs/permissions)。MiniHarness 简化为直接在 PreToolUse 钩子中检测。

OpenCode 的重试是双层：SDK 默认重试 2 次 + session 层指数退避 5 次 [$TRAE_REF](https://opencode.ai/docs/permissions)。MiniHarness 简化为单层指数退避 3 次。

### 具体步骤

#### 第 1 步：死循环检测器

新建 `src/agent/loop-guard.ts`：

```ts
interface CallRecord {
  toolName: string;
  argHash: string;
  count: number;
  lastAttempt: number;
}

const MAX_REPEAT = 3;
const WINDOW_MS = 60_000;
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

#### 第 2 步：通过 Hook 接入死循环检测

在 `src/index.ts` 中注册为 PreToolUse 钩子：

```ts
import { onPreToolUse } from "./hooks/index.ts";
import { checkLoop } from "./agent/loop-guard.ts";

onPreToolUse(({ toolName, args }) => {
  const loop = checkLoop(toolName, args);
  if (loop.blocked) return { type: "deny", reason: loop.reason! };
  return { type: "continue" };
});
```

#### 第 3 步：LLM 调用重试

新建 `src/agent/retry.ts`：

```ts
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

#### 第 4 步：在 provider 调用处接入

修改 `src/agent/loop.ts`：

```ts
import { withRetry, isRetryableError } from "./retry.ts";

const stream = await withRetry(
  () => provider.streamChat(messages, { model, tools: toolDefs, signal }),
  isRetryableError,
);
```

### 验收标准

- [ ] 同一工具以相同参数连续调用 3 次后，第 4 次被拦截
- [ ] 超过 1 分钟窗口后，相同参数调用不被拦截
- [ ] LLM 调用超时/限流时，自动重试最多 3 次
- [ ] 重试间隔为指数退避（1s → 2s → 4s）
- [ ] 非重试错误不触发重试

---

## 9.6 自定义命令

**目标**：用户可以定义 `:test` `:review` 等命令，扩展 Agent 的工作流。

**参考**：Claude Code 的 `.claude/commands/*.md` [$TRAE_REF](https://code.claude.com/docs/en/sdk/sdk-slash-commands)，OpenCode 的 `.opencode/commands/*.md` [$TRAE_REF](https://opencode.ai/docs/commands)。

### 设计思路

| | Claude Code | OpenCode | MiniHarness |
|---|---|---|---|
| 目录 | `.claude/commands/` | `.opencode/commands/` | `.anvil/commands/` |
| 格式 | Markdown + frontmatter | Markdown + frontmatter | 纯 Markdown |
| 参数 | `$ARGUMENTS` | `$ARGUMENTS` | `$ARGS` |
| 触发 | `/command` | `/command` | `:command` |

### 具体步骤

#### 第 1 步：命令加载器

新建 `src/cli/commands.ts`：

```ts
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
  } catch { /* 目录不存在，返回空 Map */ }
  return commands;
}

export function formatCommandPrompt(cmd: CustomCommand, args: string): string {
  return cmd.prompt.replaceAll("$ARGS", args);
}
```

#### 第 2 步：在 REPL 中集成

修改 `src/cli/repl.ts`：

```ts
import { loadCustomCommands, formatCommandPrompt } from "./commands.ts";

// 在 REPL 初始化时加载命令：
const customCommands = await loadCustomCommands(workspace);

// 在 `:xxx` 命令解析中追加：
const colonIdx = input.indexOf(":");
if (colonIdx === 0) {
  const [cmdName, ...rest] = input.slice(1).split(" ");
  if (customCommands.has(cmdName)) {
    const cmd = customCommands.get(cmdName)!;
    const userArgs = rest.join(" ");
    const prompt = formatCommandPrompt(cmd, userArgs);
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

- [ ] `.anvil/commands/*.md` 被识别为自定义命令
- [ ] 输入 `:test` 能触发对应提示词
- [ ] `:test 运行所有测试` 中参数替换 `$ARGS`
- [ ] 不存在的命令给出提示而非崩溃

---

## 9.7 自动测试与修复循环

**目标**：Agent 改完代码后自动跑测试，失败就分析错误并修复，循环直到通过或达到上限。

**参考**：Claude Code 的 PostToolUse 钩子自动格式化 [$TRAE_REF](https://code.claude.com/docs/en/hooks-guide)，OpenCode 的 `tool.execute.after` 钩子。

### 设计思路

这个能力**不通过 PostToolUse 钩子实现**，因为跑测试是 Agent 的主动行为，不是每次编辑都触发的被动行为。正确做法是：通过自定义命令 + 系统提示词引导 Agent 自主完成测试-修复循环。

### 具体步骤

#### 第 1 步：创建测试修复命令

创建 `.anvil/commands/fix.md`：

```markdown
自动测试与修复循环。执行以下步骤：

1. 用 mcp__shell__shell_run 运行 pnpm test
2. 如果测试全部通过，用一句话总结结果并结束
3. 如果有测试失败：
   a. 用 mcp__fs__read_file 读取失败的测试文件和被测文件
   b. 分析失败原因（断言不匹配、超时、异常、类型错误等）
   c. 用 mcp__fs__edit_file 修复代码
   d. 重新运行 pnpm test
4. 最多重复 5 次修复尝试
5. 如果 5 次后仍失败，总结剩余问题

参数: $ARGS
```

#### 第 2 步：在系统提示词中引导

在 `src/agent/system-prompt.ts` 的工作规则中追加：

```ts
// 在工作规则追加：
// 改完代码后建议用 :fix 命令运行测试与修复循环
// 测试失败时优先分析错误信息，不要盲目重试
```

#### 第 3 步：（可选）通过 PostToolUse 钩子自动提示

在 `src/index.ts` 中注册一个提示钩子：

```ts
import { onPostToolUse } from "./hooks/index.ts";

let editCount = 0;
onPostToolUse(({ toolName }) => {
  if (toolName === "write-file" || toolName === "mcp__fs__edit_file") {
    editCount++;
    if (editCount >= 3) {
      console.error(`[hint] 已编辑 ${editCount} 次代码，考虑用 :fix 运行测试验证`);
      editCount = 0;
    }
  }
});
```

### 验收标准

- [ ] `:fix` 命令能触发测试运行
- [ ] 测试失败时 Agent 能分析错误并修复
- [ ] 修复后自动重新运行测试
- [ ] 最多 5 次修复尝试后停止
- [ ] 编辑 3 次代码后显示测试提示

---

## 9.8 HTTP API 服务

**目标**：把 MiniHarness 暴露为 HTTP API，其他程序能调用，用 SSE 流式输出。

**参考**：OpenCode 的 client/server 架构 [$TRAE_REF](https://opencode.ai/docs/config)。

### 设计思路

OpenCode 用 Bun HTTP 服务器 + WebSocket。MiniHarness 用 Node.js 原生 `http` 模块 + SSE（Server-Sent Events），零新依赖。

### 具体步骤

#### 第 1 步：HTTP 服务器

新建 `src/server/index.ts`：

```ts
import { createServer } from "node:http";
import { createProvider } from "../provider/index.ts";
import { runAgent, type LoopEvent } from "../agent/index.ts";
import { registerFileTools } from "../tools/index.ts";
import { MCPClient, registerMCPTools } from "../mcp/index.ts";
import { mcpServersRaw, parseMCPServers } from "../config.ts";
import { onPostToolUse } from "../hooks/index.ts";

const ctrl = new AbortController();

function parseBody(req: { on: (e: string, cb: (d?: unknown) => void) => void }): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk: unknown) => { body += chunk; });
    req.on("end", () => resolve(body));
  });
}

export async function startServer(port = 3000) {
  registerFileTools();
  const provider = createProvider();
  const workspace = process.cwd();

  // 启动 MCP 服务器
  const mcpServers = parseMCPServers(mcpServersRaw, workspace);
  const mcpClients: MCPClient[] = [];
  for (const cfg of mcpServers) {
    const client = new MCPClient(cfg.name, cfg.command, cfg.args, cfg.env);
    try {
      await client.start();
      await registerMCPTools(client, (t) => { /* register */ });
      mcpClients.push(client);
    } catch (e) {
      console.error(`[MCP] ${cfg.name} 启动失败: ${e}`);
    }
  }

  const server = createServer(async (req, res) => {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }

    // POST /ask — SSE 流式输出
    if (req.method === "POST" && req.url === "/ask") {
      const body = await parseBody(req);
      const { question, workspace: ws } = JSON.parse(body) as { question: string; workspace?: string };
      if (!question) { res.writeHead(400).end("missing question"); return; }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });

      const send = (event: string, data: unknown) => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      try {
        const result = await runAgent(question, provider, { workspace: ws || workspace }, ctrl.signal, {
          onEvent: (e: LoopEvent) => {
            switch (e.type) {
              case "thinking": send("thinking", { round: e.round }); break;
              case "tool_call": send("tool_call", { name: e.name, args: e.args }); break;
              case "tool_result": send("tool_result", { name: e.name, ok: e.ok, output: e.output }); break;
              case "text_delta": send("text_delta", { delta: e.delta }); break;
              case "answer": send("answer", { text: e.text }); break;
              case "context_compressed": send("compressed", { before: e.beforeTokens, after: e.afterTokens }); break;
            }
          },
        });
        send("done", { metrics: result.metrics });
      } catch (e) {
        send("error", { message: String(e) });
      }
      res.end();
      return;
    }

    // GET /health
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", tools: "file + mcp" }));
      return;
    }

    res.writeHead(404).end("Not Found");
  });

  server.listen(port, () => {
    console.log(`MiniHarness server: http://localhost:${port}`);
    console.log(`  POST /ask      — SSE 流式问答`);
    console.log(`  GET  /health   — 健康检查`);
  });

  process.on("SIGINT", () => {
    ctrl.abort();
    mcpClients.forEach(c => c.stop());
    server.close();
    process.exit(0);
  });
}
```

#### 第 2 步：注册子命令

修改 `src/index.ts`，追加 `server` 命令：

```ts
import { startServer } from "./server/index.ts";

async function server() {
  const port = parseInt(rest[0] || "3000", 10);
  await startServer(port);
}

const commands: Record<string, () => Promise<void>> = {
  ask, chat, resume, sessions, subagent, eval: eval_, server
};
```

#### 第 3 步：Barrel export

新建 `src/server/index.ts` 的导出已在第 1 步包含。

更新 USAGE：

```ts
const USAGE = `用法:
  pnpm dev ask "你的问题"       # 单轮任务
  pnpm dev chat                  # 多轮对话
  pnpm dev server [port]         # HTTP API 服务（默认 3000）
  ...
`;
```

### 验收标准

- [ ] `pnpm dev server` 启动 HTTP 服务
- [ ] `GET /health` 返回 `{"status":"ok"}`
- [ ] `POST /ask` 返回 SSE 流，包含 thinking/tool_call/text_delta/answer 事件
- [ ] Ctrl+C 优雅关闭服务器和 MCP 子进程
