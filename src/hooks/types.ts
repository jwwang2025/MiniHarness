export interface PreToolUseContext {
  toolName: string;
  args: Record<string, unknown>;
  workspace: string;
}

export interface PostToolUseContext {
  toolName: string;
  args: Record<string, unknown>;
  result: { ok: boolean; output?: string; error?: string };
  workspace: string;
}

export type HookAction =
  | { type: "continue" }
  | { type: "deny"; reason: string }
  | { type: "modify"; patch: Record<string, unknown> }
  | { type: "append"; extraOutput: string };

export type PreToolUseHook = (ctx: PreToolUseContext) => HookAction | Promise<HookAction>;
export type PostToolUseHook = (ctx: PostToolUseContext) => void | Promise<void>;