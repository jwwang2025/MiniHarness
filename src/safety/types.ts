// 工具调用
export interface ToolInvocation {
  toolName: string;
  args: Record<string, unknown>;
  workspace: string;
}

export type Permission = "allow" | "ask" | "deny";

// 审批决定 / 授权判定
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
  promptFn?: (prompt: string)=>Promise<string>;
  // eval/自动化场景：跳过所有 "ask" 类工具的人工确认（仍尊重策略 "deny"）
  autoApprove?: boolean;
}