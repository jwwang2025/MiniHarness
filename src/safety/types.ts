export interface ToolInvocation {
  toolName: string;
  args: Record<string, unknown>;
  workspace: string;
}

export type Permission = "allow" | "ask" | "deny";

export interface ApprovalDecision {
  permission: Permission;
  persistKey?: string;
}

type SafetyLogEvent =
  | { kind: "allow"; tool: string; reason: string }
  | { kind: "ask"; tool: string; detail: string }
  | { kind: "deny"; tool: string; reason: string };

export interface SafetyOptions {
  logger?: (event:SafetyLogEvent)=>void;
  promptFn?: (prompt: string)=>Promise<string>;
  autoApprove?: boolean;
}