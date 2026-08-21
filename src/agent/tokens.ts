import { encode } from "gpt-tokenizer";

export function estimateTokens(text: string): number {
  return encode(text).length;
}

export function estimateMessagesTokens(messages: Array<{ content: string }>): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content) + 3, 0) + 3;
}