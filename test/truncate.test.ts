import type { ChatMessage } from "../src/config.ts";
import { truncate, DEFAULT_CTX } from "../src/agent/context.ts";
import { estimateMessagesTokens, estimateTokens } from "../src/agent/tokens.ts";
import { summarizeMessages } from "../src/agent/summarizer.ts";
import { chatWithTools } from "../src/provider/openai.ts";
import { registerFileTools } from "../src/tools/file-tools.ts";
import { toOpenAITools, getTool } from "../src/tools/registry.ts";
import type { ToolContext } from "../src/tools/types.ts";

const separator = (ch: string, len = 80) => ch.repeat(len);

// ---------- 构造真实场景：5 轮 Agent 对话（含工具调用与结果） ----------
const messagesBefore: ChatMessage[] = [
  // system
  {
    role: "system",
    content: `你是一个文件操作 Agent，工作在一个受限工作区内。

可用工具：
- read-file：读取文件内容（带行号）
- write-file：创建或覆盖文件
- list-dir：列出目录内容

工作规则：
1. 改文件前必须先 read-file 确认当前内容
2. 不确定的路径先用 list-dir 探查
3. 工具失败时分析原因再重试，不要盲目重复
4. 任务完成后用一句话总结结果

工具结果会被裁剪以节省上下文，省略部分用 [...省略 N 行...] 标记。`,
  },

  // ====== 第 1 轮：用户任务 ======
  {
    role: "user",
    content: `帮我分析一下项目结构，找到主入口文件，然后：
1. 在主入口开头加上一行 '// ===== MiniHarness v1.0 =====' 的版本注释
2. 创建一个新文件 logs/debug.log 并写入 "[init] bootstrap complete"

所有改动都要先读再写，确认无误后再执行。`,
  },

  {
    role: "assistant",
    content: "好的，我先从列出项目根目录开始，确认目录结构。",
    tool_calls: [
      {
        id: "call_1_listdir",
        type: "function",
        function: { name: "list-dir", arguments: JSON.stringify({ path: "." }) },
      },
    ],
  },
  {
    role: "tool",
    tool_call_id: "call_1_listdir",
    content: `src/
src/agent/
src/tools/
src/provider/
src/config.ts
src/index.ts
test/
package.json
tsconfig.json
README.md
.env.example`,
  } as ChatMessage,

  // ====== 第 2 轮：继续 read-file 探查主入口 ======
  {
    role: "assistant",
    content: "找到主入口应该是 src/index.ts，先读一下当前内容确认。",
    tool_calls: [
      {
        id: "call_2_read_index",
        type: "function",
        function: { name: "read-file", arguments: JSON.stringify({ path: "src/index.ts" }) },
      },
    ],
  },
  {
    role: "tool",
    tool_call_id: "call_2_read_index",
    content: `1  import { registerFileTools } from "./tools/file-tools.ts";
2  import { runAgent } from "./agent/loop.ts";
3
4  const [, , cmd, ...rest] = process.argv;
5  if (cmd !== "ask" || !rest.length) {
6    process.exit(1);
7  }
8
9  const ctrl = new AbortController();
10 process.on("SIGINT", () => ctrl.abort());
11
12 registerFileTools();
13
14 const answer = await runAgent(rest.join(" "), { workspace: process.cwd() }, ctrl.signal);
15 console.log(answer);`,
  } as ChatMessage,

  // ====== 第 3 轮：读 src/config.ts 判断是否有版本信息 ======
  {
    role: "assistant",
    content: "主入口确认了。我再读一下 src/config.ts，看看是否已有版本配置项，避免重复定义。",
    tool_calls: [
      {
        id: "call_3_read_config",
        type: "function",
        function: { name: "read-file", arguments: JSON.stringify({ path: "src/config.ts" }) },
      },
    ],
  },
  {
    role: "tool",
    tool_call_id: "call_3_read_config",
    content: `1  import { z } from "zod";
2
3  export const configSchema = z.object({
4    OPENAI_API_KEY: z.string().min(1),
5    OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
6    OPENAI_MODEL: z.string().default("gpt-4o-mini"),
7  });
8
9  const env = { ...process.env };
10 if (typeof process.loadEnvFile === "function") {
11   try { process.loadEnvFile(); Object.assign(env, process.env); } catch {}
12 }
13
14 export const config = configSchema.parse({
15   OPENAI_API_KEY: env.OPENAI_API_KEY,
16   OPENAI_BASE_URL: env.OPENAI_BASE_URL,
17   OPENAI_MODEL: env.OPENAI_MODEL,
18 });
19
20 export type ChatMessage = {
21   role: "system" | "user" | "assistant" | "tool";
22   content: string;
23   tool_calls?: Array<{
24     id: string;
25     type: "function";
26     function: { name: string; arguments: string };
27   }>;
28 };`,
  } as ChatMessage,

  // ====== 第 4 轮：写入 index.ts 版本注释 ======
  {
    role: "assistant",
    content: "config.ts 没有版本字段，我直接在 src/index.ts 开头添加版本注释。",
    tool_calls: [
      {
        id: "call_4_write_index",
        type: "function",
        function: {
          name: "write-file",
          arguments: JSON.stringify({
            path: "src/index.ts",
            content: `// ===== MiniHarness v1.0 =====
import { registerFileTools } from "./tools/file-tools.ts";
import { runAgent } from "./agent/loop.ts";

const [, , cmd, ...rest] = process.argv;
if (cmd !== "ask" || !rest.length) {
  process.exit(1);
}

const ctrl = new AbortController();
process.on("SIGINT", () => ctrl.abort());

registerFileTools();

const answer = await runAgent(rest.join(" "), { workspace: process.cwd() }, ctrl.signal);
console.log(answer);`,
          }),
        },
      },
    ],
  },
  { role: "tool", tool_call_id: "call_4_write_index", content: "已写入: src/index.ts (291 bytes)" } as ChatMessage,

  // ====== 第 5 轮：创建 logs/debug.log ======
  {
    role: "assistant",
    content: "接下来创建 logs/debug.log 初始化日志。",
    tool_calls: [
      {
        id: "call_5_write_log",
        type: "function",
        function: {
          name: "write-file",
          arguments: JSON.stringify({
            path: "logs/debug.log",
            content: "[init] bootstrap complete\n",
          }),
        },
      },
    ],
  },
  { role: "tool", tool_call_id: "call_5_write_log", content: "已写入: logs/debug.log (30 bytes)" } as ChatMessage,

  // ====== 第 6 轮：Agent 总结（模型回答） ======
  {
    role: "assistant",
    content:
      "所有改动完成：\n" +
      "1. 在 src/index.ts 开头添加了 '// ===== MiniHarness v1.0 =====' 版本注释\n" +
      "2. 创建了 logs/debug.log，内容为 '[init] bootstrap complete'\n" +
      "所有写操作前都已先 read-file 确认内容，路径无误。",
  },

  // ====== 第 7 轮：用户追问（给模型的最新问题） ======
  {
    role: "user",
    content: "好的，现在把 src/index.ts 再读回来，确认版本注释是否真的写入了文件第 1 行，给出答案，是或者否。",
  },
];

