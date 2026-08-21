import type { ChatMessage } from "../config.ts";
import { chatWithTools, appendToolMessages } from "../provider/openai.ts";
import { getTool, toOpenAITools } from "../tools/registry.ts";
import type { ToolContext } from "../tools/types.ts";

const MAX_ROUNDS = 10;

export async function runAgent(
  task: string,
  ctx: ToolContext,
  signal?: AbortSignal,
): Promise<string> {
  let messages: ChatMessage[] = [{ role: "user", content: task }];
  const tools = toOpenAITools();

  for (let round = 0; round < MAX_ROUNDS; round++) {
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
      try {
        const args = JSON.parse(tc.arguments || "{}");
        const result = await tool.execute(args, ctx);
        toolResults.push({ callId: tc.id, output: result.ok ? result.output : `[错误] ${result.error}` });
      } catch (e) {
        toolResults.push({ callId: tc.id, output: `[执行异常] ${String(e)}` });
      }
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