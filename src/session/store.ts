import { mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Session } from "./types.ts";

const SESSIONS_DIR = ".anvil/sessions";

function sessionPath(id: string): string {
    return join(SESSIONS_DIR, `${id}.json`);
}

function titleFromMessages(messages: ChatMessage["messages"]): string {
    const firstUser = messages.find((msg) => msg.role === "user");
    const text = firstUser?.content ?? "新会话";
    return text.length > 30 ? text.slice(0, 30) + "..." : text;
}

export async function createSession