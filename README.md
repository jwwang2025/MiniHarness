<p align="center">
  <img src="./assets/logo_transparent.jpg" width="240" alt="MiniHarness 标志">
</p>

<h1 align="center">MiniHarness</h1>

<p align="center">
  <strong>从零构建属于你自己的深度 Agent 框架</strong><br>
  <sub>一条循序渐进的学习路径，十三个核心分支 + 进阶能力，掌握 LLM Agent 的每一层实现细节</sub>
</p>


<p align="center">
  <a href="#学习路线图">学习路线图</a> ·
  <a href="#核心特性">核心特性</a> ·
  <a href="#架构设计">架构设计</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#命令使用">命令使用</a> ·
  <a href="#测试覆盖">测试覆盖</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-7.0-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Node.js-≥21.7-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/pnpm-8+-F69220?style=flat-square&logo=pnpm&logoColor=white" alt="pnpm">
  <img src="https://img.shields.io/badge/Zod-4.4-3E67B1?style=flat-square" alt="Zod">
  <img src="https://img.shields.io/badge/MCP-supported-blue?style=flat-square" alt="MCP">
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License">
</p>

---

## 🎯 项目宗旨

> **通过循序渐进的各个分支的学习，实现一个属于自己的有深度的 Agent 项目。**

MiniHarness 不是一个开箱即用的 SDK，而是一套**完整的 Agent 框架教学实现**。每个功能分支都是一层架构递进，你可以从最小可行版本开始，逐层叠加工具系统、上下文管理、安全权限、会话持久化、MCP 工具协议、评测系统、成本可观测性、多模型供应商、子代理编排、钩子生命周期、CLI 交互体验、项目记忆注入，最终构建出生产级别的 Agent 基础设施。

---

<a id="学习路线图"></a>

## 🗺️ 学习路线图

本项目通过 **13 个渐进式功能分支** 搭建学习路径，每个分支都在前一版本的基础上新增一个核心能力模块。

### 分支详解

| 分支名 | 模块名 | 学习重点 | 你将学会 |
|:-------|:-------|:---------|:---------|
| `feat/minimal-streaming-agent` | 最小流式 Agent | 流式 API & SSE 解析 | OpenAI 兼容接口调用、SSE 流解析、AsyncIterable |
| `feat/tool-system` | 工具系统 | 工具抽象 & 注册表模式 | 工具注册机制、Zod 参数校验、Agent 多轮工具调用循环 |
| `feat/context-management` | 上下文管理 | Token 预算 & 智能摘要 | gpt-tokenizer 精确计费、上下文滑动窗口、LLM 历史摘要压缩 |
| `feat/safety-permissions` | 安全策略 | 沙箱边界 & 审批流 | 工作区路径越界检测、危险命令正则匹配、三级权限策略（allow/ask/deny）、交互式审批缓存 |
| `feat/session-persistence` | 会话持久化 | 状态持久化 & 断点续跑 | JSON 文件存储、UUID 会话、多轮对话恢复、中断任务续跑、CLI 交互模式 |
| `feat/mcp-support` | MCP 工具协议 | 外部工具服务器集成 | JSON-RPC 2.0 子进程通信、MCP 协议初始化握手、工具发现与适配、环境变量配置机制 |
| `feat/eval-framework` | 评测系统 | Agent 质量基准测试 | 任务定义与验证机制、三种校验模式（contain/regex/script）、基线对比与回归检测 |
| `feat/cost-observability` | 成本可观测性 | Token 与费用追踪 | 逐轮指标采集、多模型定价表、USD 成本估算、人可读报告格式化 |
| `feat/multi-provider` | 多模型供应商 | Provider 抽象与工厂 | Provider 接口设计、工厂模式切换、Ollama 本地模型接入 |
| `feat/subagent-orchestration` | 子代理编排 | 任务分解与并行执行 | LLM 驱动的任务分解、拓扑排序依赖管理、分层并行执行、结果汇总聚合 |
| `feat/hook-lifecycle` | 钩子生命周期 | 工具执行拦截与增强 | Pre/Post 钩子注册机制、四种 HookAction（continue/deny/modify/append）、审计日志钩子 |
| `feat/cli-polish` | CLI 交互体验 | REPL 交互 & 终端渲染 | 交互式 REPL 对话循环、marked-terminal 流式 Markdown 渲染、ora 加载动画、picocolors 彩色输出 |
| `feat/project-memory` | 项目记忆 | AGENTS.md 约定 & 上下文注入 | AGENTS.md 文档模板、项目记忆加载与截断、系统提示词上下文注入机制 |
| `main` | 完整产品 | 全部能力集成 | 合并 13 个分支的全部能力，开箱即用的生产级 Agent 框架 |

