import type { ChatMessage, ChatResult, ChatTool, Provider, StreamEvent } from "./types.ts";

export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export class OpenAIProvider implements Provider {
  readonly model: string;

  constructor(private config: ProviderConfig) {
    this.model = config.model;
  }

  async chat(
    messages: ChatMessage[], 
    tools: ChatTool[], 
    signal?: AbortSignal
  ): Promise<ChatResult> {
    const res = await this.post({ messages, tools }, signal);
    const data = await res.json();
    const msg = data.choices[0].message;
    return {
      content: msg.content ?? "",
      toolCalls: (msg.tool_calls ?? []).map((tc: { id: string; function: { name: string; arguments: string } }) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      })),
      usage: data.usage && {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
    };
  }
  
  async streamChat(
    messages: ChatMessage[],
    tools: ChatTool[],
    signal?: AbortSignal,
  ): Promise<AsyncIterable<StreamEvent>> {
    const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        ...(tools.length ? { tools } : {}),   // 空工具列表不下发，避免部分 API 报错
        stream: true,
        stream_options: { include_usage: true }, // 最后一个 chunk 携带 usage
      }),
      signal: signal ?? null,
    });
    if (!res.ok || !res.body) {
      throw new Error(`API error: ${res.status} ${await res.text()}`);
    }
    return this.parseSSE(res.body);
  }

  private async post(body: object, signal?: AbortSignal): Promise<Response> {
    const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.config.apiKey}` },
      body: JSON.stringify({ model: this.model, ...body }),
      signal: signal ?? null,
    });
    if (!res.ok) throw new Error(`API error: ${res.status} ${await res.text()}`);
    return res;
  }

/**
 * 解析 OpenAI 兼容 SSE 流式二进制响应
 * @param body fetch返回的可读二进制流 ReadableStream<Uint8Array>
 * @returns AsyncIterable<StreamEvent> 异步迭代器，逐段产出文本增量 / 工具调用分片 / 用量
 */
  private async *parseSSE(body: ReadableStream<Uint8Array>): AsyncIterable<StreamEvent> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const data = line.trim();
        if (!data.startsWith("data:")) continue;
        const json = data.slice(5).trim();
        if (json === "[DONE]") return;
        const parsed = JSON.parse(json);
        const delta = parsed.choices?.[0]?.delta;
        if (delta?.content) yield { type: "text", delta: delta.content };
        for (const tc of delta?.tool_calls ?? []) {
          yield {
            type: "tool_call_delta",
            index: tc.index,
            id: tc.id,
            name: tc.function?.name,
            argumentsDelta: tc.function?.arguments ?? "",
          };
        }
        if (parsed.usage) {
          yield {
            type: "usage",
            usage: {
              promptTokens: parsed.usage.prompt_tokens,
              completionTokens: parsed.usage.completion_tokens,
              totalTokens: parsed.usage.total_tokens,
            },
          };
        }
      }
    }
  }
}

// /* feat/tool-system
// *----------------------------------------------------------------
// */
// // ToolResponseMessage 已迁移到 src/provider/types.ts 的 ChatMessage tool 变体

// /**
//  * 调用模型，支持工具调用
//  * @param messages 输入消息序列，包含用户消息和工具调用消息
//  * @param tools 工具调用序列，包含工具名称、描述和参数
//  * @param signal 取消信号，用于中断请求
//  * @returns 包含模型输出文本和工具调用结果的对象
//  */
// export async function chatWithTools(
//     messages: ChatMessage[],
//     tools: ChatTool[],
//     signal?: AbortSignal,
// ): Promise<{ 
//     content: string; 
//     toolCalls: ToolCall[];
// }> {
//     const res = await fetch(`${baseUrl}/chat/completions`, {
//     method: "POST",
//     headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
//     body: JSON.stringify({ model, messages, tools }),
//     signal: signal ?? null,
//   });
//   if (!res.ok || !res.body) {
//     throw new Error(`API error: ${res.status} ${await res.text()}`);
//   }
//   const data = await res.json();
//   const choice = data.choices[0];
//   const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((tc: { id: string; function: { name: string; arguments: string } }) => ({
//     id: tc.id,
//     name: tc.function.name,
//     arguments: tc.function.arguments,
//   }));
//   return { content: choice.message.content ?? "", toolCalls };
// }
