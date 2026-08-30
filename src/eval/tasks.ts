import type { EvalTask } from "./types.ts";

export const TASKS: EvalTask[] = [
    {
        id: "read-package-name",
        category: "file",
        description: "读取 package.json 文件，找出这个项目的 name 字段的值，只回答项目名称本身，不要其他解释。",
        verify: { type: "contain", expected: "MiniHarness" },
        difficulty: 1
    },
    {
        id: "list-src-dir",
        category: "file",
        description: "列出 src 目录下的所有文件和子目录，然后用一句话告诉我有哪些子目录。",
        verify: { type: "regex", pattern: "(?=[\\s\\S]*agent)(?=[\\s\\S]*tools)" },
        difficulty: 1
    },
    {
        id: "read-tool-types",
        category: "file",
        description: "读取 src/tools/types.ts 文件，告诉我 Tool 接口里有哪些字段（属性名）。",
        verify: { type: "regex", pattern: "(?=[\\s\\S]*name)(?=[\\s\\S]*description)(?=[\\s\\S]*execute)" },
        difficulty: 2
    },
    {
        id: "count-lines-config",
        category: "file",
        description: "读取 src/config.ts 文件，然后告诉我这个文件大约有多少行代码（你可以数一下行数）。直接回答数字。",
        verify: {
            type: "script",
            command: "node -e \"const fs=require('fs');const lines=fs.readFileSync('src/config.ts','utf8').split('\\n').length;const input=process.argv[1]||'';const nums=input.match(/\\d+/g);const ok=nums&&nums.some(n=>Math.abs(parseInt(n)-lines)<=2);process.exit(ok?0:1)\""
        },
        difficulty: 2
    },
    {
        id: "multi-read-compare",
        category: "multi_tool",
        description: "先读取 src/tools/registry.ts，再读取 src/tools/file-tools.ts，然后告诉我：file-tools.ts 里注册了几个工具？",
        verify: { type: "contain", expected: "3" },
        difficulty: 3
    },
    {
        id: "find-system-prompt",
        category: "multi_tool",
        description: "在项目中找到定义系统提示词（system prompt）的文件，告诉我那个文件的路径，以及提示词里是否提到了'工具'这个词。",
        verify: { type: "contain", expected: "system-prompt.ts" },
        difficulty: 3
    }
];
