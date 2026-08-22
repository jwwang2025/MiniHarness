import type { ChatMessage } from "../config.ts";
import { estimateMessagesTokens, estimateTokens } from "./tokens.ts";

export interface ContextConfig {
  maxTokens: number;
  reservedTokens: number;
}

export const DEFAULT_CTX: ContextConfig = {
  maxTokens: 32_000,
  reservedTokens: 4_000,
};

export function clipToolOutput(text: string, maxLines = 200): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  const head = lines.slice(0, maxLines / 2);
  const tail = lines.slice(-maxLines / 2);
  return `${head.join("\n")}\n[...省略 ${lines.length - maxLines} 行...]\n${tail.join("\n")}`;
}

export async function truncate(
    messages: ChatMessage[],
    cfg: ContextConfig = DEFAULT_CTX,
    summarize?:(oldMessages: ChatMessage[])=>Promise<string>
):Promise<{ messages: ChatMessage[], compressed: boolean }> {
    const budget = cfg.maxTokens - cfg.reservedTokens;
    const used = estimateMessagesTokens(messages);
    if (used <= budget) 
        return { messages, compressed: false };

    const sys = messages[0]?.role === "system" ? [messages[0]] : [];
    const rest = sys.length ? messages.slice(1) : messages;

    const kept: ChatMessage[] = [];
    let keptTokens = estimateMessagesTokens(sys);
    for (let i = rest.length - 1; i >= 0; i--) {
        const t = estimateTokens(rest[i].content) + 4;
        if (keptTokens + t > budget * 0.7) break; 
        kept.unshift(rest[i]);
        keptTokens += t;
    }

    const oldMessages = rest.slice(0, rest.length - kept.length);
    
}
