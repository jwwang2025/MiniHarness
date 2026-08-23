import type { ChatMessage } from "../config.ts";
import { chatWithTools, appendToolMessages } from "../provider/openai.ts";
import { getTool, toOpenAITools } from "../tools/registry.ts";
import type { ToolContext } from "../tools/types.ts";
/* feat/context-management
*----------------------------------------------------------------
*/
import { truncate, DEFAULT_CTX, clipToolOutput } from "./context.ts";
import { summarizeMessages } from "./summarizer.ts";
import { SYSTEM_PROMPT } from "./system-prompt.ts";
import { estimateMessagesTokens } from "./tokens.ts";

const MAX_ROUNDS = 10;

export type LoopEvent =
  | { type: "thinking"; round: number }
  | { type: "tool_call"; name: string; args: unknown }
  | { type: "tool_result"; name: string; output: string; ok: boolean }
  | { type: "context_compressed"; beforeTokens: number; afterTokens: number }
  | { type: "answer"; content: string };

export interface LoopOptions {
  onEvent?: (e: LoopEvent) => void;
}

export async function runAgent(
  task: string,
  ctx: ToolContext,
  signal?: AbortSignal,
  opts: LoopOptions = {},
): Promise<string> {
  const sysMsg: ChatMessage = { role: "system", content: SYSTEM_PROMPT };
  let messages: ChatMessage[] = [sysMsg, { role: "user", content: task }];
  const tools = toOpenAITools();

  for (let round = 0; round < MAX_ROUNDS; round++) {
    opts.onEvent?.({ type: "thinking", round });

    // 上下文压缩：summarize 闭包携带 signal
    const beforeTokens = estimateMessagesTokens(messages);
    const { messages: truncated, compressed } = await truncate(
      messages,
      (old) => summarizeMessages(old, signal),
      DEFAULT_CTX,
    );
    if (compressed) {
      messages = truncated;
      opts.onEvent?.({
        type: "context_compressed",
        beforeTokens,
        afterTokens: estimateMessagesTokens(messages),
      });
    }

    const { content, toolCalls } = await chatWithTools(messages, tools, signal);

    // 没有工具调用 → 直接返回文本
    if (!toolCalls.length) return content;

    // 执行所有工具调用
    const toolResults = [];
    for (const tc of toolCalls) {
      const tool = getTool(tc.name);
      if (!tool) {
        toolResults.push({ callId: tc.id, output: `未知工具: ${tc.name}` });
        continue;
      }
      const args = JSON.parse(tc.arguments || "{}");
      const result = await tool.execute(args, ctx);
      toolResults.push({ callId: tc.id, output: result.ok ? result.output : `[错误] ${result.error}` });
    }

    // 把 assistant 消息 + tool 结果追加回历史
    // 注意：内部 ToolCall 是扁平结构，发回 API 需转成标准 OpenAI 格式
    const assistantMsg: ChatMessage = {
      role: "assistant",
      content,
      ...(toolCalls.length ? {
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      } : {}),
    };
    
    messages = appendToolMessages([...messages, assistantMsg], toolResults);
  }

  throw new Error("达到最大轮数限制");
}