// ---------- 压缩预算设置 ----------
const beforeTokens = estimateMessagesTokens(messagesBefore);
const budgetMaxTokens = Math.floor(beforeTokens * 0.55);
const cfg = { maxTokens: budgetMaxTokens, reservedTokens: Math.floor(budgetMaxTokens * 0.1) };
const ctrl = new AbortController();
process.on("SIGINT", () => ctrl.abort());

// 注册文件工具，供 chatWithTools 真实执行
registerFileTools();
const tools = toOpenAITools();
const toolCtx: ToolContext = { workspace: process.cwd() };

// ---------- 输出：压缩前 ----------
console.log(separator("="));
console.log("📋 场景：真实 Agent 多轮对话上下文压缩 · 真实模型测评");
console.log(separator("="));

console.log(`\n${separator("-")}`);
console.log(`[1/4] 压缩前 · 完整消息历史（共 ${messagesBefore.length} 条 / ${beforeTokens} tokens）`);
console.log(`${separator("-")}\n`);
messagesBefore.forEach((m, idx) => {
  const tag = m.tool_calls ? ` 🔧tool_calls=${m.tool_calls.length}` : "";
  const preview =
    m.content.length > 180
      ? m.content.slice(0, 180) + ` ……（共 ${estimateTokens(m.content)} tokens）`
      : m.content;
  console.log(`#${idx + 1}  [${m.role}]${tag}`);
  console.log(preview.replace(/^/gm, "      "));
  console.log();
});