> **💡 学习建议**：从 `feat/minimal-streaming-agent` 开始，按顺序切换分支，阅读每个分支的代码变更差异，理解每一层设计决策的动机。然后再回到 `main` 分支研究全部进阶能力。

---

<a id="核心特性"></a>

## ✨ 核心特性

### 1. 最小流式 Agent 内核
- 原生 `fetch` + `ReadableStream` 实现 SSE 流式响应解析
- 零第三方 HTTP 客户端依赖，代码精简透明
- 支持任意 OpenAI 兼容 API 端点（DeepSeek、Qwen、Kimi 等）

### 2. 灵活的工具注册系统
- 纯 `Map<string, Tool>` 注册表模式，扩展零侵入
- 内置文件操作三件套：`read-file` / `write-file` / `list-dir`
- 参数校验使用 Zod Schema，错误提前拦截
- 自动导出为 OpenAI function calling 格式

### 3. 智能上下文管理
- **gpt-tokenizer (cl100k_base)** 精确 Token 计数，告别估算误差
- 滑动窗口策略：保留 system + 尾部最新消息，旧历史自动入队
- **LLM 摘要压缩**：不是粗暴丢弃，而是调用模型生成 200 字摘要，保留决策、文件路径、关键结论
- 工具输出自动裁剪：超长结果保留头部 + 尾部，中间插入省略标记

### 4. 三级安全防护
| 层级 | 机制 | 示例 |
|:-----|:-----|:-----|
| **deny（硬拦截）** | 路径越界检测 + 危险命令正则 | `../etc/passwd` 访问被拒、`rm -rf /` 命中模式 |
| **ask（需确认）** | 交互式命令行审批 + 模式级缓存 | 首次 `write-file` 问 y/n/a，选 `a` 后同路径不再提示 |
| **allow（放行）** | 默认安全工具白名单 | `read-file`、`list-dir` 等只读操作自动通过 |

### 5. 会话持久化 & 断点续跑
- 每轮工具调用后自动落盘，**不怕 Ctrl+C 中断**
- `.anvil/sessions/{uuid}.json` 存储完整消息历史
- `pnpm dev resume <sessionId>` 从上次中断的轮次无缝续跑
- `chat` 模式支持 `:help` / `:reset` / `:sessions` 等命令快捷操作

### 6. MCP 工具协议集成
- 通过 `MINIHARNESS_MCP_SERVERS` 环境变量配置外部工具服务器
- 子进程 JSON-RPC 2.0 通信，支持 `npx`/`uvx` 免安装启动
- 自动发现 MCP 服务器工具并注册到统一工具系统
- 工具注册名规则：`mcp__<服务器名>__<工具名>`（如 `mcp__fs__read_file`）
- 支持 `${workspace}` 变量替换和透传环境变量（API Key、存储路径等）

### 7. 评测系统 & 回归检测
- 6 个内置评测任务，覆盖单工具调用与多工具编排
- 三种验证模式：`contain`（包含检查）、`regex`（正则匹配）、`script`（脚本执行）
- 基线报告持久化到 `.anvil/eval-baseline.json`，支持回归/改进对比
- `pnpm dev eval` 一键运行全部评测，输出通过率、平均轮数、Token 消耗与成本

### 8. 成本可观测性
- `TelemetryCollector` 逐轮采集：模型调用耗时、Token 用量、工具执行详情
- 内置定价表支持 deepseek-chat、deepseek-reasoner、gpt-4o、gpt-4o-mini
- 每次任务结束输出结构化报告：总耗时、轮数、Token 统计、USD 成本、最慢工具调用 Top 3

### 9. 多模型供应商
- Provider 工厂模式，通过 `MINIHARNESS_PROVIDER` 切换 `openai` 或 `ollama`
- Ollama 供应商复用 OpenAI 兼容协议，本地模型零配置接入（默认 `localhost:11434`）
- 同一套 Agent 逻辑无缝运行在云端 API 或本地模型上

