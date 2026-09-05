import type { Provider, ChatMessage } from "../../provider/index.ts";
import { runAgent } from "../loop.ts";
import type { ToolContext } from "../../tools/index.ts";
import type { SubTask, SubTaskResult, SubAgentOptions, DecompositionResult } from "./types.ts";
import { decomposeTask } from "./decomposer.ts";

const MAX_PARALLEL = 3;
const MAX_ROUNDS = 100;

const SUMMARIZE_PROMPT = `你是一个结果汇总专家。根据多个子任务的执行结果，给出最终回答。

规则：
1. 整合所有子任务的关键信息
2. 失败的子任务要明确指出失败原因
3. 回答结构清晰，语言自然
4. 不要提及"子任务"等内部概念，直接给出最终答案`;

// —— 拓扑排序：按依赖分层 ——
export function topoSort(tasks: SubTask[]): SubTask[][] {
  const map = new Map(tasks.map(t => [t.id, t]));
  const remaining = new Set(tasks.map(t => t.id));
  const layers: SubTask[][] = [];

  while (remaining.size) {
    const layer: SubTask[] = [];
    for (const id of remaining) {
      const task = map.get(id)!;
      const depsMet = task.dependencies.every(d => !remaining.has(d));
      if (depsMet) layer.push(task);
    }
    if (!layer.length) throw new Error("检测到循环依赖");
    layers.push(layer);
    layer.forEach(t => remaining.delete(t.id));
  }
  return layers;
}

// —— 执行单个子任务 ——
async function runSubTask(
  task: SubTask,
  provider: Provider,
  ctx: ToolContext,
  prevResults: SubTaskResult[],
  maxRounds: number,
): Promise<SubTaskResult> {
  const start = Date.now();

  // 把前置任务结果注入子任务上下文
  const contextLines = prevResults
    .filter(r => task.dependencies.includes(r.taskId))
    .map(r => `【${r.title}】${r.success ? r.output : `失败: ${r.error}`}`);

  const fullTask = contextLines.length
    ? `前置结果：\n${contextLines.join("\n\n")}\n\n你的任务：${task.description}`
    : task.description;

  // 构造子任务专属上下文：限制可用工具 + 限制轮数
  const subCtx: ToolContext = {
    workspace: ctx.workspace,
    allowedTools: task.tools?.length ? new Set(task.tools) : undefined,
  };

  try {
    const result = await runAgent(fullTask, provider, subCtx, undefined, {
      maxRounds,
      safetyOptions: { autoApprove: true },
    });
    return {
      taskId: task.id,
      title: task.title,
      success: true,
      output: result.answer,
      durationMs: Date.now() - start,
    };
  } catch (e) {
    return {
      taskId: task.id,
      title: task.title,
      success: false,
      output: "",
      error: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - start,
    };
  }
}

// —— 有限并行执行一层 ——
async function runLayer(
  layer: SubTask[],
  provider: Provider,
  ctx: ToolContext,
  results: SubTaskResult[],
  maxParallel: number,
  maxRounds: number,
): Promise<SubTaskResult[]> {
  const layerResults: SubTaskResult[] = [];
  const queue = [...layer];

  const workers = Array.from({ length: Math.min(maxParallel, queue.length) }, async () => {
    while (queue.length) {
      const task = queue.shift()!;
      const result = await runSubTask(task, provider, ctx, results, maxRounds);
      layerResults.push(result);
    }
  });

  await Promise.all(workers);
  return layerResults;
}

// —— 结果汇总 ——
async function summarizeResults(
  originalTask: string,
  results: SubTaskResult[],
  provider: Provider,
): Promise<string> {
  const resultText = results
    .map(r => `## ${r.title}\n${r.success ? r.output : `失败: ${r.error}`}`)
    .join("\n\n");

  const messages: ChatMessage[] = [
    { role: "system", content: SUMMARIZE_PROMPT },
    { role: "user", content: `原始任务：${originalTask}\n\n子任务执行结果：\n${resultText}` },
  ];

  const { content } = await provider.chat(messages, []);
  return content;
}

// —— 主编排函数 ——
export async function orchestrate(
  task: string,
  decomposition: DecompositionResult,
  provider: Provider,
  ctx: ToolContext,
  opts: SubAgentOptions = {},
): Promise<{ finalAnswer: string; results: SubTaskResult[] }> {
  const maxParallel = opts.maxParallel ?? MAX_PARALLEL;
  const maxRounds = opts.maxRoundsPerTask ?? MAX_ROUNDS;

  const layers = topoSort(decomposition.tasks);
  const allResults: SubTaskResult[] = [];

  for (const layer of layers) {
    const layerResults = await runLayer(layer, provider, ctx, allResults, maxParallel, maxRounds);
    allResults.push(...layerResults);
  }

  const finalAnswer = await summarizeResults(task, allResults, provider);
  return { finalAnswer, results: allResults };
}