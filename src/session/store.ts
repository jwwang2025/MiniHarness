import { mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Session } from "./types.ts";

const SESSIONS_DIR = ".anvil/sessions";

function sessionPath(id: string): string {
    return join(SESSIONS_DIR, `${id}.json`);
}

function titleFromMessages(messages: Session["messages"]): string {
    const firstUser = messages.find((msg) => msg.role === "user");
    const text = firstUser?.content ?? "新会话";
    return text.length > 30 ? text.slice(0, 30) + "..." : text;
}

export async function saveSession(session: Session): Promise<void> {
    session.updatedAt = Date.now();
    await mkdir(SESSIONS_DIR, { recursive: true });
    await writeFile(sessionPath(session.id), JSON.stringify(session, null, 2), "utf-8");
}

export async function createSession(messages: Session["messages"] = []): Promise<Session> {
    const now = Date.now();
    const session: Session = {
        id: randomUUID(),
        title: titleFromMessages(messages),
        createdAt: now,
        updatedAt: now,
        messages,
        state: "running",
    };
    await mkdir(SESSIONS_DIR, { recursive: true });
    await saveSession(session);
    return session;
}

export async function loadSession(id: string): Promise<Session | null> {
    try {
        const data = await readFile(sessionPath(id), "utf-8");
        return JSON.parse(data) as Session;
    } catch {
        return null;
    }
}

export async function listSessions(): Promise<Session[]> {
    let files: string[] = [];
    files = await readdir(SESSIONS_DIR);
    const sessions: Session[] = [];
    for (const file of files) {
        if (!file.endsWith(".json")) {
            continue;
        }
        const session = await loadSession(file.slice(0, -5));
        if (session) {
            sessions.push(session);
        }
    }
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteSession(id: string): Promise<void> {
    await rm(sessionPath(id), { recursive: true });
}