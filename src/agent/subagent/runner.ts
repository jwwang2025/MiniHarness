import type { Provider } from "../../provider/index.ts";
import type { ToolContext } from "../../tools/index.ts";
import { decomposeTask } from "./decomposer.ts";
import { orchestrate } from "./orchestrator.ts";
import type { SubAgentOptions, SubTaskResult } from "./types.ts";

export async function runSubAgentMode(
  task: string,
  provider: Provider,
  ctx: ToolContext,
  opts: SubAgentOptions & {
    onDecomposed?: (plan: string, taskCount: number) => void;
    onTaskStart?: (task: { id: string; title: string }) => void;
    onTaskDone?: (result: SubTaskResult) => void;
  } = {},
): Promise<{ finalAnswer: string; results: SubTaskResult[] }> {
  const decomposition = await decomposeTask(task, provider);
  opts.onDecomposed?.(decomposition.plan, decomposition.tasks.length);

  return orchestrate(task, decomposition, provider, ctx, opts);
}