### 10. 子代理编排
- LLM 驱动的任务分解：将复杂任务拆分为 2-8 个独立可验证的子任务
- 拓扑排序依赖管理：自动按依赖关系分层，检测并拒绝循环依赖
- 分层并行执行：同层子任务多 Worker 并发（默认 3 并发），跨层串行
- 工具权限隔离：每个子任务可指定 `tools` 白名单，限制可访问的工具集
- 结果汇总聚合：所有子任务完成后，调用 LLM 生成统一的最终答案
- `pnpm dev subagent "任务"` 或 REPL 中 `:sub <任务>` 一键触发

### 11. 钩子生命周期
- **Pre-Tool 钩子**：工具执行前拦截，支持四种动作：
  - `continue` — 放行执行
  - `deny` — 阻止执行并返回原因
  - `modify` — 修改工具参数（patch 合并）
  - `append` — 向工具结果追加额外输出
- **Post-Tool 钩子**：工具执行后回调，用于审计、日志、副作用处理
- 内置审计钩子：每次工具调用后输出 `[audit]` 时间戳、工具名、状态、摘要
- 钩子注册返回取消订阅函数，支持动态注册/注销

### 12. CLI 交互体验
- 交互式 REPL：`pnpm dev chat` 进入多轮对话，支持 `:sub`、`:reset`、`:help` 等斜杠命令
- 流式 Markdown 渲染：`marked-terminal` 把模型输出渲染为终端富文本（标题、代码块、列表）
- `ora` 旋转加载动画与 `picocolors` 彩色输出，提升工具调用与状态反馈的可读性
- 模块化拆分：`cli/repl.ts` 负责交互循环，`cli/ui.ts` 封装渲染与动画

### 13. 项目记忆
- 约定优于配置：工作区根目录的 `AGENTS.md` 作为项目级规则与上下文文档
- 启动时加载 `AGENTS.md`，按 Token 预算截断后注入系统提示词
- 让 Agent 自动遵守项目代码风格、架构规则、禁止事项，无需每次手动粘贴

---

<a id="架构设计"></a>

## 🏗️ 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                          CLI 入口                            │
│  ask / chat / resume / sessions / eval / subagent  ←  [index.ts] │
└──────────────┬──────────────────────────────────────────────┘
               │
   ┌───────────▼───────────┐
   │   CLI 交互层 [cli/]    │  repl.ts · ui.ts (spinner/markdown)
   │  :sub / :reset / :help │
   └───────────┬───────────┘
               │
┌──────────────▼──────────────────────────────────────────────┐
│                      Agent 主循环                            │
│  MAX_ROUNDS=10 轮 · 事件驱动 (LoopEvent)  ←  [loop.ts]      │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ Token 估算   │→│ 上下文截断   │→│ LLM 摘要压缩     │   │
│  │ [tokens.ts]  │  │ [context.ts] │  │ [summarizer.ts]  │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
│                       │                                     │
│  ┌────────────────────▼─────────────────────┐               │
│  │  Provider 工厂 [provider/factory.ts]     │               │
│  │  ┌──────────────┐  ┌──────────────────┐ │               │
│  │  │ OpenAI 兼容  │  │  Ollama 本地模型 │ │               │
│  │  │ [openai.ts]  │  │  [ollama.ts]    │ │               │
│  │  └──────────────┘  └──────────────────┘ │               │
│  └──────────────┬───────────────────────────┘               │
│                 │                                           │
│  ┌──────────────▼─────────────────────────┐                 │
│  │   遥测采集 [telemetry/collector.ts]   │                 │
│  │   逐轮: 耗时 · Token · 工具 · 成本    │                 │
│  └──────────────┬─────────────────────────┘                 │
│                 │                                           │
│     ┌───────────▼───────────┐                               │
│     │ 安全策略 + 人工审批   │  policy.ts + approver.ts      │
│     └───────────┬───────────┘                               │
│                 │                                           │
│     ┌───────────▼───────────┐                               │
│     │  钩子生命周期 [hooks/] │  Pre → deny/modify/append    │
│     │  Pre/Post Tool Hooks  │  Post → 审计/日志             │
│     └───────────┬───────────┘                               │
│                 │                                           │
│     ┌───────────▼───────────────────────┐                   │
│     │     工具执行 (registry)           │                   │
│     │  ┌────────────┐  ┌──────────────┐ │                   │
│     │  │ 内置工具   │  │  MCP 工具    │ │                   │
│     │  │ file-tools │  │ tool-adapter │ │                   │
│     │  └────────────┘  └──────┬───────┘ │                   │
│     └──────────────────────────┼─────────┘                   │
└────────────────────────────────┼─────────────────────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
   ┌──────────▼──────────┐  ┌────▼────────────┐  ┌─▼───────────────────┐
   │  MCP 客户端 [mcp/]   │  │ 会话持久化      │  │  评测系统 [eval/]    │
   │  JSON-RPC 子进程     │  │ .anvil/sessions │  │  .anvil/eval-baseline│
   │  fs · memory · fetch │  └─────────────────┘  └─────────────────────┘
   └──────────────────────┘
              │
   ┌──────────▼──────────────────────────────┐
   │  子代理编排 [agent/subagent/]           │
   │  decompose → topoSort → runLayer       │
   │  → summarize → finalAnswer             │
   └─────────────────────────────────────────┘
