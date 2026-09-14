import { readFile } from "node:fs/promises";
import { join } from "node:path";

const MAX_LINES = 100;
const MAX_BYTES = 10_000;

export async function loadProjectMemory(workspace: string): Promise<string> {
  let content = await readFile(join(workspace, "AGENTS.md"), "utf-8");
  const lines = content.split("\n");
  if (lines.length > MAX_LINES)
    content = lines.slice(0, MAX_LINES).join("\n") + "\n...(AGENTS.md 已截断)";
  if (content.length > MAX_BYTES)
    content = content.slice(0, MAX_BYTES) + "\n...(AGENTS.md 已截断)";
  return content.trim();
}

export function withMemory(base: string, memory: string): string {
  return memory ? `${base}\n\n# 项目约定（来自 AGENTS.md）\n${memory}` : base;
}
