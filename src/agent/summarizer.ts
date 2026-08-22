import type { ChatMessage } from "../config.ts";
import { streamChat } from "../provider/openai.ts";

export async function summarizeMessages(
    oldMessages: ChatMessage[],
    signal?: AbortSignal,
):Promise<string> {
    const transcript = oldMessages
    .map(m => `${m.role}: ${m.content}`)
    .join("\n");

    const stream = await streamChat(
        [{
        role: "user",
        content: `把以下 Agent 对话历史压缩成 200 字以内摘要，重点保留：已做的决策、读写的文件路径、关键结论。不要复述过程。\n\n${transcript}`,
        }],
        signal,
    );

    let summary = "";
    for await (const chunk of stream) summary += chunk;
    return summary;
}