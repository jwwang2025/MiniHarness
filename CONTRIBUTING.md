# MiniHarness 贡献指南 / PR 要求

> **两条不可动摇的宗旨：**
> 1. **保证代码轻量化** —— 这是一个教学型 Agent 框架，"减少隐藏复杂度"是第一性原则。
> 2. **不大幅修改项目工作流程** —— 现有的分支模型、提交规范、测试方式、TS 配置已就位，PR 应顺应而非重写它们。

在提交 PR 之前，请完整阅读本文档。凡与上述两条宗旨冲突的改动，将在 Review 阶段被要求修改或关闭。

---

## 一、轻量化要求（核心）

MiniHarness 的设计哲学是**用最少的依赖、最透明的实现，讲清楚 Agent 的每一层**。README 中"为什么用 JSON 而不是 SQLite""为什么零第三方 HTTP 客户端"等决策，都是这一哲学的体现。你的 PR 必须延续它。

### 1.1 依赖管理 —— 默认不引入新依赖

当前运行时依赖仅 6 个：`zod`、`gpt-tokenizer`、`marked`、`marked-terminal`、`ora`、`picocolors`。

- **新增任何 `dependencies` 前，必须先回答**：能否用 Node.js 标准库（`fs/promises`、`path`、`fetch`、`crypto` 等）或现有依赖实现？
- 教学项目的价值在于**代码可读、可审计**。每多一个依赖，就多一层"黑盒"，违背"减少隐藏复杂度"。
- 若确有必要新增依赖，需在 PR 描述中单独说明：**为何无法用标准库 / 现有依赖替代、该依赖的体积、是否可 tree-shake**。
- 禁止引入"图方便"型依赖（如 `lodash` 整包用于一两个函数、`axios` 替代原生 `fetch`）。
- 开发依赖（`devDependencies`）同样从严，禁止引入测试框架（见 1.3）。

### 1.2 零构建 —— 不引入编译 / 打包步骤

项目通过 `tsx` 直接运行 `.ts` 源码，`tsconfig.json` 中 `noEmit: true`。

- **禁止**引入编译、打包、转译步骤（`tsc` 输出、`esbuild` bundle、`webpack`、`vite build` 等）。
- **禁止**新增 `dist/`、`build/` 产物或修改 `package.json` 的 `exports`/`main` 指向编译产物。
- 保持"改完即跑"的体验：`pnpm dev` 与 `pnpm test:all` 直接作用于源码。

### 1.3 零隐藏复杂度 —— 不替换底层实现形态

下列"刻意简单"的实现是项目的设计决策，PR **不应**以"更专业"为由替换：

| 现有实现 | 禁止替换为 | 理由 |
|:--|:--|:--|
| JSON 文件存储 (`.anvil/sessions/`) | SQLite / 其它数据库 | 肉眼可读、可调试，"持久化到底存了什么"一目了然 |
| 纯 TS 自研测试框架 | vitest / jest / mocha | 零依赖、无 mock、基于真实文件系统，保证可信度 |
| 原生 `fetch` + `ReadableStream` | axios / undici / got | 代码精简透明，SSE 解析逻辑可见 |
| `Map<string, Tool>` 注册表 | 装饰器 / 依赖注入框架 | 扩展零侵入，机制透明 |

### 1.4 代码本身要轻

- **不做过度抽象**：三处相似代码优于一个过早的泛化基类。不为"未来可能的需求"设计接口。
- **不加非必要错误处理**：信任内部代码与框架保证，仅在与外部边界（用户输入、文件系统、LLM API）交互处校验。
- **不写冗余注释**：命名良好的标识符已说明"做什么"；注释只写"为什么"——隐藏约束、不变量、反直觉的 workaround。
- **不引入向后兼容垫片**：直接修改代码，不留 `_unused` 变量、`// removed` 残注释、re-export 兼容层。
- 单文件改动尽量聚焦，避免"顺手清理"无关代码。

---

## 二、工作流程要求（不大幅修改）

请顺应以下既有约定，**不要**在 PR 中改动它们本身（如重构分支策略、切换包管理器、改写 tsconfig 基础选项）。

### 2.1 分支模型