// ---------- 执行压缩（真实调用 LLM 做 summarize） ----------
process.stdout.write("⏳ 正在调用真实模型生成历史摘要…… ");
const { messages: messagesAfter, compressed } = await truncate(
  messagesBefore,
  cfg,
  (old) => summarizeMessages(old, ctrl.signal),
);
process.stdout.write("✅ 完成\n");

const afterTokens = estimateMessagesTokens(messagesAfter);

// 修复"孤立 tool 消息"：把压缩后不紧跟对应 assistant.tool_calls 的 tool 消息和其前导无 tool_calls 的
// assistant 清理掉，避免 OpenAI API 校验失败。
function sanitizeForOpenAI(msgs: ChatMessage[]): ChatMessage[] {
  type T = ChatMessage & { tool_call_id?: string };
  const arr = msgs as T[];
  const result: T[] = [];
  // 找出原数组中所有带 tool_calls 的 assistant 声明过的 id
  for (let i = 0; i < arr.length; i++) {
    const m = arr[i];
    if (m.role === "tool") {
      // 往前找最近一条 assistant，看它的 tool_calls 里是否有 m.tool_call_id
      let matched = false;
      for (let j = result.length - 1; j >= 0; j--) {
        const prev = result[j];
        if (prev.role === "assistant") {
          if (prev.tool_calls?.some((tc) => tc.id === (m as T).tool_call_id)) {
            matched = true;
          }
          break; // 只看紧跟最近一条 assistant
        }
      }
      if (!matched) {
        // 孤立 tool。同时如果它前一条是无 tool_calls 的 assistant（说明这条 assistant 说
        // "我要调用 xxx"但 tool_calls 结构被裁掉了），也一并删掉以避免上下文断裂。
        if (
          result.length &&
          result[result.length - 1].role === "assistant" &&
          !result[result.length - 1].tool_calls
        ) {
          // 但要避免删掉已经是纯总结/回答的 assistant（最后那条改动总结不能删）
          // 只有当这个 assistant 的内容长度 < 200（偏简短的调用说明/过渡）才清
          const candidate = result[result.length - 1];
          if (candidate.content.length < 200) result.pop();
        }
        continue; // 跳过孤立 tool
      }
      result.push(m);
    } else {
      result.push(m);
    }
  }
  return result as ChatMessage[];
}

const messagesForModel = sanitizeForOpenAI(messagesAfter);
const modelTokens = estimateMessagesTokens(messagesForModel);

// ---------- 输出：压缩后 ----------
console.log(`\n${separator("-")}`);
console.log(
  `[2/4] 压缩后 · 实际发送给模型的消息（共 ${messagesForModel.length} 条 / ${modelTokens} tokens）` +
    `  压缩率: ${(((beforeTokens - modelTokens) / beforeTokens) * 100).toFixed(1)}%` +
    `  触发压缩: ${compressed}`,
);
console.log(`预算: maxTokens=${cfg.maxTokens}, reservedTokens=${cfg.reservedTokens}`);
if (messagesForModel.length !== messagesAfter.length) {
  console.log(`注意: ${messagesAfter.length - messagesForModel.length} 条孤立 tool/assistant 消息已在发往 API 前清理`);
}
console.log(`${separator("-")}\n`);
messagesForModel.forEach((m, idx) => {
  const isSummary = m.role === "system" && m.content.startsWith("[历史摘要]");
  const tag = isSummary ? " ⭐(真实模型生成的历史摘要)" : "";
  const preview =
    m.content.length > 260
      ? m.content.slice(0, 260) + ` ……（共 ${estimateTokens(m.content)} tokens）`
      : m.content;
  console.log(`#${idx + 1}  [${m.role}]${tag}`);
  console.log(preview.replace(/^/gm, "      "));
  console.log();
});

