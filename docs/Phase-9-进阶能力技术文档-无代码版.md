# Phase 9：从「框架」到「编码工作流引擎」（无代码版）

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

| | Claude Code | OpenCode | MiniHarness |
|---|---|---|---|
| 钩子定义 | JSON 配置 + shell 命令 | TypeScript 插件函数 | TypeScript 函数注册 |
| 钩子类型 | command / prompt / notification | tool.execute.before / after | PreToolUse / PostToolUse |
| 匹配方式 | regex matcher | 函数内自行判断 | 函数内自行判断 |
| 返回值 | exit code (0/1/2) | 修改 output 对象 | HookAction 联合类型 |

### 关键设计决策

**事件回调 vs Hook 的区别**：MiniHarness 现有 `opts.onEvent` 是只读观察者——只能看不能改。Hook 是拦截器——可以 deny、modify args、append output。

**HookAction 的四种类型**：
- `continue` → 放行
- `deny` → 拒绝执行，Agent 收到原因
- `modify` → 修改工具参数后继续
- `append` → 执行后追加额外输出

**注册函数返回取消注册函数**：`onPreToolUse(hook)` 返回一个 unregisfer 函数，调用后移除钩子。

**顺序执行 + 短路**：PreToolUse 按注册顺序执行，任一返回 deny 即短路。PostToolUse 全部执行不短路。

### 实现步骤清单

1. 定义 Hook 类型：PreToolUseContext / PostToolUseContext / HookAction
2. 实现 Hook 注册表：onPreToolUse / onPostToolUse / runPreToolUse / runPostToolUse
3. 在 agent loop.ts 中接入：工具执行前调 runPreToolUse，执行后调 runPostToolUse
4. 创建 barrel export（src/hooks/index.ts）
5. 注册审计日志钩子作为示例验证

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

### 关键设计决策

**为什么叫 AGENTS.md**：避免和 Anthropic 商标冲突，也符合开源社区通用命名。

**为什么限制 100 行 / 10KB**：MiniHarness 的上下文预算比 Claude Code 小（DeepSeek 通常 64K vs Claude 200K），注入太多会挤占可用上下文。