- 功能开发从 `main` 切出 `feat/<scope>` 分支，完成后提 PR 合回 `main`。
- 修复用 `fix/<scope>`，重构用 `refactor/<scope>`，文档用 `docs/<scope>`。
- **不要**引入新的长期分支或改变 `main` 作为集成分支的定位。
- 一个 PR 聚焦一个主题，避免跨多个不相关模块的大杂烩。

### 2.2 提交信息 — Conventional Commits（带 scope）

现有历史已严格遵循此规范，请保持：

```
<type>(<scope>): <简短描述>
```

- **type**：`feat` / `fix` / `refactor` / `docs` / `test` / `chore` / `perf`
- **scope**：受影响模块，如 `cli`、`provider`、`eval`、`agent`、`safety`、`session`、`tools`、`context`
- 示例：`feat(eval): add evaluation runner and reporting logic`、`refactor(provider): refactor type system for centralized model types`
- 描述用祈使句、首字母小写、结尾无句号。
- PR 标题应能直接作为 squash merge 的提交信息，遵循同一规范。

### 2.3 测试要求

- **测试必须通过**：提交前本地运行 `pnpm test:all`（及你改动模块对应的 `pnpm test:<module>`）。
- **不引入测试框架**：新增测试沿用 `test/` 目录下纯 TS、零依赖、真实文件系统（不 mock）的风格。
- **新增功能须配测试**：新增工具、安全策略、上下文逻辑等，需补充对应测试用例，覆盖正常路径与边界条件。
- 修复 bug 须先加一个能复现该 bug 的测试，再修复，确保回归被钉住。
- 涉及 LLM 真实调用的测试（如 `truncate.test.ts`）保留"需 API Key"的标注，不强行 mock。

### 2.4 TypeScript 严格性

`tsconfig.json` 开启了 `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `verbatimModuleSyntax` + `nodenext`。PR 代码必须在此配置下零类型错误：

- **`verbatimModuleSyntax`**：类型导入必须用 `import type { ... }`，不得与值导入混用。
- **`nodenext`**：相对/绝对 import 路径**必须带 `.ts` 扩展名**（`import { foo } from "./foo.ts"`）。
- **`exactOptionalPropertyTypes`**：可选属性不可通过赋 `undefined` 来"省略"，必须真正不设置该键。
- **`noUncheckedIndexedAccess`**：数组/对象索引访问结果含 `undefined`，需显式收窄。
- **禁止** `any`、`as unknown as X` 式强转、`// @ts-ignore`（如确有必要用 `// @ts-expect-error` 并附原因）。
- 不要为了绕过类型检查而放宽 tsconfig 选项。

### 2.5 环境与敏感信息

- `.env`、`.anvil/` 均已在 `.gitignore` 中，**绝不提交**。
- 新增环境变量须同步更新 `.env.example`（仅占位，不含真实值），并在 PR 描述中说明。
- 不提交 `node_modules/`、构建产物、`*.log`、IDE 配置（`.vscode/*`、`.idea/`，白名单项除外）。

---

## 三、PR 提交清单

提 PR 前，逐项自检：

- [ ] 改动符合"轻量化"宗旨，未引入非必要依赖 / 编译步骤 / 隐藏复杂度
- [ ] 未改动既有工作流程本身（分支模型、提交规范、测试方式、tsconfig 基础选项）
- [ ] 提交信息与 PR 标题遵循 Conventional Commits 带 scope
- [ ] `pnpm test:all` 全部通过
- [ ] 新增功能已配测试，bug 修复已加回归测试
- [ ] 代码在现有严格 tsconfig 下零类型错误（含 `.ts` 扩展名、`import type`、无 `any`）
- [ ] 未提交 `.env`、`.anvil/`、`node_modules/`、构建产物
- [ ] 新增环境变量已更新 `.env.example`
- [ ] PR 描述说明了"为什么改"而非仅"改了什么"，新增依赖时单独论证必要性

---

## 四、Review 视角

维护者会优先从以下角度审视 PR，请提交时自行对照：

1. **轻量化**：这个改动是否让项目变"重"了？依赖、抽象层、复杂度是否可砍？
2. **工作流一致性**：是否顺应了既有分支 / 提交 / 测试 / 类型约定？
3. **教学可读性**：代码是否便于学习者理解 Agent 的实现细节？是否引入了"魔法"？
4. **聚焦度**：PR 是否单一主题、改动范围可控、无夹带的无关重构？

满足以上要求的 PR 会更快合并。感谢你对 MiniHarness 的贡献。
