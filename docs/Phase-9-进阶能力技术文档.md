# Phase 9：进阶能力技术文档（含代码）

> 适用阶段：已完成 Phase 0-8（核心循环 + 工具 + 上下文 + 安全 + 会话 + 评测 + 多 Provider + 可观测性 + MCP + 子代理）
> 目标：让 MiniHarness 从「框架」进化到「开发者工具」
> 原则：每个子阶段独立可验收，完成一个再进下一个

---

## 目录

- [Phase 9.0 总览](#phase-90-总览)
- [Phase 9.1 增强工具集](#phase-91-增强工具集)
- [Phase 9.2 RAG 语义检索](#phase-92-rag-语义检索)
- [Phase 9.3 自动测试与修复循环](#phase-93-自动测试与修复循环)
- [Phase 9.4 插件系统](#phase-94-插件系统)
- [Phase 9.5 HTTP API 服务](#phase-95-http-api-服务)

---

## Phase 9.0 总览

Phase 8 完成后，你有了完整的框架骨架。但回到实际使用场景，还缺几个关键能力：

| 缺什么 | 做了之后 |
|--------|---------|
| 只有 read/write/list，没法搜索代码 | grep 工具 + diff 编辑工具 + shell 执行 |
| Agent 只能靠翻文件找代码，不知道语义 | 代码库向量化，语义检索一步到位 |
| 改完代码不知道对不对，要手动跑测试 | Agent 自己跑测试、分析失败、自动修复 |
| 加工具只能改源码重新启动 | 插件系统，热加载外部工具包 |
| 只能命令行用，没法集成到其他系统 | HTTP API，其他程序能调用你的 Agent |

### 子阶段依赖关系

```
9.1 增强工具集（grep/edit/shell）  ←  地基，后续都依赖
         │
    ┌────┴────┐
    ▼         ▼
9.2 RAG    9.3 自动测试与修复
    │         │
    └────┬────┘
         ▼
    9.4 插件系统
         │
         ▼
    9.5 HTTP API
```

> **建议顺序**：9.1 必须先做（后续阶段的新工具都要注册到 registry），9.2 和 9.3 可以并行，9.4 需要前面都完成，9.5 放最后。

---

## Phase 9.1 增强工具集

**目标**：补齐 Agent 的「眼睛和手」——搜索、精确编辑、执行命令。

**你将学到**：MCP 生态复用、命令白名单安全模型、安全策略配置。

**特点**：本阶段**零手写代码**，全部通过 MCP 服务器配置实现。

### 为什么最先做

现在 Agent 只有 read-file / write-file / list-dir 三个工具。实际编码任务中 Agent 需要：

- **搜索**：在几百个文件里找某个函数定义 → 需要搜索工具
- **精确编辑**：只改第 10 行而不是重写整个文件 → 需要编辑工具
- **执行命令**：跑测试、装依赖、格式化代码 → 需要 shell 工具

这三个能力是后续所有阶段的基础。

### 设计思路：全部走 MCP，零手写代码

你的项目在 Phase 8 已经接入了 MCP 协议。搜索和编辑用已有的 filesystem MCP 服务器，shell 执行用社区最成熟的 mcp-shell-server。

| 能力 | MCP 服务器 | 工具名 | 状态 |
|------|-----------|--------|------|
| 搜索代码 | @modelcontextprotocol/server-filesystem | `mcp__fs__search_files` | 已配置 |
| 精确编辑 | @modelcontextprotocol/server-filesystem | `mcp__fs__edit_file` | 已配置 |
| 执行命令 | mcp-shell-server (tumf) | `mcp__shell__shell_execute` | 新增配置 |

### 为什么选 mcp-shell-server

社区有几个 shell MCP 服务器，`tumf/mcp-shell-server` 是最成熟的：

- 296 次提交，MIT 许可，活跃维护 [$TRAE_REF](https://github.com/tumf/mcp-shell-server)
- **命令白名单**：通过 `ALLOW_COMMANDS` 环境变量配置，不在白名单里的命令直接拒绝
- **argv 执行**：命令以数组形式传递，不经过 shell 字符串解释（防注入）
- **环境隔离**：子进程不继承父进程的密钥和 Token
- **审计日志**：每次调用记录命令、耗时、退出码，敏感信息自动脱敏
- **执行限制**：可配置超时（默认 30s，上限 300s）和输出大小上限（默认 1MB）
- **参数硬化**：即使命令在白名单里，也会拦截 `find -exec`、`xargs`、`git -c` 等执行向量

### 具体步骤

#### 第 1 步：安装 uv（Python 包管理器）

mcp-shell-server 是 Python 包，用 `uvx` 运行（类似 Node.js 的 `npx`）：

```bash
# Windows
pip install uv

# 或用官方安装器
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"

# 验证
uvx --version
```

#### 第 2 步：配置 .env

在 `MINIHARNESS_MCP_SERVERS` 里加上 shell 服务器：

```bash
# .env
MINIHARNESS_MCP_SERVERS=fs:npx -y @modelcontextprotocol/server-filesystem .;shell:uvx mcp-shell-server|ALLOW_COMMANDS=ls,cat,pwd,grep,wc,find,node,npx,pnpm,tsc,git,mkdir,cp,mv
```

**配置解析**：
- `shell` — MCP 服务器名称（工具名前缀）
- `uvx mcp-shell-server` — 启动命令（uvx 会自动下载并运行）
- `ALLOW_COMMANDS=ls,cat,...` — 逗号分隔的命令白名单，不在列表里的命令会被拒绝

> **白名单建议**：根据你的项目需要调整。上面列的是编码场景常用命令（文件操作 + Node.js 工具链 + git）。**不要**加 `rm`、`curl`、`wget` 等危险命令。

启动后控制台应该能看到：

```
[MCP] fs: 6 个工具就绪
[MCP:fs] 注册工具: mcp__fs__search_files
[MCP:fs] 注册工具: mcp__fs__edit_file
...
[MCP] shell: 1 个工具就绪
[MCP:shell] 注册工具: mcp__shell__shell_execute
```

#### 第 3 步：配置安全策略

MCP 工具注册到 registry 后，安全策略默认是 `ask`（因为不在 `DEFAULT_POLICY` 里）。只读操作应该设为 `allow`。

在 `src/safety/policy.ts` 的 `DEFAULT_POLICY` 里加上所有 MCP 工具的规则：

```ts
const DEFAULT_POLICY: Record<string, Permission> = {
    "read-file": "allow",
    "list-files": "allow",
    "write-file": "ask",
    "edit-file": "ask",
    "run-shell": "ask",
    // MCP filesystem 工具（已有）
    "mcp__fs__search_files": "allow",       // 只读搜索，放行
    "mcp__fs__list_directory": "allow",     // 只读列表，放行
    "mcp__fs__read_file": "allow",           // 只读读取，放行
    "mcp__fs__write_file": "ask",           // 写入，需确认
    "mcp__fs__edit_file": "ask",            // 编辑，需确认
    "mcp__fs__create_directory": "ask",     // 创建目录，需确认
    // MCP shell 工具（新增）
    "mcp__shell__shell_execute": "ask",     // shell 执行，需确认
};
```

> **双层安全**：mcp-shell-server 自身有命令白名单（第一层），MiniHarness 的安全策略再加一层审批（第二层）。即使白名单允许 `git`，用户仍可在执行前拒绝。

#### 第 4 步：更新系统提示词

修改 `src/agent/system-prompt.ts`，把所有 MCP 工具告诉 Agent：

```ts
export const SYSTEM_PROMPT = `你是一个编码 Agent，工作在一个受限工作区内。

可用工具：
- read-file / list-dir：内置文件读取和目录列表
- write-file：创建或覆盖文件
- mcp__fs__search_files：搜索文件内容（正则表达式），返回文件路径和匹配行
- mcp__fs__edit_file：精确编辑文件（替换指定文本，不覆盖整个文件）
- mcp__fs__read_file / mcp__fs__list_directory：MCP 版本的文件读取和目录列表
- mcp__shell__shell_execute：执行 shell 命令（命令数组形式，如 ["pnpm","test"]，有安全限制）

工作规则：
1. 改文件前必须先 read-file 或 mcp__fs__read_file 确认当前内容
2. 小范围修改优先用 mcp__fs__edit_file，大范围重写才用 write-file
3. 找代码定义用 mcp__fs__search_files，不要一个个文件翻
4. 改完代码可以用 mcp__shell__shell_execute 跑测试或格式化
5. shell 命令用数组形式传参，如 ["node","-v"]，不要拼成字符串
6. 工具失败时分析原因再重试，不要盲目重复
7. 任务完成后用一句话总结结果

工具结果会被裁剪以节省上下文，省略部分用 [...省略 N 行...] 标记。`;
```

> **注意**：mcp-shell-server 的 `command` 参数是**数组**而非字符串，如 `["pnpm", "test"]`。提示词第 5 条规则提醒 Agent 用数组形式传参。

### 验收标准

- [ ] 安装 uv，`uvx --version` 正常输出
- [ ] 启动时控制台显示 `[MCP] shell: 1 个工具就绪`
- [ ] `mcp__fs__search_files` 能搜索整个 src 目录，返回文件名+行号+匹配内容
- [ ] `mcp__fs__edit_file` 能精确替换文件中的一段文本，不碰其他行
- [ ] `mcp__shell__shell_execute` 能执行 `["pnpm","test"]` 并返回输出
- [ ] 不在白名单的命令（如 `rm`）被 mcp-shell-server 拒绝
- [ ] MCP 工具的安全策略生效（搜索 allow，shell execute ask）
- [ ] 系统提示词已更新，Agent 知道并能调用这些工具
- [ ] 在 eval 评测集里加上使用 search_files 和 shell_execute 的任务，通过率不降

---

## Phase 9.2 RAG 语义检索

**目标**：把代码库向量化，让 Agent 能用自然语言搜索代码（「找处理用户登录的函数」），而不仅是正则匹配。

**你将学到**：向量嵌入（Embedding）、向量数据库、语义检索、索引管理。

### 为什么要做

grep 只能做正则匹配——你搜 `login` 能找到包含这个词的代码，但搜「处理用户认证的逻辑」就搜不到了。

RAG 的思路是：把每段代码转成向量（一组数字），搜索时也把查询转成向量，然后算向量距离找最相关的代码段。

### 设计思路

```
┌─────────────┐     embedding     ┌──────────────┐
│  代码文件    │ ───────────────► │  向量索引     │
│  (按 chunk)  │                  │  (内存/文件)  │
└─────────────┘                  └──────┬───────┘
                                        │
                 查询 "登录逻辑"         │ 语义搜索
                 ──────────────────────►│
                                        │
                                        ▼
                                 ┌──────────────┐
                                 │  Top-K 结果   │
                                 │  (代码段+路径) │
                                 └──────────────┘
```

### 具体步骤

#### 第 1 步：安装依赖

```bash
pnpm add openai    # 用 OpenAI embedding API（或用兼容的本地模型）
```

#### 第 2 步：定义 RAG 类型

新建 `src/rag/types.ts`：

```ts
// src/rag/types.ts
export interface CodeChunk {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  embedding: number[];
}

export interface SearchResult {
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  score: number;  // 相似度分数 0-1
}

export interface RagIndex {
  chunks: CodeChunk[];
  indexedAt: number;
  fileCount: number;
}
```

#### 第 3 步：写代码分块器

代码不能整文件塞给 embedding API（太长 + 太贵），需要按函数/类分块：

```ts
// src/rag/chunker.ts
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const IGNORE_DIRS = new Set(["node_modules", ".git", ".anvil", "dist", "build"]);
const MAX_CHUNK_LINES = 80;
const MIN_CHUNK_LINES = 5;
const SUPPORTED_EXT = new Set([".ts", ".js", ".tsx", ".jsx", ".py", ".go", ".rs", ".java"]);

export async function chunkCodebase(workspace: string): Promise<Omit<CodeChunk, "embedding" | "id">[]> {
  const chunks: Omit<CodeChunk, "embedding" | "id">[] = [];

  async function scanDir(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else if (SUPPORTED_EXT.has(getExt(entry.name))) {
        const fileChunks = await chunkFile(fullPath, workspace);
        chunks.push(...fileChunks);
      }
    }
  }

  await scanDir(workspace);
  return chunks;
}

async function chunkFile(filePath: string, workspace: string): Promise<Omit<CodeChunk, "embedding" | "id">[]> {
  const content = await readFile(filePath, "utf-8");
  const lines = content.split("\n");
  const relPath = relative(workspace, filePath);
  const chunks: Omit<CodeChunk, "embedding" | "id">[] = [];

  let currentBlock: string[] = [];
  let startLine = 1;

  for (let i = 0; i < lines.length; i++) {
    currentBlock.push(lines[i]!);

    const isBreak = lines[i]!.trim() === "" || currentBlock.length >= MAX_CHUNK_LINES;
    if (isBreak && currentBlock.length >= MIN_CHUNK_LINES) {
      chunks.push({
        filePath: relPath,
        startLine,
        endLine: i + 1,
        content: currentBlock.join("\n"),
      });
      startLine = i + 2;
      currentBlock = [];
    }
  }

  if (currentBlock.length >= MIN_CHUNK_LINES) {
    chunks.push({
      filePath: relPath,
      startLine,
      endLine: lines.length,
      content: currentBlock.join("\n"),
    });
  }

  return chunks;
}

function getExt(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx) : "";
}
```

#### 第 4 步：写 Embedding 服务

```ts
// src/rag/embedding.ts
import type { ProviderConfig } from "../provider/openai.ts";

const EMBEDDING_MODEL = "text-embedding-3-small";
const BATCH_SIZE = 100;

export class EmbeddingService {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: { apiKey: string; baseUrl?: string }) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
  }

  async embed(texts: string[]): Promise<number[][]> {
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const res = await fetch(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: batch,
        }),
      });

      if (!res.ok) {
        throw new Error(`Embedding API error: ${res.status} ${await res.text()}`);
      }

      const data = await res.json();
      allEmbeddings.push(...data.data.map((d: { embedding: number[] }) => d.embedding));
    }

    return allEmbeddings;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [embedding] = await this.embed([text]);
    return embedding!;
  }
}
```

#### 第 5 步：写向量索引和搜索

用内存里的简单余弦相似度，不引入外部向量数据库：

```ts
// src/rag/index.ts
import { writeFile, readFile, mkdir } from "node:fs/promises";
import type { CodeChunk, RagIndex, SearchResult } from "./types.ts";

const INDEX_PATH = ".anvil/rag-index.json";

export class RagIndexStore {
  private chunks: CodeChunk[] = [];
  private indexedAt = 0;
  private fileCount = 0;

  async load(): Promise<boolean> {
    try {
      const data = await readFile(INDEX_PATH, "utf-8");
      const idx = JSON.parse(data) as RagIndex;
      this.chunks = idx.chunks;
      this.indexedAt = idx.indexedAt;
      this.fileCount = idx.fileCount;
      return true;
    } catch {
      return false;
    }
  }

  async save(): Promise<void> {
    await mkdir(".anvil", { recursive: true });
    const index: RagIndex = {
      chunks: this.chunks,
      indexedAt: this.indexedAt,
      fileCount: this.fileCount,
    };
    await writeFile(INDEX_PATH, JSON.stringify(index), "utf-8");
  }

  setChunks(chunks: CodeChunk[]): void {
    this.chunks = chunks;
    this.indexedAt = Date.now();
    this.fileCount = new Set(chunks.map(c => c.filePath)).size;
  }

  search(queryEmbedding: number[], topK = 5): SearchResult[] {
    const scored = this.chunks.map(chunk => ({
      filePath: chunk.filePath,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      content: chunk.content,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }));

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  getStats() {
    return { chunks: this.chunks.length, files: this.fileCount, indexedAt: this.indexedAt };
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
```

#### 第 6 步：写 rag-search 工具

```ts
// src/rag/search-tool.ts
import { z } from "zod";
import type { Tool, ToolContext } from "../tools/types.ts";
import { register } from "../tools/registry.ts";
import { RagIndexStore } from "./index.ts";
import { EmbeddingService } from "./embedding.ts";
import { chunkCodebase } from "./chunker.ts";
import { apiKey, baseUrl } from "../config.ts";

const ragStore = new RagIndexStore();
let embeddingService: EmbeddingService | null = null;

function getEmbeddingService(): EmbeddingService {
  if (!embeddingService) {
    embeddingService = new EmbeddingService({ apiKey, baseUrl });
  }
  return embeddingService;
}

const ragSearchTool: Tool = {
  name: "rag-search",
  description: "语义搜索代码库。用自然语言描述你想找的代码，返回最相关的代码段。",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "自然语言查询，如'处理用户登录的函数'" },
      topK: { type: "number", description: "返回结果数，默认 5" },
    },
    required: ["query"],
  },

  async execute(args: Record<string, unknown>, _ctx: ToolContext) {
    const { query, topK = 5 } = z.object({
      query: z.string(),
      topK: z.number().default(5),
    }).parse(args);

    if (ragStore.getStats().chunks === 0) {
      return { ok: false, error: "索引为空，请先运行 rag-index 建立索引" };
    }

    try {
      const svc = getEmbeddingService();
      const queryEmbedding = await svc.embedQuery(query);
      const results = ragStore.search(queryEmbedding, topK);

      const output = results.map((r, i) =>
        `[${i + 1}] ${r.filePath}:${r.startLine}-${r.endLine} (score: ${r.score.toFixed(3)})\n${r.content}`
      ).join("\n\n");

      return { ok: true, output: output || "未找到相关代码" };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  },
};

const ragIndexTool: Tool = {
  name: "rag-index",
  description: "为代码库建立语义索引。建好后可用 rag-search 搜索。",
  inputSchema: { type: "object", properties: {}, required: [] },

  async execute(_args: Record<string, unknown>, ctx: ToolContext) {
    try {
      const rawChunks = await chunkCodebase(ctx.workspace);
      const svc = getEmbeddingService();
      const embeddings = await svc.embed(rawChunks.map(c => c.content));
      const chunks: CodeChunk[] = rawChunks.map((c, i) => ({
        id: `${c.filePath}:${c.startLine}`,
        ...c,
        embedding: embeddings[i]!,
      }));
      ragStore.setChunks(chunks);
      await ragStore.save();
      return { ok: true, output: `索引完成: ${chunks.length} 个 chunk, ${ragStore.getStats().files} 个文件` };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  },
};

export function registerRagTools() {
  ragStore.load().catch(() => {});
  register(ragSearchTool);
  register(ragIndexTool);
}
```

在 `safety/policy.ts` 里把这两个工具设为 `allow`：

```ts
const DEFAULT_POLICY: Record<string, Permission> = {
  // ... 已有的
  "rag-search": "allow",
  "rag-index": "allow",
};
```

在 `src/index.ts` 注册：

```ts
import { registerRagTools } from "./rag/search-tool.ts";
registerRagTools();
```

### 验收标准

- [ ] 运行 `rag-index` 能扫描整个 src 目录并生成索引文件 `.anvil/rag-index.json`
- [ ] 运行 `rag-search "处理工具注册的函数"` 能返回 `registry.ts` 的相关代码段
- [ ] 索引文件持久化，重启 Agent 不需要重新建索引
- [ ] 索引超过 100 个 chunk 时搜索延迟 < 500ms
- [ ] 在 eval 里加一个语义搜索任务，通过

---

## Phase 9.3 自动测试与修复循环

**目标**：Agent 改完代码后能自动跑测试，分析失败原因，自动修复，循环直到通过或达到重试上限。

**你将学到**：测试驱动开发（TDD）的 Agent 化、错误分析、重试策略、收敛检测。

### 为什么要做

现在 Agent 改完代码就结束了，不知道改对没有。如果 Agent 能：

1. 改完代码 → 自动跑测试
2. 测试失败 → 分析错误信息
3. 针对性修复 → 再跑测试
4. 循环直到通过或达到上限

这就是一个真正的「AI 编程助手」该有的能力。

### 设计思路

```
Agent 正常执行任务
         │
         ▼
    代码改完
         │
         ▼
   自动跑测试 ──────► 通过 ──► 完成
         │
         失败
         │
         ▼
   分析错误信息
         │
         ▼
   生成修复方案 ──── 修复代码
         │              │
         │◄─────────────┘
         ▼
   再跑测试 ──────► 通过 ──► 完成
         │
         失败 + 未达上限
         │
         ▼
   继续循环...
```

### 具体步骤

#### 第 1 步：定义修复循环类型

新建 `src/agent/auto-fix/types.ts`：

```ts
// src/agent/auto-fix/types.ts
export interface FixLoopOptions {
  testCommand: string;
  maxFixAttempts: number;
  workspace: string;
  onAttempt?: (attempt: number, result: FixAttemptResult) => void;
}

export interface FixAttemptResult {
  attempt: number;
  testPassed: boolean;
  testOutput: string;
  fixDescription?: string;
  fixedFiles?: string[];
  error?: string;
}

export interface FixLoopResult {
  success: boolean;
  totalAttempts: number;
  attempts: FixAttemptResult[];
  finalTestOutput: string;
}
```

#### 第 2 步：写测试运行器

```ts
// src/agent/auto-fix/test-runner.ts
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execP = promisify(exec);
const TEST_TIMEOUT = 60_000;

export interface TestResult {
  passed: boolean;
  output: string;
  error?: string;
}

export async function runTest(command: string, workspace: string): Promise<TestResult> {
  try {
    const { stdout, stderr } = await execP(command, {
      cwd: workspace,
      timeout: TEST_TIMEOUT,
      maxBuffer: 2 * 1024 * 1024,
    });

    const output = (stdout + stderr).trim();
    return { passed: true, output: output || "(无输出)" };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    const output = ((err.stdout ?? "") + (err.stderr ?? "")).trim();
    return {
      passed: false,
      output: output || err.message,
      error: err.message,
    };
  }
}
```

#### 第 3 步：写修复循环

```ts
// src/agent/auto-fix/loop.ts
import type { Provider } from "../../provider/index.ts";
import type { ToolContext } from "../../tools/index.ts";
import { runAgent } from "../loop.ts";
import { runTest } from "./test-runner.ts";
import type { FixLoopOptions, FixAttemptResult, FixLoopResult } from "./types.ts";

const FIX_PROMPT_PREFIX = `测试失败了，请分析错误信息并修复代码。

测试输出：
`;

const FIX_PROMPT_SUFFIX = `

要求：
1. 仔细分析错误信息，找到根本原因
2. 用 edit-file 精确修复，不要重写整个文件
3. 修复后不需要再跑测试，循环会自动处理`;

export async function runFixLoop(
  initialTask: string,
  provider: Provider,
  ctx: ToolContext,
  opts: FixLoopOptions,
): Promise<FixLoopResult> {
  const { testCommand, maxFixAttempts = 3, onAttempt } = opts;
  const attempts: FixAttemptResult[] = [];

  // 第 1 轮：执行原始任务
  await runAgent(initialTask, provider, ctx, undefined, {
    safetyOptions: { autoApprove: true },
    maxRounds: 10,
  });

  let testResult = await runTest(testCommand, ctx.workspace);
  const firstAttempt: FixAttemptResult = {
    attempt: 1,
    testPassed: testResult.passed,
    testOutput: testResult.output,
  };
  attempts.push(firstAttempt);
  onAttempt?.(1, firstAttempt);

  if (testResult.passed) {
    return { success: true, totalAttempts: 1, attempts, finalTestOutput: testResult.output };
  }

  // 第 2~N 轮：修复循环
  for (let i = 2; i <= maxFixAttempts + 1; i++) {
    const fixTask = FIX_PROMPT_PREFIX + testResult.output.slice(0, 4000) + FIX_PROMPT_SUFFIX;

    await runAgent(fixTask, provider, ctx, undefined, {
      safetyOptions: { autoApprove: true },
      maxRounds: 10,
    });

    testResult = await runTest(testCommand, ctx.workspace);
    const attempt: FixAttemptResult = {
      attempt: i,
      testPassed: testResult.passed,
      testOutput: testResult.output,
    };
    attempts.push(attempt);
    onAttempt?.(i, attempt);

    if (testResult.passed) {
      return { success: true, totalAttempts: i, attempts, finalTestOutput: testResult.output };
    }
  }

  return {
    success: false,
    totalAttempts: attempts.length,
    attempts,
    finalTestOutput: testResult.output,
  };
}
```

#### 第 4 步：暴露为 CLI 命令

在 `src/index.ts` 加一个 `fix` 命令：

```ts
// src/index.ts（追加）
import { runFixLoop } from "./agent/auto-fix/loop.ts";

async function fix() {
  const testCmd = rest[0] || "pnpm test";
  const task = rest.slice(1).join(" ").trim();
  if (!task) {
    console.error("用法: pnpm dev fix <test-command> <task>");
    process.exit(1);
  }

  console.error(`[auto-fix] 测试命令: ${testCmd}`);
  console.error(`[auto-fix] 任务: ${task}`);

  const result = await runFixLoop(task, provider, ctx, {
    testCommand: testCmd,
    maxFixAttempts: 3,
    workspace: ctx.workspace,
    onAttempt: (attempt, r) => {
      const icon = r.testPassed ? "✓" : "✗";
      console.error(`  ${icon} 第 ${attempt} 次: ${r.testPassed ? "测试通过" : "测试失败"}`);
    },
  });

  if (result.success) {
    console.error(`\n✅ 修复成功！共 ${result.totalAttempts} 次尝试。`);
  } else {
    console.error(`\n❌ 修复失败。尝试了 ${result.totalAttempts} 次。`);
    console.error(`最后一次测试输出:\n${result.finalTestOutput.slice(0, 2000)}`);
  }
}

const commands: Record<string, () => Promise<void>> = {
  // ... 已有的
  fix,
};
```

### 验收标准

- [ ] `pnpm dev fix "pnpm test" "修复 tool-system.test.ts 里的失败"` 能自动跑循环
- [ ] 循环最多重试 3 次，不会无限循环
- [ ] 每次修复尝试后自动跑测试，结果记录在 attempts 里
- [ ] 测试通过后立即停止，不再继续修复
- [ ] 所有尝试失败后输出最后一次测试结果

---

## Phase 9.4 插件系统

**目标**：让用户能写一个 npm 包作为插件，不用改 MiniHarness 源码就能加新工具、新 Provider。

**你将学到**：插件架构设计、动态加载、生命周期管理、接口契约。

### 为什么要做

现在加工具要改 `src/tools/` 下的文件然后重启。插件系统让你可以：

```bash
pnpm add miniharness-plugin-git   # 装 Git 插件
# 下次启动自动加载，Agent 就有了 git 工具
```

### 设计思路

```
┌─────────────────────────────────────────┐
│            MiniHarness 核心              │
│                                         │
│  ┌─────────┐  ┌──────────┐  ┌────────┐ │
│  │ Tool    │  │ Provider │  │ Safety │ │
│  │ Registry│  │ Factory  │  │ Policy │ │
│  └────┬────┘  └────┬─────┘  └────┬───┘ │
│       │            │             │      │
│       ▼            ▼             ▼      │
│  ┌────────────────────────────────────┐ │
│  │         Plugin Interface           │ │
│  │  - registerTools(registry)         │ │
│  │  - registerProvider(factory)       │ │
│  │  - onInit(ctx) / onDestroy()       │ │
│  └────────────────────────────────────┘ │
│       ▲                                 │
│       │ auto-discover                   │
└───────┼─────────────────────────────────┘
        │
   ┌────┴────┐
   ▼         ▼
 插件 A     插件 B    (node_modules 里的 npm 包)
```

### 具体步骤

#### 第 1 步：定义插件接口

新建 `src/plugin/types.ts`：

```ts
// src/plugin/types.ts
import type { Tool } from "../tools/types.ts";
import type { Provider } from "../provider/types.ts";
import type { Permission } from "../safety/types.ts";

export interface PluginContext {
  workspace: string;
  config: Record<string, unknown>;
}

export interface MiniHarnessPlugin {
  name: string;
  version: string;

  registerTools?(ctx: PluginContext): Tool[];
  registerProvider?(ctx: PluginContext): Provider | null;
  registerSafetyRules?(): Record<string, Permission>;

  onInit?(ctx: PluginContext): void | Promise<void>;
  onDestroy?(): void | Promise<void>;
}

export interface PluginModule {
  default: (ctx: PluginContext) => MiniHarnessPlugin;
}
```

#### 第 2 步：写安全策略桥接

```ts
// src/plugin/safety-bridge.ts
import type { Permission } from "../safety/types.ts";

const customRules = new Map<string, Permission>();

export function registerSafetyRules(rules: Record<string, Permission>): void {
  for (const [toolName, perm] of Object.entries(rules)) {
    customRules.set(toolName, perm);
  }
}

export function getCustomPermission(toolName: string): Permission | undefined {
  return customRules.get(toolName);
}
```

在 `safety/policy.ts` 的 `checkPolicy` 里加入自定义规则查询：

```ts
// safety/policy.ts（修改 checkPolicy）
import { getCustomPermission } from "../plugin/safety-bridge.ts";

export function checkPolicy(inv: ToolInvocation, opts: SafetyOptions = {}): Permission {
    const { toolName, args, workspace } = inv;
    const logger = opts.logger;

    // 先查插件注册的自定义规则
    const customPerm = getCustomPermission(toolName);
    if (customPerm) {
        logger?.({ kind: customPerm, tool: toolName, reason: `插件规则: ${customPerm}` });
        return customPerm;
    }

    const defaultPerm = DEFAULT_POLICY[toolName] ?? "ask";
    // ... 后续逻辑不变
}
```

#### 第 3 步：写插件加载器

```ts
// src/plugin/loader.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MiniHarnessPlugin, PluginContext, PluginModule } from "./types.ts";
import { register } from "../tools/registry.ts";
import { registerSafetyRules } from "./safety-bridge.ts";

const PLUGIN_PREFIX = "miniharness-plugin-";

export async function loadPlugins(baseCtx: PluginContext): Promise<MiniHarnessPlugin[]> {
  const loaded: MiniHarnessPlugin[] = [];

  // 自动发现 package.json 中的插件依赖
  let names: string[] = [];
  try {
    const pkg = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf-8"));
    names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
      .filter(n => n.startsWith(PLUGIN_PREFIX));
  } catch { /* 无 package.json 则跳过 */ }

  for (const pkgName of names) {
    try {
      const mod = await import(pkgName) as PluginModule;
      const plugin = mod.default(baseCtx);
      await plugin.onInit?.(baseCtx);

      if (plugin.registerTools) {
        for (const tool of plugin.registerTools(baseCtx)) {
          register(tool);
          console.error(`[plugin:${plugin.name}] 注册工具: ${tool.name}`);
        }
      }
      if (plugin.registerSafetyRules) {
        registerSafetyRules(plugin.registerSafetyRules());
      }

      loaded.push(plugin);
      console.error(`[plugin:${plugin.name}] v${plugin.version} 已加载`);
    } catch (e) {
      console.error(`[plugin:${pkgName}] 加载失败: ${e}`);
    }
  }

  return loaded;
}
```

#### 第 4 步：在入口启动插件

```ts
// src/index.ts（追加）
import { loadPlugins } from "./plugin/loader.ts";

const plugins = await loadPlugins({ workspace, config: {} });
process.on("exit", () => {
  for (const p of plugins) p.onDestroy?.();
});
```

#### 第 5 步：写一个示例插件

创建 `src/plugins/git/index.ts` 作为示例：

```ts
// src/plugins/git/index.ts
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { MiniHarnessPlugin, PluginContext } from "../../plugin/types.ts";
import type { Tool } from "../../tools/types.ts";

const execP = promisify(exec);

const gitStatusTool: Tool = {
  name: "git-status",
  description: "显示 Git 工作区状态",
  inputSchema: { type: "object", properties: {}, required: [] },
  async execute(_args, ctx) {
    try {
      const { stdout } = await execP("git status --short", { cwd: ctx.workspace });
      return { ok: true, output: stdout || "工作区干净" };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  },
};

const gitDiffTool: Tool = {
  name: "git-diff",
  description: "显示 Git diff",
  inputSchema: {
    type: "object",
    properties: {
      cached: { type: "boolean", description: "是否只看暂存区" },
    },
    required: [],
  },
  async execute(args, ctx) {
    const { cached = false } = z.object({ cached: z.boolean().default(false) }).parse(args);
    try {
      const cmd = cached ? "git diff --cached" : "git diff";
      const { stdout } = await execP(cmd, { cwd: ctx.workspace });
      return { ok: true, output: stdout || "无差异" };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  },
};

export default function (_ctx: PluginContext): MiniHarnessPlugin {
  return {
    name: "git",
    version: "1.0.0",
    registerTools() {
      return [gitStatusTool, gitDiffTool];
    },
    registerSafetyRules() {
      return {
        "git-status": "allow",
        "git-diff": "allow",
      };
    },
  };
}
```

### 验收标准

- [ ] 内置的 git 示例插件能自动发现并加载
- [ ] 加载后 Agent 的工具列表里有 `git-status` 和 `git-diff`
- [ ] 插件注册的安全规则生效（git 工具默认 allow）
- [ ] 插件的 `onInit` 和 `onDestroy` 被正确调用
- [ ] 插件加载失败不影响主程序启动

---

## Phase 9.5 HTTP API 服务

**目标**：把 Agent 暴露为 HTTP API，其他程序可以通过 REST 调用，通过 WebSocket 获取流式输出。

**你将学到**：HTTP 服务器、REST API 设计、WebSocket 流式传输、JSON 中间件。

### 为什么要做

现在 Agent 只能命令行用。如果你想让：

- VS Code 插件调用 Agent
- Web 前端集成 Agent
- CI/CD 管道自动调用 Agent

就需要把 Agent 变成一个 HTTP 服务。

### 具体步骤

#### 第 1 步：用 Node.js 内置 http 模块搭建服务器

不引入 express 等框架，保持轻量：

```ts
// src/server/http.ts
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createProvider } from "../provider/index.ts";
import { runAgent } from "../agent/index.ts";
import { registerFileTools } from "../tools/index.ts";
import { createSession, loadSession, listSessions } from "../session/index.ts";

const PORT = 3000;
const workspace = process.cwd();

registerFileTools();
const provider = createProvider();

async function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => data += chunk);
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

function sendJSON(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

export function startServer(port = PORT) {
  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url!, `http://localhost:${port}`);
    const path = url.pathname;
    const method = req.method!;

    try {
      // POST /api/ask — 单轮任务
      if (path === "/api/ask" && method === "POST") {
        const body = await parseBody(req) as { task: string };
        if (!body.task) { sendJSON(res, 400, { error: "task is required" }); return; }

        const session = await createSession();
        const result = await runAgent(body.task, provider, { workspace }, undefined, {
          session,
          safetyOptions: { autoApprove: true },
        });
        sendJSON(res, 200, {
          answer: result.answer,
          sessionId: session.id,
          metrics: result.metrics,
        });
        return;
      }

      // GET /api/sessions — 列出会话
      if (path === "/api/sessions" && method === "GET") {
        const sessions = await listSessions();
        sendJSON(res, 200, sessions.map(s => ({
          id: s.id, title: s.title, state: s.state, updatedAt: s.updatedAt,
        })));
        return;
      }

      // GET /api/sessions/:id — 获取会话详情
      const sessionMatch = path.match(/^\/api\/sessions\/([\w-]+)$/);
      if (sessionMatch && method === "GET") {
        const session = await loadSession(sessionMatch[1]!);
        if (!session) { sendJSON(res, 404, { error: "Session not found" }); return; }
        sendJSON(res, 200, session);
        return;
      }

      // POST /api/chat — 多轮对话（恢复会话）
      if (path === "/api/chat" && method === "POST") {
        const body = await parseBody(req) as { sessionId: string; message: string };
        const session = await loadSession(body.sessionId);
        if (!session) { sendJSON(res, 404, { error: "Session not found" }); return; }

        const result = await runAgent(body.message, provider, { workspace }, undefined, {
          session,
          safetyOptions: { autoApprove: true },
        });
        sendJSON(res, 200, { answer: result.answer, sessionId: session.id });
        return;
      }

      sendJSON(res, 404, { error: "Not found", path });
    } catch (e) {
      sendJSON(res, 500, { error: String(e) });
    }
  });

  server.listen(port, () => {
    console.log(`MiniHarness API server running at http://localhost:${port}`);
  });

  return server;
}
```

#### 第 2 步：加 WebSocket 流式输出

```ts
// src/server/websocket.ts
import { WebSocketServer, type WebSocket } from "ws";
import { createProvider } from "../provider/index.ts";
import { runAgent, type LoopEvent } from "../agent/index.ts";
import { createSession } from "../session/index.ts";
import { registerFileTools } from "../tools/index.ts";

const workspace = process.cwd();
registerFileTools();
const provider = createProvider();

export function startWebSocketServer(port: number) {
  const wss = new WebSocketServer({ port });

  wss.on("connection", (ws: WebSocket) => {
    ws.on("message", async (data: Buffer) => {
      let msg: { task: string };
      try { msg = JSON.parse(data.toString()); }
      catch { ws.send(JSON.stringify({ type: "error", error: "Invalid JSON" })); return; }

      const session = await createSession();

      ws.send(JSON.stringify({ type: "start", sessionId: session.id }));

      try {
        const result = await runAgent(msg.task, provider, { workspace }, undefined, {
          session,
          safetyOptions: { autoApprove: true },
          onEvent: (e: LoopEvent) => {
            ws.send(JSON.stringify(e));
          },
        });

        ws.send(JSON.stringify({
          type: "done",
          answer: result.answer,
          metrics: result.metrics,
        }));
      } catch (e) {
        ws.send(JSON.stringify({ type: "error", error: String(e) }));
      }
    });
  });

  console.log(`WebSocket server running at ws://localhost:${port}`);
  return wss;
}
```

> 需要安装 `ws` 包：`pnpm add ws` 和 `pnpm add -D @types/ws`

#### 第 3 步：加 serve 命令

```ts
// src/index.ts（追加）
async function serve() {
  const port = parseInt(rest[0] || "3000");
  const wsPort = port + 1;

  const { startServer } = await import("./server/http.ts");
  const { startWebSocketServer } = await import("./server/websocket.ts");

  startServer(port);
  startWebSocketServer(wsPort);
}

const commands: Record<string, () => Promise<void>> = {
  // ... 已有的
  serve,
};
```

#### 第 4 步：测试 API

```bash
# 启动服务
pnpm dev serve 3000

# 另一个终端测试
curl -X POST http://localhost:3000/api/ask \
  -H "Content-Type: application/json" \
  -d '{"task": "读取 package.json 告诉我项目名"}'

# 列出会话
curl http://localhost:3000/api/sessions
```

### 验收标准

- [ ] `pnpm dev serve` 启动 HTTP 服务，监听 3000 端口
- [ ] `POST /api/ask` 能执行任务并返回 JSON 结果
- [ ] `GET /api/sessions` 能列出所有会话
- [ ] WebSocket 连接能实时收到 Agent 的思考、工具调用、文本增量事件
- [ ] API 报错时返回合理的 HTTP 状态码和错误信息
- [ ] CORS 头正确设置，浏览器能跨域调用

---

## 写在最后

Phase 9 完成后，你的 MiniHarness 已经是一个**真正可用的开发者工具**了：

- 有完整的工具集（搜索、编辑、执行）
- 有语义检索能力（RAG）
- 能自动测试和修复代码
- 支持插件扩展
- 能作为 HTTP 服务被其他程序调用

**下一步探索方向**：

- **多 Agent 协作**：多个 Agent 平等对话而非主子关系
- **代码审查 Agent**：自动 PR Review + 安全漏洞检测
- **持续记忆**：跨会话的知识库，Agent 记住你的项目约定
- **GUI 客户端**：Web/Tauri 前端 + HTTP API 后端

**慢慢来，比较快。**
