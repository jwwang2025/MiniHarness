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
/* feat/safety-permission
*----------------------------------------------------------------
*/
import { checkPolicy } from "../safety/policy.ts";
import { approve } from "../safety/approver.ts";
import type { ToolInvocation } from "../safety/types.ts";
import type { SafetyOptions } from "../safety/types.ts";

const MAX_ROUNDS = 10;

export type LoopEvent =
  | { type: "thinking"; round: number }
  | { type: "tool_call"; name: string; args: unknown }
  | { type: "safety"; kind: "allow" | "ask" | "deny"; tool: string; reason?: string; detail?: string }
  | { type: "tool_result"; name: string; output: string; ok: boolean }
  | { type: "context_compressed"; beforeTokens: number; afterTokens: number }
  | { type: "answer"; content: string };

export interface LoopOptions {
  onEvent?: (e: LoopEvent) => void;
  safetyOptions?: SafetyOptions;
}

function buildSafetyOptions(opts: LoopOptions): SafetyOptions {
  const upstreamLogger = opts.safetyOptions?.logger;
  return {
    logger: (e) => {
      upstreamLogger?.(e);
      opts.onEvent?.({ type: "safety", ...e });
    },
  };
}

export async function runAgent(
  task: string,
  ctx: ToolContext,
  signal?: AbortSignal,
  opts: LoopOptions = {},
): Promise<string> {
  const safetyOptions = buildSafetyOptions(opts);

  const sysMsg: ChatMessage = { role: "system", content: SYSTEM_PROMPT };
  let messages: ChatMessage[] = [sysMsg, { role: "user", content: task }];
  const tools = toOpenAITools();

  for (let round = 0; round < MAX_ROUNDS; round++) {
    opts.onEvent?.({ type: "thinking", round });

    // 上下文压缩：summarize 闭包携带 signal
    const beforeTokens = estimateMessagesTokens(messages);
    const { messages: truncated, compressed } = await truncate(
      messages,
      DEFAULT_CTX,
      (old) => summarizeMessages(old, signal),
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

      // --- 安全检查 + 审批 ---
      const args = JSON.parse(tc.arguments || "{}");
      const inv: ToolInvocation = { toolName: tc.name, args, workspace: ctx.workspace };
      const policyPerm = checkPolicy(inv, safetyOptions);
      const { permission } = await approve(inv, policyPerm, safetyOptions);

      if(permission === "deny") {
        const out = policyPerm === "deny"?"[操作被拒] 安全策略拦截":"[操作被拒] 用户拒绝";
        toolResults.push({ callId: tc.id, output: out });
        opts.onEvent?.({ type: "tool_result", name: tc.name, output: out, ok: false });
        continue;
      }
      
      const result = await tool.execute(args, ctx);
      const output = result.ok ? clipToolOutput(result.output) : `[错误] ${result.error}`;
      toolResults.push({ callId: tc.id, output });
      opts.onEvent?.({ type: "tool_result", name: tc.name, output, ok: result.ok });
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