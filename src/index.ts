import { registerFileTools, register } from "./tools/index.ts";
import { runAgent, type LoopEvent } from "./agent/index.ts";
import { createSession, loadSession, listSessions, type Session } from "./session/index.ts";
import { repl } from "./cli/index.ts";

import { TASKS, runEvalTask, buildReport, loadBaseline, saveBaseline, compareWithBaseline, formatReport } from "./eval/index.ts";

import { createProvider } from "./provider/index.ts";
import { formatMetrics } from "./telemetry/index.ts";
import { MCPClient, registerMCPTools } from "./mcp/index.ts";
import { mcpServers } from "./config.ts";
const provider = createProvider();

const [, , cmd, ...rest] = process.argv;
const ctrl = new AbortController();
process.on("SIGINT", () => {
  ctrl.abort();
  process.exit(130);
});

registerFileTools();
const ctx = { workspace: process.cwd() };

// 启动 MCP 服务器并注册工具（失败不阻塞主流程）
const mcpClients: MCPClient[] = [];
for (const cfg of mcpServers) {
  const client = new MCPClient(cfg.name, cfg.command, cfg.args);
  try {
    await client.start();
    const count = await registerMCPTools(client, register);
    console.error(`[MCP] ${cfg.name}: ${count} 个工具就绪`);
    mcpClients.push(client);
  } catch (e) {
    console.error(`[MCP] ${cfg.name} 启动失败，跳过: ${e}`);
  }
}
process.on("exit", () => mcpClients.forEach((c) => c.stop()));

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
    case "text_delta":          process.stdout.write(e.delta); break; // 流式答案直出 stdout
    case "answer":              break; // answer 已通过 text_delta 实时打印
  }
};

// ask：单轮任务，自动建会话并落盘
async function ask() {
  const question = rest.join(" ").trim();
  if (!question) { console.error(USAGE); process.exit(1); }
  const session = await createSession();
  session.title = question.length > 30 ? question.slice(0, 30) + "..." : question;
  const result = await runAgent( question, provider, ctx, ctrl.signal, { onEvent: logEvent, session });
  console.log(); // 答案已流式输出，补换行
  console.error(`\n[session] ${session.id}`);
  console.error(formatMetrics(result.metrics!));
}

// chat：多轮对话，自动持久化，支持恢复（UI 委托给 cli/repl）
async function chat() {
  const sessionId = rest[0];
  if (sessionId) {
    const loaded = await loadSession(sessionId);
    if (!loaded) { console.error(`未找到会话 ${sessionId}`); process.exit(1); return; }
    console.log(`[恢复会话 ${loaded.id}] ${loaded.title}`);
    await repl(ctx.workspace, {}, loaded);
    return;
  }
  await repl(ctx.workspace, {});
}

// resume：从落盘的 session 续跑
async function resume() {
  const id = rest[0];
  if (!id) { console.error(USAGE); process.exit(1); }
  const session = await loadSession(id);
  if (!session) { console.error(`未找到会话 ${id}`); process.exit(1); }
  const result = await runAgent( "", provider, ctx, ctrl.signal, { onEvent: logEvent, session });
  console.log(); // 答案已流式输出，补换行
  console.error(formatMetrics(result.metrics!));
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

// eval：跑评测集，可选 --save 存为新基线
async function eval_() {
    const isSaveBaseline = rest[0] === "--save";
    const workspace = process.cwd();
    const results = [];
    for (const task of TASKS) {
        const result = await runEvalTask(task, workspace);
        results.push(result);
    }
    const report = buildReport(results);
    const baseline = await loadBaseline();
    if (baseline) {
        const result = compareWithBaseline(report, baseline);
        console.log(formatReport(result));
    } else {
        console.log(formatReport(report));
    }
    if (isSaveBaseline) {
        await saveBaseline(report);
        console.log("已保存新基线");
    }
    
}

const commands: Record<string, () => Promise<void>> = { ask, chat, resume, sessions, eval: eval_ };
await (commands[cmd] ?? (() => { console.error(USAGE); process.exit(1); }))();
 