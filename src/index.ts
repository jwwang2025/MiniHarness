import { streamChat } from "./provider/openai.ts";
import type { ChatMessage } from "./config.ts";

const [, , cmd, ...rest] = process.argv;
if (cmd !== "ask" || !rest.length) {
  process.exit(1);
}

const ctrl = new AbortController();
process.on("SIGINT", () => ctrl.abort());

const stream = await streamChat(
  [{ role: "user", content: rest.join(" ") }] satisfies ChatMessage[],
  ctrl.signal,
);
for await (const chunk of stream) process.stdout.write(chunk);
console.log();