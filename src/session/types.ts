import type { ChatMessage } from "../config.ts";

export interface Session {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messages: ChatMessage[];
    state: "running" | "done" | "paused";
}