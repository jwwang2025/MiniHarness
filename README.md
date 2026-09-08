<p align="center">
  <img src="./assets/logo_transparent.jpg" width="240" alt="MiniHarness 标志">
</p>

<h1 align="center">MiniHarness</h1>

<p align="center">
  <strong>从零构建属于你自己的深度 Agent 框架</strong><br>
  <sub>一条循序渐进的学习路径，五个核心分支 + 四大进阶能力，掌握 LLM Agent 的每一层实现细节</sub>
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

MiniHarness 不是一个开箱即用的 SDK，而是一套**完整的 Agent 框架教学实现**。每个功能分支都是一层架构递进，你可以从最小可行版本开始，逐层叠加工具系统、上下文管理、安全权限、会话持久化，最终构建出生产级别的 Agent 基础设施。

`main` 分支在五个渐进分支的基础上，进一步整合了 **MCP 工具协议**、**评测系统**、**成本可观测性**、**多模型供应商** 四大进阶能力，形成完整版本。

---

## 🗺️ 学习路线图

本项目通过 **5 个渐进式功能分支** 搭建学习路径，每个分支都在前一版本的基础上新增一个核心能力模块：

```
main (你在这里) ── 全部功能已整合的完整版本
  │
  ├─ feat/session-persistence   ← 会话持久化 & 断点续跑
  │   └─ feat/safety-permissions  ← 安全策略 & 人工审批
  │       └─ feat/context-management  ← 上下文压缩 & Token 管理
  │           └─ feat/tool-system  ← 工具注册 & 文件操作
  │               └─ feat/minimal-streaming-agent  ← 最小流式 Agent
```

### 分支详解

| 分支 | 学习重点 | 关键文件 | 你将学会 |
|:-----|:---------|:---------|:---------|
| **feat/minimal-streaming-agent** | 流式 API & SSE 解析 | [openai.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/src/provider/openai.ts) | OpenAI 兼容接口调用、SSE 流解析、AsyncIterable |
| **feat/tool-system** | 工具抽象 & 注册表模式 | [registry.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/src/tools/registry.ts) · [file-tools.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/src/tools/file-tools.ts) · [types.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/src/tools/types.ts) | 工具注册机制、Zod 参数校验、Agent 多轮工具调用循环 |
| **feat/context-management** | Token 预算 & 智能摘要 | [tokens.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/src/agent/tokens.ts) · [context.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/src/agent/context.ts) · [summarizer.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/src/agent/summarizer.ts) | gpt-tokenizer 精确计费、上下文滑动窗口、LLM 历史摘要压缩 |
| **feat/safety-permissions** | 沙箱边界 & 审批流 | [policy.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/src/safety/policy.ts) · [approver.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/src/safety/approver.ts) · [types.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/src/safety/types.ts) | 工作区路径越界检测、危险命令正则匹配、三级权限策略（allow/ask/deny）、交互式审批缓存 |
| **feat/session-persistence** | 状态持久化 & 断点续跑 | [store.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/src/session/store.ts) · [types.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/src/session/types.ts) · [index.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/src/index.ts) | JSON 文件存储、UUID 会话、多轮对话恢复、中断任务续跑、CLI 交互模式 |

### main 分支进阶能力

在五个渐进分支的基础上，`main` 分支新增了四大进阶模块：

| 模块 | 学习重点 | 关键文件 | 你将学会 |
|:-----|:---------|:---------|:---------|
| **MCP 工具协议** | 外部工具服务器集成 | [client.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/src/mcp/client.ts) · [tool-adapter.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/src/mcp/tool-adapter.ts) | JSON-RPC 2.0 子进程通信、MCP 协议初始化握手、工具发现与适配、环境变量配置机制 |
| **评测系统** | Agent 质量基准测试 | [tasks.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/src/eval/tasks.ts) · [runner.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/src/eval/runner.ts) · [report.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/src/eval/report.ts) | 任务定义与验证机制、三种校验模式（contain/regex/script）、基线对比与回归检测 |
| **成本可观测性** | Token 与费用追踪 | [collector.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/src/telemetry/collector.ts) · [pricing.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/src/telemetry/pricing.ts) · [format.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/src/telemetry/format.ts) | 逐轮指标采集、多模型定价表、USD 成本估算、人可读报告格式化 |
| **多模型供应商** | Provider 抽象与工厂 | [factory.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/src/provider/factory.ts) · [ollama.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/src/provider/ollama.ts) · [types.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/src/provider/types.ts) | Provider 接口设计、工厂模式切换、Ollama 本地模型接入 |

