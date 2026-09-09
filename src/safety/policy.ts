import { resolve } from "node:path";
import type{ Permission, ToolInvocation, SafetyOptions } from "./types.ts";

const DEFAULT_POLICY: Record<string, Permission> = {
    "read-file": "allow",
    "list-files": "allow",
    "write-file": "ask",
    "edit-file": "ask",
    "run-shell": "ask",
    // MCP filesystem 工具
    "mcp__fs__search_files": "allow",
    "mcp__fs__list_directory": "allow",
    "mcp__fs__read_file": "allow",
    "mcp__fs__get_file_info": "allow",
    "mcp__fs__write_file": "ask",
    "mcp__fs__edit_file": "ask",
    "mcp__fs__create_directory": "ask",
    "mcp__fs__move_file": "ask",
    // MCP memory 工具
    "mcp__mem__read_entities": "allow",
    "mcp__mem__read_graph": "allow",
    "mcp__mem__search_nodes": "allow",
    "mcp__mem__open_nodes": "allow",
    "mcp__mem__create_entities": "ask",
    "mcp__mem__create_relations": "ask",
    "mcp__mem__add_observations": "ask",
    "mcp__mem__delete_entities": "ask",
    "mcp__mem__delete_relations": "ask",
    "mcp__mem__delete_observations": "ask",
    // MCP shell 工具（local-terminal-mcp）
    "mcp__shell__shell_run": "ask",
    "mcp__shell__check_command": "allow",
    "mcp__shell__list_rules": "allow",
    "mcp__shell__reload_config": "ask",
    // Git MCP 工具 — 只读操作 allow，写操作 ask，破坏性操作 deny
    "mcp__git__git_status": "allow",
    "mcp__git__git_diff": "allow",
    "mcp__git__git_log": "allow",
    "mcp__git__git_show": "allow",
    "mcp__git__git_blame": "allow",
    "mcp__git__git_reflog": "allow",
    "mcp__git__git_branch": "allow",
    "mcp__git__git_remote": "allow",
    "mcp__git__git_add": "ask",
    "mcp__git__git_commit": "ask",
    "mcp__git__git_checkout": "ask",
    "mcp__git__git_merge": "ask",
    "mcp__git__git_rebase": "ask",
    "mcp__git__git_cherry_pick": "ask",
    "mcp__git__git_stash": "ask",
    "mcp__git__git_tag": "ask",
    "mcp__git__git_fetch": "ask",
    "mcp__git__git_pull": "ask",
    "mcp__git__git_push": "ask",
    "mcp__git__git_reset": "deny",
    "mcp__git__git_clean": "deny",
    "mcp__git__git_init": "ask",
    "mcp__git__git_clone": "ask",
    "mcp__git__git_worktree": "ask",
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

    if(toolName === "mcp__shell__shell_run" && typeof args.command === "string") {
        const danger = isDangerousCommand(args.command);
        if(danger) {
            logger?.({ kind: "deny", tool: toolName, reason: `命中危险模式：${danger}` });
            return "deny";
        }
    }

    // Git MCP 工具 — 检查 repoPath 参数是否在工作区内
    if (toolName.startsWith("mcp__git__") && typeof args.repoPath === "string") {
        const safe = inWorkspace(workspace, args.repoPath);
        if (!safe) {
            logger?.({ kind: "deny", tool: toolName, reason: `路径越界：${args.repoPath}` });
            return "deny";
        }
    }
    
    if(defaultPerm === "allow") {
        logger?.({ kind: "allow", tool: toolName, reason: `默认策略 allow` });
    }

    return defaultPerm;
}