import type { Tool, ToolContext, ToolResult } from "../tools/types.ts";
import type { MCPClient, MCPTool } from "./client.ts";

export function createMCPTool(
    client: MCPClient,
    serverName: string,
    mcpTool: MCPTool
): Tool {
    return  {
        name: `mcp__${serverName}__${mcpTool.name}`,
        description: mcpTool.description,
        inputSchema: mcpTool.inputSchema,

        async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
            const result = await client.callTool(mcpTool.name, args);
            const text = result.content
                .filter((item) => item.type === "text" && item.text)
                .map((item) => item.text!)
                .join("\n");
            return result.isError 
                ? { ok: false, error: text || "MCP 工具执行失败"} 
                : { ok: true, output: text || "无输出"};
        },
    };
}

export async function registerMCPTools(
    client: MCPClient, 
    registerFn: (tool: Tool) => void,
): Promise<number> {
    const tools = await client.listTools();
    for (const tool of tools) {
        registerFn(createMCPTool(client, client.name, tool));
        console.error(`[MCP:${client.name}] 注册工具: mcp__${client.name}__${tool.name}`);
    }
    return tools.length;
}