```

---

<a id="快速开始"></a>

## 🚀 快速开始

### 环境要求

| 依赖 | 版本要求 | 说明 |
|:-----|:---------|:-----|
| **Node.js** | ≥ 21.7 | 需支持 `process.loadEnvFile()` |
| **pnpm** | ≥ 8 | 项目指定包管理器 |
| **TypeScript** | 7.0+ | 严格模式 + verbatimModuleSyntax |

### 安装步骤

```bash
# 1. 克隆仓库
git clone https://github.com/your-name/MiniHarness.git
cd MiniHarness

# 2. 使用 pnpm 安装依赖
pnpm install

# 3. 配置环境变量
cp .env.example .env
# 然后编辑 .env，填入你的配置：
# MINIHARNESS_API_KEY=sk-xxxx
# MINIHARNESS_BASE_URL=https://api.deepseek.com
# MINIHARNESS_MODEL=deepseek-chat
# MINIHARNESS_PROVIDER=openai          # 可选: openai | ollama
# MINIHARNESS_MCP_SERVERS=             # 可选: MCP 工具服务器配置
```

### 环境变量说明

| 变量 | 必填 | 说明 |
|:-----|:-----|:-----|
| `MINIHARNESS_API_KEY` | 是 | 模型 API Key（Ollama 本地模式可填任意值） |
| `MINIHARNESS_BASE_URL` | 否 | API 端点地址，默认 `https://api.openai.com/v1` |
| `MINIHARNESS_MODEL` | 是 | 模型名称，如 `deepseek-chat`、`gpt-4o`、`llama3.1` |
| `MINIHARNESS_PROVIDER` | 否 | 模型供应商：`openai`（默认）或 `ollama` |
| `MINIHARNESS_MCP_SERVERS` | 否 | MCP 工具服务器配置，见下方说明 |

### MCP 服务器配置

`MINIHARNESS_MCP_SERVERS` 格式：

```
<名字>:<启动命令> [参数...] [|KEY=VAL KEY=VAL...] ; <名字>:<启动命令> ...
```

- 多个服务器用分号 `;` 分隔
- 竖线 `|` 后是透传给服务器的环境变量
- `${workspace}` 会替换为当前工作目录
- 工具注册名规则：`mcp__<名字>__<工具名>`

```bash
# 推荐组合：filesystem（代码搜索/文件编辑）+ memory（跨会话记忆）
MINIHARNESS_MCP_SERVERS=fs:npx -y @modelcontextprotocol/server-filesystem .;mem:npx -y @modelcontextprotocol/server-memory|MEMORY_FILE_PATH=${workspace}/.anvil/mcp-memory.jsonl

# 网页抓取（需 pip install uv）
# MINIHARNESS_MCP_SERVERS=fetch:uvx mcp-server-fetch

# 需要 API key 的服务器
# MINIHARNESS_MCP_SERVERS=search:npx -y @anthropic/mcp-server-brave-search|BRAVE_API_KEY=xxx
```

### 验证安装

```bash
# 查看帮助
pnpm dev
# 输出用法提示即表示配置正常
```

---

<a id="命令使用"></a>

## 💻 命令使用

MiniHarness 提供六种交互模式，覆盖从单轮任务到评测基准的各种场景：

### 1. 单轮任务 (`ask`)

适合快速执行一次性文件操作任务。

```bash
# 读取项目结构并生成 README 大纲
pnpm dev ask "分析项目 src 目录结构，列出所有模块文件及其职责"

# 读取文件并修改
pnpm dev ask "读取 src/index.ts，在开头添加版本注释，然后创建 .gitignore 文件"
```

### 2. 多轮对话 (`chat`)

适合需要上下文连续的复杂任务，自动持久化每一步。

