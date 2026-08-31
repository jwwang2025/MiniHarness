import * as readline from "node:readline/promises";
import { stdin as input, stdout as output, stderr } from "node:process";
import type { LoopEvent } from "../agent/loop.ts";
import type { ChatMessage } from "../config.ts";
import { runAgent } from "../agent/loop.ts";
import type { SafetyOptions } from "../safety/types.ts";
import { startSpinner, stopSpinner, renderMarkdown, renderToolCall, color } from "./ui.ts";

function onEvent(event: LoopEvent) {
    switch (event.type) {
        case "tool_call":
            stopSpinner();
            stderr.write(`  ${renderToolCall(event.name, event.args)}\n`);
            startSpinner("执行中");
            break;
        case "tool_result":
            stopSpinner();
            const tag = event.ok ? color.green("✓") : color.red("✗");
            stderr.write(`  ${tag} ${color.gray(event.output.slice(0, 80))}${event.output.length > 80 ? "…" : ""}\n`);
            startSpinner("思考中");
            break;
        case "context_compressed":
            stderr.write(`  ${color.gray(`⚡ 压缩 ${event.beforeTokens}→${event.afterTokens} tok`)}\n`);
            break;
        case "safety":
            const icon = event.kind === "deny" ? "🚫" : event.kind === "ask" ? "❓" : "✅";
            stderr.write(`  ${icon} ${color.gray(`[${event.kind}] ${event.tool}`)}\n`);     
            break;
        }
}

export async function repl(workspace: string, safetyOptions: SafetyOptions = {}): Promise<void> {
    const rl = readline.createInterface({
        input,
        output,
        terminal: true,
    });
    console.log(`${color.bold("MiniHarness")} ${color.gray("REPL")} — :help 帮助，:exit 退出`);
    let history: ChatMessage[] | undefined;
    let inFlight: AbortController | null = null;
    let ctrlCCount = 0;

    rl.on("SIGINT", () => {
        ctrlCCount++;
        if (inFlight) {
            inFlight.abort();
        }else if (ctrlCCount >= 2) {
            rl.close();
            process.exit(0);
        }else{
            stderr.write("\n  (再按一次 Ctrl+C 退出)\n");
            rl.prompt();
        }
    });

    const askOnce = async () => {
        ctrlCCount = 0;
        const input = await rl.question(color.cyan("\n❯ "));
        const text = input.trim();
        if(!text) {
            return;
        }
        if (text === ":exit" || text === ":quit") {
            rl.close();
            process.exit(0);
        }
        if (text === ":help") {
            console.log(":exit 退出 | :reset 清空上下文");
            return;
        }
        inFlight = new AbortController();
        startSpinner("思考中...");
        
        await runAgent(text, { workspace }, inFlight.signal, {
            onEvent: onEvent,
            safetyOptions,
        }, history).then(
            (r) => {
                history = r.messages;
                output.write(`\n${color.green("❯❯")} ${renderMarkdown(r.answer)}\n`);
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
    while(true) {
        await askOnce();
    }
}