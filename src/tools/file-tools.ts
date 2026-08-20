import { stat, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { z } from "zod";
import type { Tool, ToolContext } from "./types.ts";
import { register } from "./registry.ts";

function safePath(workspace: string, path: string) {
  return resolve(workspace, path);
}

const readFileTool: Tool = {
  name: "read-file",
  description: "读取指定文件内容，带行号输出",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "文件路径（相对工作区）" },
      maxLines: { type: "number", description: "最大读取行数，默认 200" },
    },
    required: ["path"],
  },
  execute: async (args: { path: string; maxLines?: number }, ctx: ToolContext) => {
    const schema = z.object({ path: z.string(), maxLines: z.number().optional() });
    const { path, maxLines = 200 } = schema.parse(args);
    try {
      const filePath = safePath(ctx.workspace, path);
      const content = await readFile(filePath, "utf-8");
      const lines = content.split("\n");
      const truncated = lines.slice(0, maxLines).map((line, index) => `${index + 1}  ${line}`).join("\n");
      const note = lines.length > maxLines ? `\n... (共 ${lines.length} 行，已截断)` : "";
      return { ok: true, output: truncated + note };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  },
};

export function registerFileTools() {
  register(readFileTool);
}