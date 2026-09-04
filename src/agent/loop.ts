import type { ChatMessage, Provider } from "../provider/index.ts";
import { appendToolMessages } from "../provider/index.ts";
import { getTool, toOpenAITools, type ToolContext } from "../tools/index.ts";
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
import { checkPolicy, approve, type ToolInvocation, type SafetyOptions } from "../safety/index.ts";
/* feat/session-persistence
*----------------------------------------------------------------
*/
import { saveSession, type Session } from "../session/index.ts";
import { TelemetryCollector, type RunMetrics } from "../telemetry/index.ts";

const MAX_ROUNDS = 10;

export type LoopEvent =
  | { type: "thinking"; round: number }
  | { type: "tool_call"; name: string; args: unknown }
  | { type: "safety"; kind: "allow" | "ask" | "deny"; tool: string; reason?: string; detail?: string }
  | { type: "tool_result"; name: string; output: string; ok: boolean }
  | { type: "context_compressed"; beforeTokens: number; afterTokens: number }
  | { type: "text_delta"; delta: string }
  | { type: "answer"; content: string };

export interface LoopOptions {
  onEvent?: (e: LoopEvent) => void;
  safetyOptions?: SafetyOptions;
  session?: Session;
  collector?: TelemetryCollector;
  maxRounds?: number;
}

export interface AgentResult {
  answer: string;
  messages: ChatMessage[];
  metrics?: RunMetrics;
}

function buildSafetyOptions(opts: LoopOptions): SafetyOptions {
  const upstreamLogger = opts.safetyOptions?.logger;
  const result: SafetyOptions = {
    logger: (e) => {
      upstreamLogger?.(e);
      opts.onEvent?.({ type: "safety", ...e });
    },
  };
  if (opts.safetyOptions?.promptFn) {
    result.promptFn = opts.safetyOptions.promptFn;
  }
  if (opts.safetyOptions?.autoApprove) {
    result.autoApprove = true;
  }
  return result;
}

export async function runAgent(
  task: string,
  provider: Provider,
  ctx: ToolContext,
  signal?: AbortSignal,
  opts: LoopOptions = {},
): Promise<AgentResult> {
  const safetyOptions = buildSafetyOptions(opts);
  const collector = opts.collector ?? new TelemetryCollector(
    task || "(resume)",
    provider.model,
    opts.session?.id,
  );

  const isResume = opts.session != null && task === "";

  const sysMsg: ChatMessage = { role: "system", content: SYSTEM_PROMPT };
  let messages: ChatMessage[];
  if (isResume) {
    // 断点续跑：从 session 恢复消息，确保 system 消息存在
    const prev = opts.session!.messages ?? [];
    messages = prev[0]?.role === "system" ? [...prev] : [sysMsg, ...prev];
  } else if (opts.session) {
    // 多轮对话：追加新 user 消息到 session，确保 system 消息存在
    const prev = opts.session.messages;
    messages = prev[0]?.role === "system"
      ? [...prev, { role: "user", content: task }]
      : [sysMsg, ...prev, { role: "user", content: task }];
    opts.session.messages = messages;
  } else {
    messages = [sysMsg, { role: "user", content: task }];
  }

  const tools = toOpenAITools();

  for (let round = 0; round < MAX_ROUNDS; round++) {
    collector.startTurn(round);
    opts.onEvent?.({ type: "thinking", round });

    // 上下文压缩：summarize 闭包携带 signal
    const beforeTokens = estimateMessagesTokens(messages);
    const { messages: truncated, compressed } = await truncate(
      messages,
      DEFAULT_CTX,
      (old) => summarizeMessages(provider, old, signal),
    );
    if (compressed) {
      messages = truncated;
      opts.onEvent?.({
        type: "context_compressed",
        beforeTokens,
        afterTokens: estimateMessagesTokens(messages),
      });
    }

    // 流式调用：文本增量实时推送，tool_calls 分片按 index 聚合
    collector.startModelCall();
    let content = "";
    const tcMap = new Map<number, { id: string; name: string; arguments: string }>();
    let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
    const stream = await provider.streamChat(messages, tools, signal);
    for await (const ev of stream) {
      if (ev.type === "text") {
        content += ev.delta;
        opts.onEvent?.({ type: "text_delta", delta: ev.delta });
      } else if (ev.type === "tool_call_delta") {
        const agg = tcMap.get(ev.index) ?? { id: "", name: "", arguments: "" };
        if (ev.id) agg.id = ev.id;
        if (ev.name) agg.name = ev.name;
        agg.arguments += ev.argumentsDelta;
        tcMap.set(ev.index, agg);
      } else if (ev.type === "usage") {
        usage = {
          promptTokens: ev.usage.promptTokens,
          completionTokens: ev.usage.completionTokens,
          totalTokens: ev.usage.totalTokens,
        };
      }
    }
    collector.endModelCall(usage);
    const toolCalls = [...tcMap.values()];

    // 没有工具调用 → 返回文本，并把 assistant 回答追加进历史，供后续多轮对话使用
    if (!toolCalls.length) {
      const finalMessages: ChatMessage[] = [...messages, { role: "assistant", content }];
      if(opts.session) {
        opts.session.messages = finalMessages;
        opts.session.state = "done";
        await saveSession(opts.session);
      }
      collector.endTurn();
      const metrics = collector.finish(true);
      return { answer: content, messages: finalMessages, metrics };
    }

    // 执行所有工具调用
    const toolResults = [];
    for (const tc of toolCalls) {
      const tool = getTool(tc.name);
      if (!tool) {
        collector.startToolCall(tc.name);
        const out = `未知工具: ${tc.name}`;
        toolResults.push({ callId: tc.id, output: out });
        collector.endToolCall(false, "deny");
        opts.onEvent?.({ type: "tool_result", name: tc.name, output: out, ok: false });
        continue;
      }

      // --- 安全检查 + 审批 ---
      const args = JSON.parse(tc.arguments || "{}");
      const inv: ToolInvocation = { toolName: tc.name, args, workspace: ctx.workspace };
      const policyPerm = checkPolicy(inv, safetyOptions);
      const { permission } = await approve(inv, policyPerm, safetyOptions);

      if (permission === "deny") {
        collector.startToolCall(tc.name);
        const out = policyPerm === "deny" ? "[操作被拒] 安全策略拦截" : "[操作被拒] 用户拒绝";
        toolResults.push({ callId: tc.id, output: out });
        collector.endToolCall(false, "deny");
        opts.onEvent?.({ type: "tool_result", name: tc.name, output: out, ok: false });
        continue;
      }

      // 审批通过后才开始计时——durationMs 只含 tool.execute 本身，不含审批等待
      collector.startToolCall(tc.name);
      const result = await tool.execute(args, ctx);
      collector.endToolCall(result.ok, permission);
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

    if(opts.session) {
      opts.session.messages = messages;
      opts.session.state = "running";
      await saveSession(opts.session);
    }

    collector.endTurn();
  }

  collector.finish(false, "达到最大轮数限制");
  throw new Error("达到最大轮数限制");
}