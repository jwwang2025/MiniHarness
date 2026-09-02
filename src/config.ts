process.loadEnvFile();

import { z } from "zod";

export interface MCPServerConfig {
  name: string;
  command: string;
  args: string[];
}

function parseMCPServers(raw?: string): MCPServerConfig[] {
  if (!raw) return [];
  return raw.split(";").filter(Boolean).map((s) => {
    const [name, ...rest] = s.split(":");
    const parts = rest.join(":").trim().split(/\s+/);
    return { name: name.trim(), command: parts[0] || "", args: parts.slice(1) };
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
export const mcpServers = parseMCPServers(env.MINIHARNESS_MCP_SERVERS);
