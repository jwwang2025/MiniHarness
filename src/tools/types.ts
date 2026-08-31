export interface Tool<P = unknown> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(args: P, ctx: ToolContext): Promise<ToolResult>;
}

export interface ToolContext {
  workspace: string;
}

export type ToolResult =
  | { ok: true; output: string }
  | { ok: false; error: string };



