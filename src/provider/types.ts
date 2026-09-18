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

export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call_delta"; index: number; id?: string; name?: string; argumentsDelta: string }
  | { type: "usage"; usage: Usage };

export interface Provider {
  readonly model: string;
  chat(
    messages: ChatMessage[],
    tools: ChatTool[],
    signal?: AbortSignal
  ): Promise<ChatResult>;

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
