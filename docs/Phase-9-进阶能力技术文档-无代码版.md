# Phase 9：进阶能力技术文档（无代码版）

> 适用阶段：已完成 Phase 0-8
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
| Agent 只能靠翻文件找代码，不懂语义 | 代码库向量化，语义检索一步到位 |
| 改完代码不知道对不对，要手动跑测试 | Agent 自己跑测试、分析失败、自动修复 |
| 加工具只能改源码重新启动 | 插件系统，热加载外部工具包 |
| 只能命令行用，没法集成到其他系统 | HTTP API，其他程序能调用你的 Agent |

### 子阶段依赖关系

```
9.1 增强工具集（grep/edit/shell）  ←  地基
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

**建议顺序**：9.1 必须先做，9.2 和 9.3 可以并行，9.4 需要前面都完成，9.5 放最后。

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

- 296 次提交，MIT 许可，活跃维护
- **命令白名单**：通过 `ALLOW_COMMANDS` 环境变量配置，不在白名单里的命令直接拒绝
- **argv 执行**：命令以数组形式传递，不经过 shell 字符串解释（防注入）
- **环境隔离**：子进程不继承父进程的密钥和 Token
- **审计日志**：每次调用记录命令、耗时、退出码，敏感信息自动脱敏
- **执行限制**：可配置超时（默认 30s，上限 300s）和输出大小上限（默认 1MB）
- **参数硬化**：即使命令在白名单里，也会拦截 `find -exec`、`xargs`、`git -c` 等执行向量

### 关键设计决策

**双层安全模型**：mcp-shell-server 自身有命令白名单（第一层），只允许配置的命令执行；MiniHarness 的安全策略再加一层审批（第二层），用户可在执行前拒绝。即使白名单允许 `git`，用户仍可 deny。

**MCP 工具的安全策略**：MCP 工具注册到 registry 后默认是 `ask`，需要在 `DEFAULT_POLICY` 里为只读工具（search_files / read_file / list_directory）设为 `allow`，写操作（write_file / edit_file / create_directory / shell_execute）设为 `ask`。

**命令数组而非字符串**：mcp-shell-server 的 `command` 参数是数组形式如 `["pnpm", "test"]`，而非字符串 `"pnpm test"`。这避免了 shell 注入风险，系统提示词需要提醒 Agent 用数组形式传参。

**搜索 vs read-file 的边界**：search_files 是「找在哪」，read-file 是「看内容」。Agent 应该先搜索定位再读取，而不是一个个文件翻。

**edit_file vs write-file 的边界**：edit_file 是「改一处」，write-file 是「全量重写」。小修改用 edit_file 更安全（不会误删其他内容），大重构才用 write-file。

### 实现步骤清单

1. 安装 uv（Python 包管理器，类似 npx）
2. 在 `.env` 的 `MINIHARNESS_MCP_SERVERS` 里加上 shell 服务器配置
3. 在 safety/policy.ts 的 DEFAULT_POLICY 里为所有 MCP 工具配置安全策略
4. 更新系统提示词，把所有 MCP 工具告诉 Agent（注意提醒数组传参）
5. 在 eval 评测集里加上使用 search_files 和 shell_execute 的任务

### 验收标准

- [ ] 安装 uv，`uvx --version` 正常输出
- [ ] 启动时控制台显示 `[MCP] shell: 1 个工具就绪`
- [ ] `mcp__fs__search_files` 能搜索整个 src 目录，返回文件名+行号+匹配内容
- [ ] `mcp__fs__edit_file` 能精确替换文件中的一段文本，不碰其他行
- [ ] `mcp__shell__shell_execute` 能执行 `["pnpm","test"]` 并返回输出
- [ ] 不在白名单的命令（如 `rm`）被 mcp-shell-server 拒绝
- [ ] MCP 工具的安全策略生效（搜索 allow，shell execute ask）
- [ ] 系统提示词已更新，Agent 知道并能调用这些工具
- [ ] eval 评测集加了新任务，通过率不降

---

## Phase 9.2 RAG 语义检索

**目标**：把代码库向量化，让 Agent 能用自然语言搜索代码。

**你将学到**：向量嵌入（Embedding）、向量数据库、语义检索、索引管理。

### 为什么要做

grep 只能做正则匹配——你搜 `login` 能找到包含这个词的代码，但搜「处理用户认证的逻辑」就搜不到了。

RAG 的思路是：把每段代码转成向量（一组数字），搜索时也把查询转成向量，然后算向量距离找最相关的代码段。

### 核心设计

整个 RAG 系统分四个部分：

1. **分块器（Chunker）**：把代码文件按函数/段落切成小块（chunk），每块不超过 80 行
2. **嵌入服务（Embedding Service）**：调 Embedding API 把文本转成向量
3. **向量索引（Vector Index）**：存储 chunk + 向量，提供余弦相似度搜索
4. **搜索工具（rag-search）**：Agent 调用，输入自然语言查询，返回 top-K 相关代码段

### 关键设计决策

**分块策略**：按空行分块，每块 5-80 行。太短没上下文，太长 embedding 效果差且浪费 token。支持 .ts/.js/.py/.go 等主流语言。

**向量存储**：用 JSON 文件持久化（`.anvil/rag-index.json`），不引入外部向量数据库。余弦相似度计算在内存中做。项目规模在几千个 chunk 以内时性能足够。

**Embedding 模型**：用 OpenAI 的 `text-embedding-3-small`（1536 维，便宜）。也可以用本地模型或兼容 API。

**两个工具**：
- `rag-index`：扫描代码库 → 分块 → embedding → 保存索引。只在首次或代码大改后运行
- `rag-search`：输入自然语言 → embedding → 向量搜索 → 返回相关代码段

**索引加载**：Agent 启动时自动加载已有索引文件，不需要每次重新建。

### 实现步骤清单

1. 定义 CodeChunk、SearchResult、RagIndex 类型
2. 写分块器：递归扫描 + 按空行分块 + 跳过忽略目录
3. 写 Embedding 服务：批量调用 API + 返回向量数组
4. 写向量索引存储：JSON 持久化 + 余弦相似度搜索
5. 写两个工具：rag-index（建索引）+ rag-search（搜索）
6. 在 index.ts 注册工具，启动时加载已有索引
7. 安全策略：两个工具都设为 allow

### 验收标准

- [ ] 运行 rag-index 能扫描整个 src 目录并生成索引文件
- [ ] rag-search "处理工具注册的函数" 能返回 registry.ts 的相关代码段
- [ ] 索引文件持久化，重启 Agent 不需要重新建索引
- [ ] 索引超过 100 个 chunk 时搜索延迟 < 500ms
- [ ] eval 里加了语义搜索任务，通过

---

## Phase 9.3 自动测试与修复循环

**目标**：Agent 改完代码后能自动跑测试，分析失败原因，自动修复，循环直到通过或达到重试上限。

**你将学到**：TDD 的 Agent 化、错误分析、重试策略、收敛检测。

### 为什么要做

现在 Agent 改完代码就结束了，不知道改对没有。如果 Agent 能：

1. 改完代码 → 自动跑测试
2. 测试失败 → 分析错误信息
3. 针对性修复 → 再跑测试
4. 循环直到通过或达到上限

这就是一个真正的「AI 编程助手」该有的能力。

### 核心设计

```
执行原始任务 → 跑测试
                  │
           通过 ←─┘ 否则 → 分析错误 → 修复代码 → 跑测试
                                              │
                                       通过 ←─┘ 否则 → 循环...
