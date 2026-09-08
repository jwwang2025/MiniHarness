import type { PreToolUseHook, PostToolUseHook, HookAction } from "./types.ts";

const preHooks: PreToolUseHook[] = [];
const postHooks: PostToolUseHook[] = [];

export function onPreToolUse(hook: PreToolUseHook) {
  preHooks.push(hook);
  return () => {
    const i = preHooks.indexOf(hook);
    if (i >= 0) preHooks.splice(i, 1);
  };
}

export function onPostToolUse(hook: PostToolUseHook) {
  postHooks.push(hook);
  return () => {
    const i = postHooks.indexOf(hook);
    if (i >= 0) postHooks.splice(i, 1);
  };
}

export interface PreToolUseResult {
  action: HookAction;
  appends: string[];
}

export async function runPreToolUse(ctx: {
  toolName: string;
  args: Record<string, unknown>;
  workspace: string;
}): Promise<PreToolUseResult> {
  const appends: string[] = [];
  for (const hook of preHooks) {
    const action = await hook(ctx);
    if (action.type === "deny") return { action, appends };
    if (action.type === "modify") Object.assign(ctx.args, action.patch);
    if (action.type === "append") appends.push(action.extraOutput);
  }
  return { action: { type: "continue" }, appends };
}

export async function runPostToolUse(ctx: {
  toolName: string;
  args: Record<string, unknown>;
  result: { ok: boolean; output?: string; error?: string };
  workspace: string;
}) {
  for (const hook of postHooks) {
    await hook(ctx);
  }
}

export function clearHooks() {
  preHooks.length = 0;
  postHooks.length = 0;
}