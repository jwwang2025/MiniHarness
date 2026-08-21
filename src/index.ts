import { registerFileTools } from "./tools/file-tools.ts";
import { runAgent } from "./agent/loop.ts";

const [, , cmd, ...rest] = process.argv;
if (cmd !== "ask" || !rest.length) {
  process.exit(1);
}

const ctrl = new AbortController();
process.on("SIGINT", () => ctrl.abort());

registerFileTools();

const answer = await runAgent(rest.join(" "), { workspace: process.cwd() }, ctrl.signal);
console.log(answer);