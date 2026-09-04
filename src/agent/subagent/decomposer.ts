import type { Provider, ChatMessage } from "../../provider/index.ts";
import type { DecompositionResult, SubTask } from "./types.ts";

const SYSTEM_PROMPT = `你是一个任务分解专家。把用户的复杂任务拆成可并行执行的子任务。

规则：
1. 每个子任务是独立、可验证的小目标
2. 尽量减少依赖，能并行就并行
3. 有依赖时在 dependencies 字段列前置任务 id
4. 子任务数量 2-8 个
5. 只返回 JSON，格式：{"plan": "简要计划说明", "tasks": [{"id":"t1","title":"...","description":"...","dependencies":[]}]}
6. id 用 t1、t2 这样的简短标识`;

export async function decomposeTask(
    task: string,
    provider: Provider,
): Promise<DecompositionResult> {
    const messages: ChatMessage[] = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: task },
    ];

    const { content } = await provider.chat(messages, []);
    const jsonStr = content.replace(/```json\n?/g, "").replace(/```/g, "").trim();

    const parsed = JSON.parse(jsonStr);
    return {
    plan: parsed.plan ?? "",
    tasks: (parsed.tasks ?? []).map((t: Partial<SubTask>) => ({
        id: t.id ?? "",
        title: t.title ?? "",
        description: t.description ?? "",
        dependencies: t.dependencies ?? [],
        tools: t.tools,
        })),
    };
}