**压缩后重注入**：上下文压缩会丢弃旧消息，包括 system 消息里的项目约定。压缩后必须重新加载 AGENTS.md，否则 Agent 会「忘记」项目规则 [$TRAE_REF](https://code.claude.com/docs/en/memory)。

**为什么不做路径特定规则**：Claude Code 支持 `.claude/rules/` + `paths:` frontmatter，但需要路径匹配引擎。MiniHarness 用单文件，简单直接。

### 实现步骤清单

1. 实现记忆加载器：读取 AGENTS.md，按行数/字节数截断
2. 实现系统提示词拼接：base prompt + 项目记忆
3. 在 agent loop.ts 中注入：首轮加载记忆并拼入 system 消息
4. 在 context.ts 压缩逻辑中重注入：压缩后重新加载 AGENTS.md
5. 创建 AGENTS.md 模板文件

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

### 关键设计决策

**为什么用 MCP 而不自己写工具**：MiniHarness 在 Phase 8 已经接入了 MCP 协议，filesystem MCP 服务器自带搜索和编辑工具，启动时自动注册。shell 执行用 local-terminal-mcp（Node.js，npx 直接跑，支持 Windows），内置命令白名单和危险命令拦截。

**双层安全模型**：MCP 工具自身有安全机制（shell 白名单）+ MiniHarness 的安全策略再加一层审批。即使白名单允许 `git`，用户仍可 deny。

**命令白名单用正则前缀**：`ALLOW_COMMANDS=^ls,^cat,^git` 等正则前缀匹配，不在列表里的命令直接拒绝。不要加 `rm`、`curl`、`wget` 等危险命令。

### 实现步骤清单

1. 修改 `.env`，在 `MINIHARNESS_MCP_SERVERS` 中追加 shell 服务器配置
2. 在 safety/policy.ts 的 DEFAULT_POLICY 里为所有 MCP 工具配置安全策略
3. 为 `mcp__shell__shell_run` 添加危险命令拦截（复用已有的 isDangerousCommand）
4. 更新系统提示词，把 MCP 工具告诉 Agent

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

### 关键设计决策

**专用工具而非裸 shell**：用 `mcp__shell__shell_run` 执行 git 问题是 Agent 需要知道 git 命令参数，容易出错。封装成 `git-status`、`git-commit` 等专用工具，参数更简单，安全策略更精确。

**git-commit 自动 add -A**：编码 Agent 的典型场景——改完代码直接提交。把 add + commit 合并到一个工具调用，减少工具调用轮数。

**diff 输出截断**：diff 可能很大，截断到 5000 字符并标注总长度，避免挤占上下文。

**git-diff --stat 优先**：先返回 `--stat`（文件级摘要），再返回完整 diff。Agent 可以先看概览再决定是否深入。

### 实现步骤清单

1. 实现 git-status 工具：`git status --porcelain` 解析为 staged/modified/untracked
2. 实现 git-diff 工具：支持 staged 参数，先 --stat 再完整 diff，超长截断
3. 实现 git-commit 工具：`git add -A + git commit -m "message"`，message 转义
4. 配置安全策略：git-status/git-diff 为 allow，git-commit 为 ask
5. 在 index.ts 注册工具，更新系统提示词

### 验收标准

- [ ] `git-status` 能正确返回工作区文件状态
- [ ] `git-diff` 能返回已暂存/未暂存的 diff
- [ ] `git-commit` 能执行 `git add -A + git commit -m "message"`
- [ ] 安全策略生效：git-status/git-diff 为 allow，git-commit 为 ask

---

## 9.5 死循环检测与重试

**目标**：防止 Agent 用相同参数反复调用同一工具，LLM 调用失败自动重试。

**参考**：OpenCode 的 doom_loop（3 次触发）[$TRAE_REF](https://opencode.ai/docs/permissions)，OpenCode 的双层重试架构（SDK 层 + session 层指数退避）。

### 关键设计决策

**调用指纹**：用 `JSON.stringify(args)` 做哈希，相同参数 = 相同指纹。排序 key 保证 `{a:1,b:2}` 和 `{b:2,a:1}` 指纹一致。

**3 次阈值 + 1 分钟窗口**：参考 OpenCode 的 3 次触发 [$TRAE_REF](https://opencode.ai/docs/permissions)。1 分钟窗口意味着短时间连续重复才算死循环。

**阻断而非自动跳过**：检测到死循环后返回提示消息，让 Agent 自己决定下一步。

**通过 PreToolUse 钩子接入**：OpenCode 的 doom_loop 本质是特殊 permission name [$TRAE_REF](https://opencode.ai/docs/permissions)，MiniHarness 简化为直接在 PreToolUse 钩子中检测，更符合 Hook 优先的架构。

**LLM 重试的指数退避**：1s → 2s → 4s，最多 3 次。OpenCode 是双层（SDK 默认 2 次 + session 层 5 次）[$TRAE_REF](https://opencode.ai/docs/permissions)，MiniHarness 简化为单层 3 次。

**isRetryableError 的正则匹配**：`/timeout|rate.?limit|429|503|ECONNRESET|ECONNREFUSED/i`——覆盖常见瞬时错误。

### 实现步骤清单

1. 实现死循环检测器：hashArgs + CallRecord + checkLoop + resetLoopGuard
2. 注册为 PreToolUse 钩子
3. 实现重试工具：withRetry + isRetryableError（指数退避）
4. 在 provider streamChat 调用处包裹 withRetry

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

### 关键设计决策

**用 `:command` 而非 `/command`**：MiniHarness 的 REPL 已经用 `:` 作为命令前缀（如 `:exit`），保持一致。

**纯 Markdown，不用 frontmatter**：Claude Code 和 OpenCode 用 frontmatter 定义命令元数据（如 `allowed-tools`、`mode`）。MiniHarness 简化为纯提示词模板——整个文件就是提示词，`$ARGS` 替换用户输入。

**不限制工具**：Claude Code 可以在 frontmatter 里限制命令能用的工具。MiniHarness 不做限制，安全策略由 safety/policy.ts 统一管理。

**每次进 REPL 重新加载**：不缓存命令文件，每次启动 REPL 时重新读取。用户改了命令文件，重新进入 REPL 即可生效。

### 实现步骤清单

1. 实现命令加载器：读取 `.anvil/commands/*.md`，解析为 name + prompt
2. 实现 `$ARGS` 替换函数
3. 在 repl.ts 中集成：解析 `:xxx` 命令，匹配自定义命令，注入提示词
4. 创建示例命令：test.md、review.md

### 验收标准

- [ ] `.anvil/commands/*.md` 被识别为自定义命令
- [ ] 输入 `:test` 能触发对应提示词
- [ ] `:test 运行所有测试` 中参数替换 `$ARGS`
- [ ] 不存在的命令给出提示而非崩溃

---

## 9.7 自动测试与修复循环

**目标**：Agent 改完代码后自动跑测试，失败就分析错误并修复，循环直到通过或达到上限。

**参考**：Claude Code 的 PostToolUse 钩子自动格式化 [$TRAE_REF](https://code.claude.com/docs/en/hooks-guide)，OpenCode 的 `tool.execute.after` 钩子。

### 关键设计决策

**不通过 PostToolUse 钩子实现**：跑测试是 Agent 的主动行为，不是每次编辑都触发的被动行为。正确做法是：通过自定义命令 + 系统提示词引导 Agent 自主完成测试-修复循环。

**通过自定义命令实现**：创建 `.anvil/commands/fix.md`，命令内容就是测试-修复循环的 prompt 模板。Agent 执行 `:fix` 时自主完成循环。

**最多 5 次修复**：防止无限循环，5 次后停止并总结剩余问题。

**PostToolUse 钩子做提示而非强制**：编辑 3 次代码后提示"考虑用 :fix 运行测试验证"，但不强制执行。

### 实现步骤清单

1. 创建 `.anvil/commands/fix.md`，内容是测试-修复循环的 prompt 模板
2. 在系统提示词的工作规则中追加引导
3. （可选）注册 PostToolUse 钩子，编辑 3 次后提示测试

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

### 关键设计决策

**用 SSE 而非 WebSocket**：OpenCode 用 Bun HTTP + WebSocket。MiniHarness 用 Node.js 原生 `http` 模块 + SSE（Server-Sent Events），零新依赖。SSE 是单向推送，刚好满足 Agent 结果流式输出的场景。

**SSE 事件映射**：MiniHarness 的 LoopEvent 有 7 种类型，直接映射为 SSE 事件：
- `thinking` → `event: thinking`
- `tool_call` → `event: tool_call`
- `tool_result` → `event: tool_result`
- `text_delta` → `event: text_delta`
- `answer` → `event: answer`
- `context_compressed` → `event: compressed`
- `done` → `event: done`

**CORS 支持**：允许跨域调用，方便浏览器端直接连接。

**优雅关闭**：Ctrl+C 时先 abort agent loop、停止 MCP 子进程、再关闭 HTTP 服务器。

### 实现步骤清单

1. 实现 HTTP 服务器：`POST /ask` 返回 SSE 流，`GET /health` 健康检查
2. 在 SSE 流中映射 LoopEvent 为 SSE 事件
3. 注册 `server` 子命令到 CLI
4. 处理优雅关闭

### 验收标准

- [ ] `pnpm dev server` 启动 HTTP 服务
- [ ] `GET /health` 返回 `{"status":"ok"}`
- [ ] `POST /ask` 返回 SSE 流，包含 thinking/tool_call/text_delta/answer 事件
- [ ] Ctrl+C 优雅关闭服务器和 MCP 子进程
