import { resolve } from "node:path";
import type{ Permission, ToolInvocation, SafetyOptions } from "./types.ts";

const DEFAULT_POLICY: Record<string, Permission> = {
    "read-file": "allow",
    "list-files": "allow",
    "write-file": "ask",
    "edit-file": "ask",
    "run-shell": "ask",
};

export function inWorkspace(workspace: string, path: string) : string | null {
    const ws = resolve(workspace);
    const p = resolve(ws, path);
    return p.startsWith(ws + "\\") || p === ws || p.startsWith(ws + "/") ? p : null;
}

const DANGEROUS_PATTERNS: RegExp[] = [
  /\brm\s+-rf?\b/,
  /\b(curl|wget)\s+.*\|\s*(sh|bash|zsh|pwsh|powershell)/,
  /\bgit\s+push\s+(--force|-f)\b/,
  /\bchmod\s+777\b/,
  /\bdd\s+if=/,
  /\b(mkfs|fdisk|format)\b/,
  /;\s*rm\s+/,
  /`rm\s+/,
  /\$\(rm\s+/,
];

export function isDangerousCommand(cmd: String): string | null {
    for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(cmd)) {
            return pattern.toString();
        }
    }
    return null;
}

export function checkPolicy(inv: ToolInvocation, opts: SafetyOptions = {}): Permission {
    const { toolName, args, workspace } = inv;
    const logger = opts.logger;
    const defaultPerm = DEFAULT_POLICY[toolName] ?? "ask";

    if("path" in args && typeof args.path === "string") {
        const safe = inWorkspace(workspace, args.path);
        if(!safe) {
            logger?.({ kind: "deny", tool: toolName, reason: `路径越界：${args.path}` });
            return "deny";
        }
    }

    if(toolName === "run-shell" && typeof args.command === "string") {
        const danger = isDangerousCommand(args.command);
        if(danger) {
            logger?.({ kind: "deny", tool: toolName, reason: `命中危险模式：${danger}` });
            return "deny";
        }
    }
    
    if(defaultPerm === "allow") {
        logger?.({ kind: "allow", tool: toolName, reason: `默认策略 allow` });
    }

    return defaultPerm;
}