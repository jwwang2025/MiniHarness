import pc from "picocolors";
import ora, { type Ora } from "ora";
import { marked } from "marked";
import markedTerminal from "marked-terminal";

marked.use(new markedTerminal());

export const color = pc;
export { pc };

let spinner: Ora | null = null;

export function startSpinner(msg: string) {
    spinner?.stop();
    spinner = ora({ text: msg,spinner: "dots" }).start();
}

export function stopSpinner(msg?: string,symbol?: string): void {
    if (!spinner) {
        return;
    }
    if (msg) {
        spinner.stopAndPersist({ text: msg, symbol: symbol ?? " " });
    }else{
        spinner.stop();
    }
    spinner = null;
}

export function renderMarkdown(text: string): string {
    return marked.parse(text).trim();
}

export function renderToolCall(name: string, arguments: unknown): string {
    const s = typeof arguments === "string" ? arguments : JSON.stringify(arguments);
    return `${pc.magenta(`🔧 ${name}`)} ${pc.gray(s.slice(0, 80))}`;
}