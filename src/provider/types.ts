// ============================================================
// Provider 层类型 + 辅助函数
// 所有模型相关类型集中在此，Agent Loop 只依赖此文件
// ============================================================

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "tool"; tool_call_id: string; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCallRef[] };

export interface ToolCallRef {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatTool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatResult {
  content: string;
  toolCalls: ToolCall[];
  usage?: Usage;
}

// 流式事件协议：文本增量 / 工具调用分片 / token 用量
export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call_delta"; index: number; id?: string; name?: string; argumentsDelta: string }
  | { type: "usage"; usage: Usage };

export interface Provider {
  readonly model: string;
  // 非流式：保留备用（批处理、评测、不支持流式的厂商兜底）
  chat(
    messages: ChatMessage[],
    tools: ChatTool[],
    signal?: AbortSignal
  ): Promise<ChatResult>;
  
  // 流式：产出结构化事件，tool_calls 分片由消费方按 index 聚合
  streamChat(
    messages: ChatMessage[],
    tools: ChatTool[],
    signal?: AbortSignal
  ): Promise<AsyncIterable<StreamEvent>>;
}

export function appendToolMessages(
  messages: ChatMessage[],
  toolResults: { callId: string; output: string }[],
): ChatMessage[] {
  return [
    ...messages,
    ...toolResults.map<ChatMessage>(r => ({ role: "tool", tool_call_id: r.callId, content: r.output })),
  ];
}
