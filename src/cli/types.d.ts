declare module "marked-terminal" {
  import type { MarkedExtension } from "marked";
  // v7 起推荐用命名导出函数 markedTerminal()，返回 MarkedExtension 给 marked.use()
  export function markedTerminal(options?: Record<string, unknown>): MarkedExtension;
  export default function markedTerminal(options?: Record<string, unknown>): MarkedExtension;
}
