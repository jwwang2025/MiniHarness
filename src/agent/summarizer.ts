import type { ChatMessage, Provider } from "../provider/index.ts";

export async function summarizeMessages(
    provider: Provider,
    oldMessages: ChatMessage[],
    signal?: AbortSignal,
):Promise<string> {
    const transcript = oldMessages
    .map(m => `${m.role}: ${m.content}`)
    .join("\n");

    const stream = await provider.streamChat(
        [{
        role: "user",
        content: `把以下 Agent 对话历史压缩成 200 字以内摘要，重点保留：已做的决策、读写的文件路径、关键结论。不要复述过程。\n\n${transcript}`,
        }],
        [], // 摘要无需工具
        signal,
    );

    let summary = "";
    for await (const ev of stream) {
        if (ev.type === "text") summary += ev.delta;
    }
    return summary;
}
