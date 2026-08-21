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

const writeFileTool: Tool = {
  name: "write-file",
  description: "创建或覆盖写入文件",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "文件路径（相对工作区）" },
      content: { type: "string", description: "要写入的内容" },
    },
    required: ["path", "content"],
  },
  execute: async (args: { path: string; content: string }, ctx: ToolContext) => {
    const { path, content } = z.object({ path: z.string(), content: z.string() }).parse(args);
    try {
      const filePath = safePath(ctx.workspace, path);
      await mkdir(join(filePath, ".."), { recursive: true });
      await writeFile(filePath, content, "utf-8");
      return { ok: true, output: `已写入 ${path}` };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  },
};

const listDirTool: Tool = {
  name: "list-dir",
  description: "列出指定目录下的文件和子目录",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "目录路径（相对工作区），默认 ." },
    },
    required: [],
  },
  execute: async (args: { path?: string }, ctx: ToolContext) => {
    const { path = "." } = z.object({ path: z.string().optional() }).parse(args);
    try {
      const dirPath = safePath(ctx.workspace, path);
      const entries = await readdir(dirPath);
      const lines: string[] = [];
      for (const name of entries) {
        const stats = await stat(join(dirPath, name));
        lines.push(stats.isDirectory() ? `📁 ${name}/` : `📄 ${name}`);
      }
      return { ok: true, output: lines.join("\n") };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  },
};

export function registerFileTools() {
  register(readFileTool);
  register(writeFileTool);
  register(listDirTool);
}