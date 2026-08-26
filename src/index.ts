import { registerFileTools } from "./tools/file-tools.ts";
import { runAgent, type LoopEvent } from "./agent/loop.ts";
import type { ChatMessage } from "./config.ts";
import { createInterface } from "node:readline";

const [, , cmd, ...rest] = process.argv;

const ctrl = new AbortController();
process.on("SIGINT", () => ctrl.abort());

registerFileTools();
const ctx = { workspace: process.cwd() };

function printEvent(e: LoopEvent) {
  switch (e.type) {
    case "thinking":
      process.stderr.write(`\n[round ${e.round + 1}]\n`);
      break;
    case "tool_call":
      process.stderr.write(`  → ${e.name} ${JSON.stringify(e.args).slice(0, 100)}\n`);
      break;
    case "safety":
      process.stderr.write(`  [safety:${e.kind}] ${e.tool}${e.detail ? ` ${e.detail}` : ""}\n`);
      break;
    case "tool_result":
      process.stderr.write(`  ✓ ${e.name} → ${e.output.slice(0, 100)}${e.output.length > 100 ? "..." : ""} (${e.ok ? "ok" : "fail"})\n`);
      break;
    case "context_compressed":
      process.stderr.write(`  [context] ${e.beforeTokens} → ${e.afterTokens} tokens 已压缩\n`);
      break;
  }
}

if (cmd === "ask" && rest.length) {
  const result = await runAgent(rest.join(" "), ctx, ctrl.signal, { onEvent: printEvent });
  console.log(result.answer);
  process.exit(0);
}

if (cmd === "chat") {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let history: ChatMessage[] | undefined;

  console.log("MiniHarness 多轮对话模式（输入 :exit 退出，:reset 清空上下文）");

  const askOnce = async (): Promise<void> => {
    return new Promise((resolve) => {
      rl.question("\n你> ", async (input: string) => {
        const text = input.trim();
        if (!text) { resolve(); return; }

        if (text === ":exit" || text === ":quit") {
          rl.close();
          resolve();
          return;
        }
        if (text === ":reset") {
          history = undefined;
          console.log("[已重置上下文]");
          resolve();
          return;
        }
        
        const result = await runAgent(text, ctx, ctrl.signal, { onEvent: printEvent }, history);
        history = result.messages;
        console.log(`\nAssistant> ${result.answer}`);
        resolve();
      });
    });
  };

  const loop = async () => {
    while (true) {
      await askOnce();
      if (rl.closed) break;
    }
  };

  loop();
}
 