// ---------- 输出：给模型的问题（最后一条 user 消息） ----------
const lastUserMsg = [...messagesForModel].reverse().find((m) => m.role === "user");
console.log(`\n${separator("-")}`);
console.log(`[3/4] 给模型的问题（压缩后消息中最新的 user 提问）`);
console.log(`${separator("-")}\n`);
if (lastUserMsg) {
  console.log(lastUserMsg.content);
} else {
  console.log("（未找到 user 消息）");
}

// ---------- 输出：真实模型的回答 ----------
console.log(`\n${separator("-")}`);
console.log(`[4/4] 模型的回答（真实调用 chatWithTools，可发起标准 tool_calls）`);
console.log(`${separator("-")}\n`);

process.stdout.write("⏳ 正在调用真实模型生成回答……\n\n");
const firstRound = await chatWithTools(messagesForModel, tools, ctrl.signal);

if (firstRound.content) {
  console.log("💬 模型文本：");
  console.log(firstRound.content.replace(/^/gm, "      "));
  console.log();
}

if (firstRound.toolCalls.length === 0) {
  if (!firstRound.content) console.log("（模型未输出文本，也未发起工具调用）");
} else {
  console.log(`🔧 模型发起 ${firstRound.toolCalls.length} 次工具调用：`);
  for (const tc of firstRound.toolCalls) {
    console.log(`  • ${tc.name}(${tc.arguments})`);
  }
  console.log();

  // 执行工具调用，收集结果
  console.log("📤 工具执行结果：");
  const toolResults: { callId: string; output: string }[] = [];
  for (const tc of firstRound.toolCalls) {
    const tool = getTool(tc.name);
    if (!tool) {
      console.log(`  ✗ 未注册工具: ${tc.name}\n`);
      continue;
    }
    let args: unknown;
    try {
      args = JSON.parse(tc.arguments);
    } catch {
      console.log(`  ✗ 参数解析失败: ${tc.arguments}\n`);
      continue;
    }
    const result = await tool.execute(args as never, toolCtx);
    const text = result.ok ? result.output : `ERROR: ${result.error}`;
    toolResults.push({ callId: tc.id, output: text });
    console.log(`  ▸ ${tc.name} →`);
    console.log(text.replace(/^/gm, "      "));
    console.log();
  }

  // 第二轮：把 assistant(含 tool_calls) + tool 结果 append 回 messages，让模型基于结果判断
  console.log(separator("-"));
  console.log("🔁 第二轮：把工具结果送回模型，让它给出最终判断（是 / 否）");
  console.log(`${separator("-")}\n`);

  const secondRoundMessages: ChatMessage[] = [
    ...messagesForModel,
    {
      role: "assistant",
      content: firstRound.content ?? "",
      tool_calls: firstRound.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    },
    ...toolResults.map((r) => ({
      role: "tool" as const,
      tool_call_id: r.callId,
      content: r.output,
    })),
  ];

  process.stdout.write("⏳ 正在调用真实模型生成最终判断……\n\n");
  const secondRound = await chatWithTools(secondRoundMessages, tools, ctrl.signal);
  if (secondRound.content) {
    console.log("✅ 模型最终判断：");
    console.log(secondRound.content.replace(/^/gm, "      "));
  }
  if (secondRound.toolCalls.length > 0) {
    console.log(`\n（模型还想继续调用工具，但本测试到此为止：）`);
    for (const tc of secondRound.toolCalls) {
      console.log(`  • ${tc.name}(${tc.arguments})`);
    }
  }
}