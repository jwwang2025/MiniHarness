import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerFileTools } from "../src/tools/file-tools.ts";
import { getTool } from "../src/tools/registry.ts";
import type { ToolContext } from "../src/tools/types.ts";

// ---------- 极简测试框架 ----------
let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  [PASS] ${name}`);
  } catch (e) {
    failed++;
    const msg = e instanceof Error ? e.message : String(e);
    failures.push(`${name}\n      ${msg}`);
    console.log(`  [FAIL] ${name}\n      ${msg}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      `${message}\n        expected: ${JSON.stringify(expected)}\n        actual:   ${JSON.stringify(actual)}`,
    );
  }
}

// 期望 promise 抛出（用于校验 Zod 入参校验路径，execute 中 schema.parse 在 try/catch 之外）
async function expectReject(
  run: () => Promise<unknown>,
  message: string,
): Promise<void> {
  try {
    await run();
  } catch {
    return;
  }
  throw new Error(message);
}

// ---------- 注册工具 ----------
registerFileTools();
const readFileTool = getTool("read-file");
const writeFileTool = getTool("write-file");
const listDirTool = getTool("list-dir");

if (!readFileTool || !writeFileTool || !listDirTool) {
  console.error("工具未注册：read-file / write-file / list-dir");
  process.exit(1);
}

