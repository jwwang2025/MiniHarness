process.loadEnvFile();

import { z } from "zod";

export interface MCPServerConfig {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

// 单个服务器格式：<名字>:<启动命令> [参数...] [|KEY=VAL KEY=VAL...]
// 竖线后为透传给服务器的环境变量（如 API key、存储路径）；${workspace} 会替换为指定工作目录
export function parseMCPServers(raw: string | undefined, workspace: string): MCPServerConfig[] {
  if (!raw) return [];
  const expand = (s: string) => s.replaceAll("${workspace}", workspace);
  return raw.split(";").filter(Boolean).map((s) => {
    const [cmdPart, envPart] = s.split("|");
    const [name, ...rest] = cmdPart.split(":");
    const parts = expand(rest.join(":")).trim().split(/\s+/).filter(Boolean);
    const env: Record<string, string> = {};
    if (envPart) {
      for (const token of envPart.trim().split(/\s+/).filter(Boolean)) {
        const eq = token.indexOf("=");
        if (eq > 0) env[token.slice(0, eq)] = expand(token.slice(eq + 1));
      }
    }
    return { name: name.trim(), command: parts[0] || "", args: parts.slice(1), env };
  });
}

const env = z.object({
  MINIHARNESS_API_KEY: z.string().optional(),
  MINIHARNESS_BASE_URL: z.string().optional(),
  MINIHARNESS_MODEL: z.string().min(1),
  MINIHARNESS_PROVIDER: z.enum(["openai","ollama"]).default("openai"),
  MINIHARNESS_MCP_SERVERS: z.string().optional(),
}).parse(process.env);

export const apiKey = env.MINIHARNESS_API_KEY ?? "";
export const baseUrl = env.MINIHARNESS_BASE_URL;
export const model = env.MINIHARNESS_MODEL;
export const provider = env.MINIHARNESS_PROVIDER;
export const mcpServersRaw = env.MINIHARNESS_MCP_SERVERS;
