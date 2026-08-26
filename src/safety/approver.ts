import { createInterface } from "node:readline";
import type { ToolInvocation, ApprovalDecision, Permission, SafetyOptions } from "./types.ts";

const alwaysAllowKeys = new Set<string>();

function persistKey(inv: ToolInvocation): string {
    if(inv.toolName === "write-file" || inv.toolName === "edit-file") {
        return `${inv.toolName}:${String(inv.args.path ?? "")}`;
    }
    if(inv.toolName === "run-shell") {
        return `${inv.toolName}:${String(inv.args.command ?? "").split(/\s+/)[0] ?? ""}`;
    }
    return inv.toolName;
}

function humanize(inv: ToolInvocation): string {
    return `${inv.toolName} ${JSON.stringify(inv.args)}`;
}

function question(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise(res => rl.question(prompt, a => { rl.close(); res(a.trim().toLowerCase()); }));
}

export async function approve(
    inv: ToolInvocation, 
    perm: Permission,
    opts: SafetyOptions,
): Promise<ApprovalDecision> {
    const logger = opts.logger;
    
    if(perm==="allow") {
        return { permission: "allow" };
    };
    if(perm==="deny") {
        return { permission: "deny" };
    };

    const key = persistKey(inv);
    if(alwaysAllowKeys.has(key)) {
        return { permission: "allow", persistKey: key };
    }

    logger?.({ kind: "ask", tool: inv.toolName, detail: humanize(inv) });
    
    const promptStr = `\n⚠️  即将执行: ${humanize(inv)}\n` +
        `允许? [y=是 / n=否 / a=总是允许此模式] `;
    const ans = opts.promptFn
        ? await opts.promptFn(promptStr)
        : await question(promptStr);
    if (ans === "a") {
        alwaysAllowKeys.add(key);
        return { permission: "allow", persistKey: key };
    }
    return { permission: ans === "y" ? "allow" : "deny" };
}

export function clearAlwaysAllow() {
  alwaysAllowKeys.clear();
}