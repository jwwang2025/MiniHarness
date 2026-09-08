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

### 参考来源

- Claude Code Hooks：PreToolUse / PostToolUse / Stop / SessionStart 等事件，支持 matcher 过滤 [$TRAE_REF](https://code.claude.com/docs/en/hooks-guide)
- Claude Code Memory：CLAUDE.md 自动加载 + 压缩后重注入 [$TRAE_REF](https://code.claude.com/docs/en/memory)
- OpenCode Permissions：doom_loop 权限，同工具同参数 3 次触发 [$TRAE_REF](https://opencode.ai/docs/permissions)
- OpenCode Commands：`.opencode/commands/` 目录定义自定义命令 [$TRAE_REF](https://opencode.ai/docs/commands)
- OpenCode Compaction：有损压缩 + checkpoint + 保留上下文 [$TRAE_REF](https://opencode.ai/v2/docs/compaction)

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

### 关键设计决策

**事件回调 vs Hook 的区别**：MiniHarness 现在有 `opts.onEvent` 回调，但它是**只读观察者**——只能看不能改。Hook 是**拦截器**——可以 deny、modify args、append output。两者互补：事件用于 UI 渲染，Hook 用于逻辑拦截。

**HookAction 的四种类型**：
- `continue` → 放行，继续执行
- `deny` → 拒绝执行，Agent 收到拒绝原因
- `modify` → 修改工具参数后继续执行（如规范化路径）
- `append` → 执行后追加额外输出到结果（如 LSP 诊断）

**注册函数返回取消注册函数**：`onPreToolUse(hook)` 返回一个 `unregister` 函数，调用后钩子移除。这样可以在测试中隔离，也可以实现动态加载/卸载。

**顺序执行 + 短路**：PreToolUse 钩子按注册顺序执行，任一返回 `deny` 即短路停止。PostToolUse 钩子全部执行（不短路）。

### 实现步骤清单

1. 定义 Hook 类型：PreToolUseContext / PostToolUseContext / HookAction
2. 实现 Hook 注册表：onPreToolUse / onPostToolUse / runPreToolUse / runPostToolUse
3. 在 agent loop.ts 中接入：工具执行前调 runPreToolUse，执行后调 runPostToolUse
4. 创建 barrel export（src/hooks/index.ts）
5. 注册一个审计日志钩子作为示例验证

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

### 关键设计决策

**为什么叫 AGENTS.md 而非 CLAUDE.md**：避免和 Anthropic 商标冲突，也符合开源社区的通用命名（OpenCode 也用类似机制）。

**为什么限制 100 行 / 10KB**：MiniHarness 的上下文预算比 Claude Code 小（DeepSeek 模型通常 64K vs Claude 200K），注入太多项目约定会挤占可用上下文。

**压缩后重注入**：上下文压缩会丢弃旧消息，包括 system 消息里的项目约定。压缩后必须重新加载 AGENTS.md，否则 Agent 会「忘记」项目规则。这是 Claude Code 的核心设计 [$TRAE_REF](https://code.claude.com/docs/en/memory)。

**为什么不做路径特定规则**：Claude Code 支持 `.claude/rules/` + `paths:` frontmatter，但这需要路径匹配引擎，复杂度高。MiniHarness 用单文件，简单直接。

### 实现步骤清单

1. 实现记忆加载器：读取 AGENTS.md，按行数/字节数截断
2. 实现系统提示词拼接函数：base prompt + 项目记忆
3. 在 agent loop.ts 中注入：首轮加载记忆并拼入 system 消息
4. 在 context.ts 压缩逻辑中重注入：压缩后重新加载 AGENTS.md
5. 创建 AGENTS.md 模板文件

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

### 关键设计决策

**专用工具而非裸 shell**：用 `mcp__shell__shell_run` 执行 git 问题是 Agent 需要知道 git 命令的参数，容易出错。封装成 `git-status`、`git-commit` 等专用工具，参数更简单，安全策略更精确（git-status 可以 allow，git-commit 必须 ask）。

**git-commit 自动 add -A**：这是编码 Agent 的典型场景——改完代码直接提交。把 add + commit 合并到一个工具调用，减少 Agent 的工具调用轮数。

**diff 输出截断**：diff 可能很大，截断到 5000 字符并标注总长度，避免挤占上下文。

**git-diff --stat 优先**：先返回 `--stat`（文件级摘要），再返回完整 diff。Agent 可以先看概览再决定是否深入。

### 实现步骤清单

1. 实现 git-status 工具：执行 `git status --porcelain`，解析为 staged/modified/untracked 三组
2. 实现 git-diff 工具：支持 staged 参数，先 --stat 再完整 diff，超长截断
3. 实现 git-commit 工具：执行 `git add -A + git commit -m "message"`，message 参数转义
4. 在 safety/policy.ts 配置策略：git-status/git-diff 为 allow，git-commit 为 ask
5. 在 index.ts 注册工具
6. 更新系统提示词

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

### 关键设计决策

**调用指纹**：用 `JSON.stringify(args)` 做哈希，相同参数 = 相同指纹。排序 key 保证 `{a:1,b:2}` 和 `{b:2,a:1}` 指纹一致。

**3 次阈值 + 1 分钟窗口**：参考 OpenCode 的 3 次触发 [$TRAE_REF](https://opencode.ai/docs/permissions)。1 分钟窗口意味着如果 Agent 调了 2 次、隔了 1 分钟再调，不算死循环。只有短时间内连续重复才算。

**阻断而非自动跳过**：检测到死循环后返回一个提示消息（"疑似死循环，请改变策略或参数"），让 Agent 自己决定下一步，而不是静默跳过。

**LLM 重试的指数退避**：1s → 2s → 4s，最多 3 次。只重试可重试错误（超时、限流、连接重置），不重试参数错误。

**isRetryableError 的正则匹配**：`/timeout|rate.?limit|429|503|ECONNRESET|ECONNREFUSED/i`——覆盖常见瞬时错误。

### 实现步骤清单

1. 实现死循环检测器：hashArgs + CallRecord + checkLoop + resetLoopGuard
2. 在 agent loop.ts 中接入：工具执行前检查循环
3. 实现重试工具：withRetry + isRetryableError（指数退避）
4. 在 provider streamChat 调用处包裹 withRetry

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

### 关键设计决策

**用 `:command` 而非 `/command`**：MiniHarness 的 REPL 已经用 `:` 作为命令前缀（如 `:exit`），保持一致。

**纯 Markdown，不用 frontmatter**：Claude Code 和 OpenCode 用 frontmatter 定义命令元数据（如 `allowed-tools`、`mode`）。MiniHarness 简化为纯提示词模板——整个文件就是提示词，`$ARGS` 替换用户输入。轻量优先。

**不限制工具**：Claude Code 可以在 frontmatter 里限制命令能用的工具。MiniHarness 不做限制，安全策略由 safety/policy.ts 统一管理。

**每次进 REPL 重新加载**：不缓存命令文件，每次启动 REPL 时重新读取。用户改了命令文件，重新进入 REPL 即可生效。

### 实现步骤清单

1. 实现命令加载器：读取 `.anvil/commands/*.md`，解析为 name + prompt
2. 实现 `$ARGS` 替换函数
3. 在 repl.ts 中集成：解析 `:xxx` 命令，匹配自定义命令，注入提示词
4. 创建示例命令：test.md（跑测试+分析失败）、review.md（审查 diff）

### 验收标准

- [ ] `.anvil/commands/` 目录下的 `.md` 文件被识别为自定义命令
- [ ] 在 REPL 中输入 `:test` 能触发对应命令的提示词
- [ ] `:test 运行所有测试` 中的 "运行所有测试" 替换 `$ARGS`
- [ ] 不存在的命令给出提示而非崩溃
- [ ] 命令文件修改后重新进入 REPL 能加载最新内容
