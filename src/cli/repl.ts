import * as readline from "node:readline/promises";
import { stdin as input, stdout as output, stderr } from "node:process";
import { runAgent, type LoopEvent } from "../agent/index.ts";
import { createProvider } from "../provider/index.ts";
import type { SafetyOptions } from "../safety/index.ts";
import { createSession, listSessions, type Session } from "../session/index.ts";
import { startSpinner, stopSpinner, renderToolCall, color } from "./index.ts";
import { formatMetrics } from "../telemetry/index.ts";

// Provider 无状态，模块级创建一次即可
const provider = createProvider();

function onEvent(event: LoopEvent) {
    switch (event.type) {
        case "tool_call": {
            stopSpinner();
            stderr.write(`  ${renderToolCall(event.name, event.args)}\n`);
            startSpinner("执行中");
            break;
        }
        case "tool_result": {
            stopSpinner();
            const tag = event.ok ? color.green("✓") : color.red("✗");
            stderr.write(`  ${tag} ${color.gray(event.output.slice(0, 80))}${event.output.length > 80 ? "…" : ""}\n`);
            startSpinner("思考中");
            break;
        }
        case "context_compressed":
            stderr.write(`  ${color.gray(`⚡ 压缩 ${event.beforeTokens}→${event.afterTokens} tok`)}\n`);
            break;
        case "text_delta": {
            // 首个 delta 到达时停掉 spinner，避免 ora 刷新覆盖流式输出
            stopSpinner();
            output.write(event.delta);
            break;
        }
        case "safety": {
            // 停掉 spinner，避免 ora 持续写 stdout 把审批提示覆盖掉，导致用户看不到 [y/n]
            stopSpinner();
            const icon = event.kind === "deny" ? "🚫" : event.kind === "ask" ? "❓" : "✅";
            stderr.write(`  ${icon} ${color.gray(`[${event.kind}] ${event.tool}`)}\n`);
            break;
        }
        default:
            break;
    }
}

export async function repl(
    workspace: string,
    safetyOptions: SafetyOptions = {},
    session?: Session,
): Promise<void> {
    const rl = readline.createInterface({ input, output, terminal: true });
    // 安全审批交互复用同一个 readline，避免与主输入竞争
    const promptFn = (q: string) => rl.question(q).then((a: string) => a.trim());
    const mergedSafety: SafetyOptions = { ...safetyOptions, promptFn };

    let currentSession: Session = session ?? await createSession();
    console.log(`${color.bold("MiniHarness")} ${color.gray("REPL")} — :help 帮助，:exit 退出`);
    console.log(`session: ${color.cyan(currentSession.id)}`);

    let inFlight: AbortController | null = null;
    let ctrlCCount = 0;

    const exitWithHint = () => {
        console.log(`\n[session] ${currentSession.id}  ← 用 pnpm dev chat ${currentSession.id} 恢复`);
        process.exit(0);
    };

    // stdin EOF（管道/重定向/Ctrl+D）时优雅退出，避免 while 循环再访问已关闭的 rl
    rl.on("close", exitWithHint);
    rl.on("SIGINT", () => {
        ctrlCCount++;
        if (inFlight) {
            inFlight.abort();
        } else if (ctrlCCount >= 2) {
            exitWithHint();
        } else {
            stderr.write("\n  (再按一次 Ctrl+C 退出)\n");
            rl.prompt();
        }
    });

    const handleColonCommand = async (text: string): Promise<void> => {
        if (text === ":help") {
            console.log(":exit 退出 | :reset 新建会话 | :sessions 列表");
            return;
        }
        if (text === ":reset") {
            currentSession = await createSession();
            console.log(`[新会话 ${color.cyan(currentSession.id)}]`);
            return;
        }
        if (text === ":sessions") {
            const list = await listSessions();
            if (!list.length) { console.log("暂无会话"); return; }
            for (const s of list) {
                console.log(`  ${s.id}  [${s.state}]  ${s.title}  (${new Date(s.updatedAt).toLocaleString()})`);
            }
            return;
        }
        console.log(color.gray(`未知命令: ${text}（:help 查看帮助）`));
    };

    const askOnce = async () => {
        if (rl.closed) return;
        ctrlCCount = 0;
        let inputText: string;
        try {
            inputText = await rl.question(color.cyan("\n❯ "));
        } catch {
            return; // rl 在等待期间被关闭（管道 EOF / Ctrl+D）
        }
        const text = inputText.trim();
        if (!text) return;
        if (text === ":exit" || text === ":quit") {
            exitWithHint();
            return;
        }
        if (text.startsWith(":")) {
            await handleColonCommand(text);
            return;
        }
        inFlight = new AbortController();
        startSpinner("思考中...");
        await runAgent(text, provider, { workspace }, inFlight.signal, {
            onEvent,
            safetyOptions: mergedSafety,
            session: currentSession,
        }).then(
            (r) => {
                // 答案已通过 text_delta 实时输出，这里补换行 + 报告
                output.write("\n");
                stderr.write(formatMetrics(r.metrics!) + "\n");
            },
            (e) => {
                if (!inFlight?.signal.aborted) {
                    stderr.write(`\n  ${color.red(`错误: ${e}`)}\n`);
                }
            },
        ).finally(() => {
            stopSpinner();
            inFlight = null;
        });
    };

    while (!rl.closed) {
        await askOnce();
    }
}
