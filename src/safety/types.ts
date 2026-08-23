export type Permission = "allow" | "ask" | "deny";

export interface ToolInvocation {
  toolName: string;
  args: Record<string, unknown>;
  workspace: string;
}

export interface ApprovalDecision {
  permission: Permission;
  persistKey?: string;
}

// 1 先定义事件数据
type SafetyLogEvent = 
  | { kind: "allow"; tool: string; reason: string }
  | { kind: "ask"; tool: string; detail: string }
  | { kind: "deny"; tool: string; reason: string };

//2 定义配置对象接口
export interface SafetyOptions {
  logger?: (event:SafetyLogEvent)=>void;
}