// ============================================================
// Provider 层类型 + 辅助函数
// 所有模型相关类型集中在此，Agent Loop 只依赖此文件
// ============================================================

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "tool"; tool_call_id: string; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCallRef[] };

// ─── 新增（原 config.ts 内联在 ChatMessage assistant 变体里）───
// 抽出为独立接口，便于复用
export interface ToolCallRef {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

// ─── 迁移自 src/tools/types.ts（原第 1-5 行）───
// 工具调用结果（扁平结构，给 Agent Loop 用）
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

// ─── 新增（原 src/provider/openai.ts 内联在 chatWithTools 参数里）───
// OpenAI function 格式的工具定义
export interface ChatTool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

// ─── 新增（为 Phase 8.3 可观测性准备）───
export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// ─── 新增（统一 chat 返回值）───
export interface ChatResult {
  content: string;
  toolCalls: ToolCall[];
  usage?: Usage;
}

// ─── 新增（Provider 接口，Agent Loop 只依赖此接口）───
export interface Provider {
  readonly model: string;
  chat(messages: ChatMessage[], tools: ChatTool[], signal?: AbortSignal): Promise<ChatResult>;
  streamChat(messages: ChatMessage[], signal?: AbortSignal): Promise<AsyncIterable<string>>;
}

// ─── 迁移自 src/provider/openai.ts（原第 111-119 行 appendToolMessages）───
// 改进：返回 ChatMessage[]（原版返回 ChatMessage | ToolResponseMessage，现合并进 ChatMessage）
// 原 ToolResponseMessage 接口（openai.ts 第 65-69 行）已并入 ChatMessage 的 tool 变体
export function appendToolMessages(
  messages: ChatMessage[],
  toolResults: { callId: string; output: string }[],
): ChatMessage[] {
  return [
    ...messages,
    ...toolResults.map<ChatMessage>(r => ({ role: "tool", tool_call_id: r.callId, content: r.output })),
  ];
}