```

### 关键设计决策

**测试结果怎么判断通过**：exec 的退出码，0 = 通过，非 0 = 失败。即使失败也返回 stdout/stderr 内容，让 Agent 能分析错误。

**修复任务怎么构造**：把测试输出（截断到 4000 字符防上下文爆炸）+ 固定的修复指令模板拼成新任务，交给 Agent 执行。修复指令要求用 edit-file 精确修复，不要重写整个文件。

**重试上限**：默认 3 次。防止无限循环烧钱。超过上限就返回所有尝试的历史记录。

**安全策略**：修复循环用 autoApprove: true，不需要人工确认（已经在一个受控的修复流程里了）。

**收敛检测**：如果连续两次修复都是同一个错误，说明 Agent 陷入了死循环，应该提前终止。这个可以作为进阶优化。

### 三个核心组件

**测试运行器**：执行测试命令，返回 { passed, output, error }。超时 60 秒。

**修复循环器**：执行原始任务 → 跑测试 → 如果失败，构造修复任务（测试输出 + 修复指令）→ Agent 执行修复 → 再跑测试 → 循环。

**结果记录**：每次尝试记录 attempt 号、是否通过、测试输出。最终返回是否成功、总尝试次数、所有尝试历史。

### 实现步骤清单

1. 定义 FixLoopOptions、FixAttemptResult、FixLoopResult 类型
2. 写测试运行器：exec + 超时 + 输出收集
3. 写修复循环器：执行任务 → 跑测试 → 失败则构造修复任务 → 循环
4. 构造修复任务模板：测试输出 + 修复指令（用 edit-file 不要重写）
5. 在 CLI 加 fix 命令：`pnpm dev fix "pnpm test" "任务描述"`
6. 每次尝试通过 onAttempt 回调通知进度

### 验收标准

- [ ] fix 命令能自动跑循环
- [ ] 循环最多重试 3 次，不会无限循环
- [ ] 每次修复尝试后自动跑测试，结果记录在 attempts 里
- [ ] 测试通过后立即停止
- [ ] 所有尝试失败后输出最后一次测试结果

---

## Phase 9.4 插件系统

**目标**：让用户能写一个 npm 包作为插件，不用改 MiniHarness 源码就能加新工具、新 Provider。

**你将学到**：插件架构设计、动态加载、生命周期管理、接口契约。

### 为什么要做

现在加工具要改 src/tools/ 下的文件然后重启。插件系统让你可以：

```bash
pnpm add miniharness-plugin-git   # 装 Git 插件
# 下次启动自动加载，Agent 就有了 git 工具
```

### 核心设计

插件是一个实现了 `MiniHarnessPlugin` 接口的 npm 包。接口包含：

- **name + version**：插件标识
- **registerTools(ctx)**：返回工具列表，自动注册到 registry
- **registerProvider(ctx)**：返回 Provider 实例（可选）
- **registerSafetyRules()**：返回工具→权限的映射（可选）
- **onInit(ctx) / onDestroy()**：生命周期钩子

**插件命名约定**：包名以 `miniharness-plugin-` 开头，加载器自动发现。

**加载流程**：
1. 读配置文件（`.anvil/plugins.json`）或自动扫描 node_modules
2. 动态 import 插件包
3. 调用默认导出函数，传入 PluginContext
4. 调用 onInit
5. 注册工具到 registry
6. 注册安全规则到 policy
7. 进程退出时调用 onDestroy

### 关键设计决策

**插件能覆盖安全策略**：插件可以注册自己的安全规则（比如 git-status 默认 allow）。需要一个运行时可追加的策略表，在 checkPolicy 里优先查自定义规则。

**加载失败不阻塞**：单个插件加载失败只打日志，不影响主程序和其他插件启动。

**自动发现 vs 显式配置**：默认自动扫描 package.json 里的 `miniharness-plugin-*` 依赖。也支持用 `.anvil/plugins.json` 显式指定启用哪些。

**PluginContext 传什么**：workspace 路径 + 配置对象（从环境变量或配置文件来）。让插件能知道工作区在哪。

### 实现步骤清单

1. 定义 MiniHarnessPlugin 接口 + PluginContext 类型
2. 写插件加载器：自动发现 + 动态 import + 生命周期调用
3. 写安全策略桥接：运行时可追加规则表 + checkPolicy 查询
4. 在 safety/policy.ts 的 checkPolicy 里优先查自定义规则
5. 在 index.ts 启动时加载插件，退出时调用 onDestroy
6. 写一个内置的 git 示例插件（git-status + git-diff）

### 验收标准

- [ ] 内置的 git 示例插件能自动发现并加载
- [ ] 加载后 Agent 的工具列表里有 git-status 和 git-diff
- [ ] 插件注册的安全规则生效
- [ ] 插件的 onInit 和 onDestroy 被正确调用
- [ ] 插件加载失败不影响主程序启动

---

## Phase 9.5 HTTP API 服务

**目标**：把 Agent 暴露为 HTTP API，其他程序可以通过 REST 调用，通过 WebSocket 获取流式输出。

**你将学到**：HTTP 服务器、REST API 设计、WebSocket 流式传输。

### 为什么要做

现在 Agent 只能命令行用。如果你想让：

- VS Code 插件调用 Agent
- Web 前端集成 Agent
- CI/CD 管道自动调用 Agent

就需要把 Agent 变成一个 HTTP 服务。

### API 设计

| 端点 | 方法 | 作用 |
|------|------|------|
| `/api/ask` | POST | 单轮任务，返回答案 + sessionId |
| `/api/chat` | POST | 多轮对话，传入 sessionId + message |
| `/api/sessions` | GET | 列出所有会话 |
| `/api/sessions/:id` | GET | 获取会话详情 |
| WebSocket | — | 流式输出，实时推送思考/工具调用/文本增量 |

### 关键设计决策

**不用框架**：用 Node.js 内置 http 模块，保持轻量，和项目的「零额外依赖」理念一致。WebSocket 用 `ws` 包（这是唯一需要加的依赖）。

**CORS**：设置 `Access-Control-Allow-Origin: *`，方便浏览器前端调用。

**安全策略**：API 模式下用 autoApprove: true，不交互式确认。生产环境应该加 API Key 鉴权。

**WebSocket 流式**：客户端连接后发 JSON `{ task: "..." }`，服务端把 LoopEvent 逐个推送回去。客户端能看到 Agent 的思考过程、工具调用、文本增量，而不是等最后才看到答案。

**JSON body 解析**：简单实现，不引入 body-parser。读流 → 拼字符串 → JSON.parse。

### 实现步骤清单

1. 写 HTTP 服务器：用 http.createServer + 路由分发
2. 实现 4 个 REST 端点：ask / chat / sessions / sessions/:id
3. 加 CORS 头 + OPTIONS 预检处理
4. 写 WebSocket 服务器：连接后收消息 → 调 runAgent → 推送 LoopEvent
5. 在 CLI 加 serve 命令
6. 用 curl 测试 REST API

### 验收标准

- [ ] serve 命令启动 HTTP 服务，监听 3000 端口
- [ ] POST /api/ask 能执行任务并返回 JSON 结果
- [ ] GET /api/sessions 能列出所有会话
- [ ] WebSocket 连接能实时收到 Agent 事件
- [ ] API 报错时返回合理的 HTTP 状态码和错误信息
- [ ] CORS 头正确设置

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
