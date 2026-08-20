import { apiKey, baseUrl, model, type ChatMessage } from "../config.ts";
import type { ToolCall } from "../types.ts";

/* feat/minimal-streaming-agent
----------------------------------------------------------------
*/
/*
* 流式输出模型输出文本delta，支持工具调用
* @param messages 输入消息序列，包含用户消息和工具调用消息
* @param signal 取消信号，用于中断请求
* @returns AsyncIterable<string> 异步迭代器，逐段产出模型输出文本delta
*/
export async function streamChat(
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<AsyncIterable<string>> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`API error: ${res.status} ${await res.text()}`);
  }

  return parseSSE(res.body);
}


/**
 * 解析 OpenAI 兼容 SSE 流式二进制响应
 * @param body fetch返回的可读二进制流 ReadableStream<Uint8Array>
 * @returns AsyncIterable<string> 异步迭代器，逐段产出模型输出文本delta
 */
async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
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
      const delta = JSON.parse(json).choices?.[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}

/* feat/tool-system
*----------------------------------------------------------------
*/
interface ToolResponseMessage {
  role: "tool";
  tool_call_id: string;
  content: string;
}



