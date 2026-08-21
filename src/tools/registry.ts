import type { Tool } from "./types.ts";

const tools = new Map<string, Tool>();

export function register(tool: Tool) {
  tools.set(tool.name, tool);
}

export function getTool(name: string) {
  return tools.get(name);
}

export function toOpenAITools() {
  return Array.from(tools.values()).map(t => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}