// ---------- 主流程 ----------
async function main(): Promise<void> {
  const workspace = await mkdtemp(join(tmpdir(), "miniharness-test-"));
  const ctx: ToolContext = { workspace };
  console.log(`workspace: ${workspace}`);

  try {
    // ===== write-file =====
    console.log("\n--- write-file ---");

    await test("写入新文件成功", async () => {
      const res = await writeFileTool!.execute({ path: "hello.txt", content: "hello world" }, ctx);
      assertEqual(res.ok, true, "写入应成功");
    });

    await test("覆盖已存在的文件", async () => {
      await writeFileTool!.execute({ path: "greet.txt", content: "first" }, ctx);
      const res = await writeFileTool!.execute({ path: "greet.txt", content: "second" }, ctx);
      assertEqual(res.ok, true, "覆盖应成功");
      const read = await readFileTool!.execute({ path: "greet.txt" }, ctx);
      if (!read.ok) throw new Error(`回读失败: ${read.error}`);
      assert(read.output.includes("second"), "内容应为 second");
      assert(!read.output.includes("first"), "旧内容应被清除");
    });

    await test("自动创建嵌套父目录", async () => {
      const res = await writeFileTool!.execute(
        { path: "nested/deep/file.txt", content: "deep" },
        ctx,
      );
      assertEqual(res.ok, true, "嵌套写入应成功");
      const read = await readFileTool!.execute({ path: "nested/deep/file.txt" }, ctx);
      assert(read.ok, "嵌套文件应可回读");
    });

    await test("成功返回带“已写入”字样的输出", async () => {
      const res = await writeFileTool!.execute({ path: "msg.txt", content: "x" }, ctx);
      if (!res.ok) throw new Error(`写入失败: ${res.error}`);
      assert(res.output.includes("已写入"), `输出应包含“已写入”，实际: ${res.output}`);
    });

    await test("缺少必填 path 时抛错（Zod 校验）", async () => {
      await expectReject(
        () => writeFileTool!.execute({ content: "x" } as unknown as { path: string; content: string }, ctx),
        "缺少 path 应抛错",
      );
    });

    await test("缺少必填 content 时抛错（Zod 校验）", async () => {
      await expectReject(
        () => writeFileTool!.execute({ path: "x.txt" } as unknown as { path: string; content: string }, ctx),
        "缺少 content 应抛错",
      );
    });

    // ===== read-file =====
    console.log("\n--- read-file ---");

    await test("读取文件并附带行号", async () => {
      await writeFileTool!.execute({ path: "lines.txt", content: "a\nb\nc" }, ctx);
      const res = await readFileTool!.execute({ path: "lines.txt" }, ctx);
      if (!res.ok) throw new Error(`读取失败: ${res.error}`);
      assertEqual(res.output, "1  a\n2  b\n3  c", "带行号内容不匹配");
    });

    await test("maxLines 截断并附加截断提示", async () => {
      const content = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join("\n");
      await writeFileTool!.execute({ path: "long.txt", content }, ctx);
      const res = await readFileTool!.execute({ path: "long.txt", maxLines: 3 }, ctx);
      if (!res.ok) throw new Error(`读取失败: ${res.error}`);
      assert(res.output.includes("1  line1"), "应包含第 1 行");
      assert(res.output.includes("3  line3"), "应包含第 3 行");
      assert(!res.output.includes("line4"), "不应包含第 4 行及之后");
      assert(res.output.includes("共 10 行"), "应包含截断行数提示");
    });

    await test("读取空文件返回单行空内容", async () => {
      await writeFileTool!.execute({ path: "empty.txt", content: "" }, ctx);
      const res = await readFileTool!.execute({ path: "empty.txt" }, ctx);
      if (!res.ok) throw new Error(`读取失败: ${res.error}`);
      // "".split("\n") => [""]，因此输出为 "1  "
      assertEqual(res.output, "1  ", "空文件输出应为单行带行号的空行");
    });

    await test("读取不存在的文件返回 ok:false", async () => {
      const res = await readFileTool!.execute({ path: "nope.txt" }, ctx);
      assertEqual(res.ok, false, "不存在的文件应失败");
      if (!res.ok) assert(res.error.length > 0, "错误信息不应为空");
    });

    await test("缺少必填 path 时抛错（Zod 校验）", async () => {
      await expectReject(
        () => readFileTool!.execute({} as unknown as { path: string }, ctx),
        "缺少 path 应抛错",
      );
    });

    // ===== list-dir =====
    console.log("\n--- list-dir ---");

    await test("列出文件与子目录", async () => {
      const res = await listDirTool!.execute({ path: "." }, ctx);
      if (!res.ok) throw new Error(`列目录失败: ${res.error}`);
      assert(res.output.includes("hello.txt"), "应列出 hello.txt");
      assert(res.output.includes("nested/"), "应列出 nested/ 子目录");
    });

    await test("目录条目带尾部斜杠标识", async () => {
      await mkdir(join(workspace, "subdir"));
      const res = await listDirTool!.execute({ path: "." }, ctx);
      if (!res.ok) throw new Error(`列目录失败: ${res.error}`);
      assert(res.output.includes("subdir/"), "子目录应以 / 结尾");
    });

    await test("列出空目录返回空输出", async () => {
      await mkdir(join(workspace, "emptydir"));
      const res = await listDirTool!.execute({ path: "emptydir" }, ctx);
      if (!res.ok) throw new Error(`列目录失败: ${res.error}`);
      assertEqual(res.output, "", "空目录输出应为空字符串");
    });

    await test("path 默认为 '.'（工作区根）", async () => {
      const res = await listDirTool!.execute({}, ctx);
      assert(res.ok, "默认路径列目录应成功");
    });

    await test("列出不存在的目录返回 ok:false", async () => {
      const res = await listDirTool!.execute({ path: "does-not-exist" }, ctx);
      assertEqual(res.ok, false, "不存在的目录应失败");
      if (!res.ok) assert(res.error.length > 0, "错误信息不应为空");
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (e) {
  failed++;
  console.error("\n测试运行异常:", e);
}

// ---------- 汇总 ----------
console.log(`\n${"=".repeat(50)}`);
console.log(`passed: ${passed}, failed: ${failed}`);
if (failures.length > 0) {
  console.log("\n失败用例:");
  for (const f of failures) console.log(`  - ${f}`);
}

process.exit(failed > 0 ? 1 : 0);
