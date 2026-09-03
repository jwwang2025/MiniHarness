import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

interface JsonRpcResponse {
    jsonrpc: "2.0";
    id: string | number;
    result?: unknown;
    error?: {
        code: number;
        message: string;
    };
}

export interface MCPTool {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

const REQUEST_TIMEOUT_MS = 30_000;

export class MCPClient {
    private process: ChildProcess | null = null;
    private pending = new Map<string, {
        resolve: (r: unknown) => void;
        reject: (e: unknown) => void;
        timer: ReturnType<typeof setTimeout>;
    }>();
    private buffer = "";
    private initialized = false;
    private dead = false;

    constructor(
        private serverName: string,
        private command: string,
        private args: string[] = [],
        private env: Record<string, string> = {},
    ) {}

    async start(): Promise<void> {
        this.process = spawn(this.command, this.args, {
            stdio: ["pipe", "pipe", "pipe"],
            shell: process.platform === "win32",
            env: { ...process.env, ...this.env },
        });

        this.process.stdout!.setEncoding("utf-8");
        this.process.stdout!.on("data", (chunk: string) => this.handleData(chunk));
        this.process.stderr!.on("data", (chunk: Buffer) => {
            console.error(`[MCP:${this.serverName}] ${chunk.toString().trim()}`);
        });

        this.process.on("exit", (code) => {
            this.dead = true;
            const err = new Error(`MCP 服务器 ${this.serverName} 退出，退出码为 ${code}`);
            for (const { reject, timer } of this.pending.values()) {
                clearTimeout(timer);
                reject(err);
            }
            this.pending.clear();
        });
        this.process.on("error", (err) => {
            this.dead = true;
            console.error(`[MCP:${this.serverName}] 启动失败: ${err.message}`);
        });

        await this.request("initialize", {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "MiniHarness", version: "0.0.1", },
        });

        this.notify("notifications/initialized", {});
        this.initialized = true;
    }

    async listTools(): Promise<MCPTool[]> {
        if (!this.initialized){ 
            throw new Error(`MCP ${this.serverName} 未初始化`);
        }
        const result = await this.request("tools/list", {});
        return (result as { tools: MCPTool[] }).tools ?? [];
    }

     async callTool(
        name: string,
        args: Record<string, unknown>,
    ): Promise<{
        content: Array<{ type: string; text?: string }>;
        isError?: boolean;
    }> {
        if (!this.initialized){
            throw new Error(`MCP ${this.serverName} 未初始化`);
        }
        return await this.request("tools/call", { name, arguments: args }) as {
            content: Array<{ type: string; text?: string }>;
            isError?: boolean;
        };
    }

    stop(): void {
        if (this.process && !this.dead) {
            this.process!.kill();
        }
    }

    get isDead() { return this.dead; }
    get name() { return this.serverName; }

     // ---------- 内部方法 ----------
    private request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
        if (this.dead){ 
            return Promise.reject(new Error(`MCP ${this.serverName} 已停止`));
        }
        const id = randomUUID();
        const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";

        return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            this.pending.delete(id);
            reject(new Error(`MCP ${this.serverName} 请求超时: ${method}`));
        }, REQUEST_TIMEOUT_MS);

        this.pending.set(id, { resolve, reject, timer });
        this.process!.stdin!.write(payload);
        });
    }

    private notify(method: string, params: Record<string, unknown> = {}): void {
        if (this.dead){ 
            return;
        }
        const payload = JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n";
        this.process!.stdin!.write(payload);
    }
    
    private handleData(data: string): void {
        this.buffer += data;
        const lines = this.buffer.split("\n");
        this.buffer = lines.pop() ?? "";

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            const msg = JSON.parse(trimmed) as JsonRpcResponse;
            // 只处理有 id 的响应（通知无 id，静默忽略）
            if (msg.id == null) continue;
            const entry = this.pending.get(String(msg.id));
            if (!entry) continue;
            this.pending.delete(String(msg.id));
            clearTimeout(entry.timer);
            if (msg.error) {
                entry.reject(new Error(`MCP error: ${msg.error.message}`));
            } else {
                entry.resolve(msg.result);
            }
        }
    }
}