```bash
# 启动新会话
pnpm dev chat

# 或恢复指定会话继续对话
pnpm dev chat 550e8400-e29b-41d4-a716-446655440000
```

交互模式内置命令：
| 命令 | 作用 |
|:-----|:-----|
| `:help` | 显示所有可用命令 |
| `:exit` / `:quit` | 退出聊天，自动保存 |
| `:reset` | 结束当前会话，创建全新会话 |
| `:sessions` | 列出所有历史会话 |
| `:sub <任务>` | 子代理模式：自动分解任务并并行执行 |

### 3. 断点续跑 (`resume`)

任务执行到一半被 Ctrl+C 或网络中断？直接续跑即可。

```bash
pnpm dev resume 550e8400-e29b-41d4-a716-446655440000
# Agent 会从上次落盘的消息状态继续执行后续轮次
```

### 4. 会话列表 (`sessions`)

查看所有历史会话及其状态。

```bash
pnpm dev sessions

# 输出示例：
# 550e8400  [done]    分析项目 src 目录结构...  (2026/8/29 14:30:22)
# a1b2c3d4  [running] 读取 package.json 并...  (2026/8/29 15:02:11)
```

### 5. 子代理模式 (`subagent`)

将复杂任务自动分解为子任务，按依赖关系分层并行执行后汇总结果。

```bash
# 通过 CLI 直接调用
pnpm dev subagent "读取 src 目录下所有模块，分析每个模块的职责并生成架构总结"

# 或在 REPL 中使用
:sub 分析项目依赖关系，列出所有外部依赖及其用途
```

### 6. 评测基准 (`eval`)

运行内置评测任务，验证 Agent 能力并生成报告。

```bash
# 运行全部评测任务（自动对比基线）
pnpm dev eval

# 运行并将当前结果保存为新基线
pnpm dev eval --save
```

<a id="测试覆盖"></a>

## 🧪 测试覆盖

项目采用**零依赖极简测试框架**，纯 TypeScript 编写，所有测试均基于真实文件系统而非 mock，保证可信度。

```bash
# 运行全部测试套件
pnpm test:all

# 单独运行各模块测试
pnpm test              # 工具系统测试   (~15 用例)
pnpm test:context      # 上下文管理测试 (~18 用例)
pnpm test:truncate     # 压缩效果真实测评 (需 API Key)
pnpm test:safety       # 安全权限测试   (~36 用例)
pnpm test:session      # 会话持久化测试 (~23 用例)
pnpm test:telemetry    # 成本可观测性测试 (~19 用例)
```

> **注意**：`test:all` 脚本目前仅运行 `test` 和 `test:context`，如需运行全部测试请逐个执行或手动串联。

---

## 🛠️ 技术栈

| 类型 | 技术 | 用途 |
|:-----|:-----|:-----|
| **语言** | [TypeScript 7](https://www.typescriptlang.org/) | 严格模式 + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` |
| **运行时** | [tsx](https://tsx.is/) | 直接运行 `.ts`，无需编译输出 |
| **模块解析** | `nodenext` | `import ... from "./foo.ts"` 必须带扩展名 |
| **校验** | [Zod 4](https://zod.dev/) | 环境变量 + 工具入参双重 Schema 校验 |
| **Token 计数** | [gpt-tokenizer](https://www.npmjs.com/package/gpt-tokenizer) | cl100k_base BPE 编码，精确到每 token |
| **终端 UI** | [ora](https://www.npmjs.com/package/ora) + [picocolors](https://www.npmjs.com/package/picocolors) | Spinner 动画 + 终端着色 |
| **Markdown 渲染** | [marked](https://marked.js.org/) + [marked-terminal](https://www.npmjs.com/package/marked-terminal) | Agent 输出的 Markdown 在终端中美观渲染 |
| **包管理** | [pnpm](https://pnpm.io/) | workspace + 硬链接模式 |
| **存储** | JSON 文件 (`fs/promises`) | `.anvil/sessions/` 目录，零数据库 |
| **LLM 接口** | OpenAI 兼容 Chat Completions | 默认 DeepSeek，可切换 Ollama / GPT / Qwen 等 |
| **工具协议** | [MCP](https://modelcontextprotocol.io/) | JSON-RPC 2.0 子进程通信，接入外部工具服务器 |

---

## 📜 许可证

[MIT](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/LICENSE) © MiniHarness Contributors

---

<p align="center">
  <sub>构建属于你自己的 Agent，而不是只会调用他人的 SDK。</sub>
</p>
