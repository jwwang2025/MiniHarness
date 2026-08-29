import { registerFileTools } from "./tools/file-tools.ts";
import { runAgent, type LoopEvent } from "./agent/loop.ts";
import { createSession, loadSession, listSessions } from "./session/store.ts";
import type { Session } from "./session/types.ts";
import { createInterface } from "node:readline";

const [, , cmd, ...rest] = process.argv;
const ctrl = new AbortController();
process.on("SIGINT", () => {
  ctrl.abort();
  process.exit(130);
});

registerFileTools();
const ctx = { workspace: process.cwd() };

const USAGE = `用法:
  pnpm dev ask "你的问题"          # 单轮任务（自动建会话）
  pnpm dev chat                     # 多轮对话（自动持久化，:exit 退出）
  pnpm dev chat <sessionId>         # 恢复会话继续对话
  pnpm dev resume <sessionId>       # 断点续跑（恢复中断的 agent 循环）
  pnpm dev sessions                 # 列出所有会话`;

const logEvent = (e: LoopEvent) => {
  switch (e.type) {
    case "thinking":            console.error(`\n[round ${e.round + 1}]`); break;
    case "tool_call":           console.error(`  → ${e.name} ${JSON.stringify(e.args).slice(0, 100)}`); break;
    case "safety":              console.error(`  [safety:${e.kind}] ${e.tool}${e.detail ? ` ${e.detail}` : ""}`); break;
    case "tool_result":         console.error(`  ${e.ok ? "✓" : "✗"} ${e.name} → ${e.output.slice(0, 100)}${e.output.length > 100 ? "..." : ""}`); break;
    case "context_compressed": console.error(`  [context] ${e.beforeTokens} → ${e.afterTokens} tokens`); break;
    case "answer":              break; // answer 由主流程打印
  }
};

// ask：单轮任务，自动建会话并落盘
async function ask() {
  const question = rest.join(" ").trim();
  if (!question) { console.error(USAGE); process.exit(1); }
  const session = await createSession();
  const { answer } = await runAgent(question, ctx, ctrl.signal, { onEvent: logEvent, session });
  console.log(answer);
  console.error(`\n[session] ${session.id}`);
}

// chat：多轮对话，自动持久化，支持恢复
async function chat() {
  const sessionId = rest[0];
  let session: Session;

  if (sessionId) {
    const loaded = await loadSession(sessionId);
    if (!loaded) { console.error(`未找到会话 ${sessionId}`); process.exit(1); }
    session = loaded;
    console.log(`[恢复会话 ${session.id}] ${session.title}`);
  } else {
    session = await createSession();
  }

  console.log("MiniHarness 多轮对话（:exit 退出，:reset 新建会话，:sessions 列表）");
  console.log(`session: ${session.id}`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const promptFn = (q: string) => new Promise<string>(res => rl.question(q, (a: string) => res(a.trim())));

  while (!rl.closed) {
    const input = await promptFn("\n你> ");
    if (!input) continue;
    if (input === ":exit" || input === ":quit") { rl.close(); break; }
    if (input === ":reset") {
      session = await createSession();
      console.log(`[新会话 ${session.id}]`);
      continue;
    }
    if (input === ":sessions") {
      const list = await listSessions();
      if (!list.length) { console.log("暂无会话"); continue; }
      for (const s of list) {
        console.log(`  ${s.id}  [${s.state}]  ${s.title}  (${new Date(s.updatedAt).toLocaleString()})`);
      }
      continue;
    }

    const { answer } = await runAgent(input, ctx, ctrl.signal, { onEvent: logEvent, safetyOptions: { promptFn }, session });
    console.log(`\nAssistant> ${answer}`);
  }

  console.log(`\n[session] ${session.id}  ← 用 pnpm dev chat ${session.id} 恢复`);
}

// resume：从落盘的 session 续跑
async function resume() {
  const id = rest[0];
  if (!id) { console.error(USAGE); process.exit(1); }
  const session = await loadSession(id);
  if (!session) { console.error(`未找到会话 ${id}`); process.exit(1); }
  const { answer } = await runAgent("", ctx, ctrl.signal, { onEvent: logEvent, session });
  console.log(answer);
}

// sessions：列出所有会话
async function sessions() {
  const list = await listSessions();
  if (!list.length) { console.log("暂无会话"); return; }
  for (const s of list) {
    const time = new Date(s.updatedAt).toLocaleString();
    console.log(`${s.id}  [${s.state}]  ${s.title}  (${time})`);
  }
}

const commands: Record<string, () => Promise<void>> = { ask, chat, resume, sessions };
await (commands[cmd] ?? (() => { console.error(USAGE); process.exit(1); }))();
 