> **💡 学习建议**：从 `feat/minimal-streaming-agent` 开始，按顺序切换分支，阅读每个分支的代码变更差异，理解每一层设计决策的动机。然后再回到 `main` 分支研究四大进阶能力。

---

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

---

## 🏗️ 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                          CLI 入口                            │
│  ask / chat / resume / sessions / eval  ←  [index.ts]      │
└──────────────┬──────────────────────────────────────────────┘
               │
   ┌───────────▼───────────┐
   │   CLI 交互层 [cli/]    │  repl.ts · ui.ts (spinner/markdown)
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
│     ┌───────────▼───────────────────────┐                   │
│     │     工具执行 (registry)           │                   │
│     │  ┌────────────┐  ┌──────────────┐ │                   │
│     │  │ 内置工具   │  │  MCP 工具    │ │                   │
│     │  │ file-tools │  │ tool-adapter │ │                   │
│     │  └────────────┘  └──────┬───────┘ │                   │
│     └──────────────────────────┼─────────┘                   │
└────────────────────────────────┼─────────────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  MCP 客户端 [mcp/]      │
                    │  JSON-RPC 子进程通信    │
                    │  fs · memory · fetch... │
                    └─────────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   会话持久化 (store)    │  .anvil/sessions/*.json
                    └─────────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   评测系统 [eval/]      │  .anvil/eval-baseline.json
                    │   6 任务 · 基线对比     │
                    └─────────────────────────┘
```

---

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

## 💻 命令使用

MiniHarness 提供五种交互模式，覆盖从单轮任务到评测基准的各种场景：

### 1. 单轮任务 (`ask`)

适合快速执行一次性文件操作任务。

```bash
# 读取项目结构并生成 README 大纲
pnpm dev ask "分析项目 src 目录结构，列出所有模块文件及其职责"

# 读取文件并修改
pnpm dev ask "读取 src/index.ts，在开头添加版本注释，然后创建 .gitignore 文件"
```

运行中你会看到完整的 Agent 执行轨迹：
```
[round 1]
  → list-dir {"path":"."}
  ✓ list-dir → 📁 src/  📄 package.json  ...
[round 2]
  → read-file {"path":"src/index.ts"}
  ✓ read-file → 1  import { registerFileTools } ...
  [context] 2847 → 2103 tokens   ← 上下文被智能压缩
[round 3]
⚠️  即将执行: write-file {"path":"src/index.ts","content":"// ===== MiniHarness v1.0 ===== ..."}
允许? [y=是 / n=否 / a=总是允许此模式] y     ← 安全审批流程
  ✓ write-file → 已写入 src/index.ts

所有改动完成：在 src/index.ts 开头添加了版本注释...
[session] 550e8400-e29b-41d4-a716-446655440000   ← 会话 ID 用于恢复

⏱  耗时: 12.3s · 轮数: 3 · token: 5421 · 成本: $0.0015   ← 成本报告
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

### 5. 评测基准 (`eval`)

运行内置评测任务，验证 Agent 能力并生成报告。

```bash
# 运行全部评测任务（自动对比基线）
pnpm dev eval

# 运行并将当前结果保存为新基线
pnpm dev eval --save
```

输出示例：
```
=== Eval Report ===
通过率: 5/6 (83%)
平均轮数: 2.2
总 token: 12450
总成本: $0.0035
耗时: 45.2 s

=== 基线对比 ===
基线通过率: 4/6 (67%)
回归: 0  改进: 1

=== 任务详情 ===
✓ read-package-name    1轮  520tok  $0.0001
✓ list-src-dir         2轮  890tok  $0.0003
✗ count-lines-config   3轮  2100tok $0.0006 (超时)
...
```

---

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

### 测试清单

| 测试文件 | 覆盖模块 | 用例数 | 特点 |
|:---------|:---------|:-------|:-----|
| [tool-system.test.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/test/tool-system.test.ts) | 文件工具 + 注册表 | 15 | 真实临时目录，覆盖写入/读取/列目录/参数校验 |
| [context-management.test.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/test/context-management.test.ts) | Token 估算 + 截断 + 裁剪 | 18 | 边界条件极严，验证压缩后 token 数、摘要插入位置 |
| [truncate.test.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/test/truncate.test.ts) | 真实场景压缩测评 | 端到端 | 构造 7 轮真实 Agent 对话，真实调用 LLM 生成摘要再送回模型验证 |
| [safety-permission.test.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/test/safety-permission.test.ts) | 安全策略 + 审批 | 36 | spawn 子进程测试交互式 stdin，验证路径越界/危险模式/审批缓存 |
| [session-persistence.test.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/test/session-persistence.test.ts) | 会话生命周期 | 23 | 切换 cwd 到临时目录，验证创建→保存→加载→列表→删除完整流程 |
| [cost-observability.test.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/test/cost-observability.test.ts) | 成本追踪 + 报告格式化 | 19 | 定价表校验、逐轮指标采集、真实计时器、条件性真实 API 端到端验证 |

---

## 📁 项目结构

```
MiniHarness/
├── src/
│   ├── index.ts                 # CLI 入口：ask / chat / resume / sessions / eval
│   ├── config.ts                # Zod 环境变量校验 + MCP 服务器解析
│   ├── agent/
│   │   ├── loop.ts              # Agent 主循环（10 轮工具调用 + 事件系统）
│   │   ├── tokens.ts            # gpt-tokenizer 精确计数
│   │   ├── context.ts           # 上下文截断 + 工具输出裁剪
│   │   ├── summarizer.ts        # LLM 历史摘要生成
│   │   ├── system-prompt.ts     # System Prompt 模板
│   │   └── index.ts             # 模块 barrel re-export
│   ├── provider/
│   │   ├── types.ts             # Provider 接口 + ChatMessage/StreamEvent 类型
│   │   ├── openai.ts            # OpenAI 兼容 streamChat / chatWithTools / SSE 解析
│   │   ├── ollama.ts            # Ollama 本地模型适配（复用 OpenAI 兼容协议）
│   │   ├── factory.ts           # createProvider() 工厂函数
│   │   └── index.ts
│   ├── tools/
│   │   ├── types.ts             # Tool / ToolResult 接口定义
│   │   ├── registry.ts          # 工具注册表 → OpenAI 格式导出
│   │   ├── file-tools.ts        # read-file / write-file / list-dir
│   │   └── index.ts
│   ├── safety/
│   │   ├── types.ts             # Permission / ToolInvocation / SafetyOptions
│   │   ├── policy.ts            # inWorkspace + isDangerousCommand + checkPolicy
│   │   ├── approver.ts          # 交互式审批 + "总是允许" 缓存
│   │   └── index.ts
│   ├── session/
│   │   ├── types.ts             # Session 接口定义
│   │   ├── store.ts             # JSON 文件 CRUD + 按时间倒序列出
│   │   └── index.ts
│   ├── mcp/
│   │   ├── client.ts            # MCP 客户端：子进程 JSON-RPC 2.0 通信
│   │   ├── tool-adapter.ts      # MCP 工具 → 统一 Tool 接口适配
│   │   └── index.ts
│   ├── eval/
│   │   ├── types.ts             # EvalTask / EvalResult / EvalReport 类型
│   │   ├── tasks.ts             # 6 个内置评测任务定义
│   │   ├── runner.ts            # 评测执行器 + 验证逻辑
│   │   ├── report.ts            # 基线对比 + 报告格式化
│   │   └── index.ts
│   ├── telemetry/
│   │   ├── types.ts             # RunMetrics / TurnMetrics / ToolCallMetrics
│   │   ├── collector.ts         # TelemetryCollector 逐轮采集器
│   │   ├── pricing.ts           # 多模型定价表 + 成本估算
│   │   ├── format.ts            # 人可读报告格式化
│   │   └── index.ts
│   └── cli/
│       ├── repl.ts              # 交互式 REPL（readline + colon 命令）
│       ├── ui.ts                # 终端 UI：颜色/spinner/Markdown/工具调用渲染
│       ├── types.d.ts           # marked-terminal 类型声明
│       └── index.ts
├── test/                        # 6 套独立测试（无 mock）
├── docs/                        # 技术文档
│   ├── CONTRIBUTING.md
│   └── Phase-8-进阶能力技术文档.md
├── assets/                      # Logo 资源文件
├── .anvil/                      # 运行时数据（自动生成）
│   ├── sessions/                # 会话 JSON 文件
│   └── eval-baseline.json       # 评测基线报告
├── .env.example                 # 环境变量模板
├── tsconfig.json                # strict + nodenext + verbatimModuleSyntax
├── package.json
└── pnpm-lock.yaml
```

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

## 🧠 设计决策记录

### 为什么上下文压缩用 summarize 而不是丢弃？
丢弃旧消息会导致 Agent 忘记早期做出的决策和已完成的文件写入。调用 LLM 生成 200 字摘要虽然有少量 token 开销，但保留了**决策记忆**，在长任务（改 10+ 个文件）中正确性显著提升。参见 [context.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/src/agent/context.ts#L22-L52)。

### 为什么安全策略做三层（allow/ask/deny）而不是简单 ask？
- `deny`：路径越界、`rm -rf` 这类操作**绝不能放行**，即便用户手滑也会被硬拦截
- `allow`：只读操作（读文件、列目录）不需要每次都问，减少交互摩擦
- `ask`：写文件、运行命令属于副作用操作，让用户确认

参见 [policy.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/src/safety/policy.ts#L39-L64)。

### 为什么会话存储用 JSON 文件而不是 SQLite？
教学项目的核心原则是**减少隐藏复杂度**。JSON 文件肉眼可读、编辑器直接打开就能调试 Agent 状态，`cat .anvil/sessions/*.json` 就能看到完整对话历史，更适合理解"持久化到底存了什么"。

### 为什么 MCP 客户端用子进程而不是 HTTP？
MCP 协议的设计本身就基于 stdio 传输——服务器读 stdin、写 stdout，天然适合子进程模型。这样做的好处是：零网络端口占用、进程隔离崩溃不影响主进程、`npx -y` 免安装启动任意服务器。参见 [client.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/src/mcp/client.ts)。

### 为什么遥测系统逐轮采集而不是只统计总数？
只有逐轮采集才能回答"哪一轮最慢""哪个工具拖了后腿"这类问题。`formatMetrics` 输出最慢 Top 3 工具调用和最慢 Top 3 轮次，让性能瓶颈一目了然。总数字只能告诉你"花了多少"，逐轮数据才能告诉你"为什么花这么多"。参见 [collector.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/src/telemetry/collector.ts)。

### 为什么评测验证支持 script 模式？
`contain` 和 `regex` 只能检查答案文本，但有些任务的正确性需要**实际执行验证**——比如"src/config.ts 有多少行"，答案是否正确取决于真实行数。`script` 模式运行自定义 Node 脚本，能处理任意复杂的验证逻辑。参见 [runner.ts](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/src/eval/runner.ts)。

---

## 📜 许可证

[MIT](file:///g:/3_LLM_AppDev/0_Resume_Projects/MiniHarness/LICENSE) © MiniHarness Contributors

---

<p align="center">
  <sub>构建属于你自己的 Agent，而不是只会调用他人的 SDK。</sub>
</p>
