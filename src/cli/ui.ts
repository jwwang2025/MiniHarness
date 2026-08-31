import pc from "picocolors";
import ora, { type Ora } from "ora";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";

marked.use(markedTerminal());

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
    // marked.parse 默认同步返回 string；async:false 既约束类型又显式声明意图
    return marked.parse(text, { async: false }).trim();
}

export function renderToolCall(name: string, args: unknown): string {
    const s = typeof args === "string" ? args : JSON.stringify(args);
    return `${pc.magenta(`🔧 ${name}`)} ${pc.gray(s.slice(0, 80))}`;
}