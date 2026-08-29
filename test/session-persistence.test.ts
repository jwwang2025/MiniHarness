import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSession,
  saveSession,
  loadSession,
  listSessions,
  deleteSession,
} from "../src/session/store.ts";
import type { Session } from "../src/session/types.ts";
import type { ChatMessage } from "../src/config.ts";

// ---------- 极简测试框架（与项目其它测试保持一致） ----------
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

// store.ts 使用相对路径 ".anvil/sessions"，基于 process.cwd() 解析
// 真实测试：切换到独立临时目录，让落盘文件互相隔离
const originalCwd = process.cwd();
async function withTempWorkspace(fn: (ws: string) => Promise<void>): Promise<void> {
  const ws = await mkdtemp(join(tmpdir(), "session-test-"));
  process.chdir(ws);
  try {
    await fn(ws);
  } finally {
    process.chdir(originalCwd);
    await rm(ws, { recursive: true, force: true });
  }
}

// ---------- 主流程 ----------
async function main(): Promise<void> {
  // ============================================================
  // 1. createSession —— 创建会话并真实落盘
  // ============================================================
  console.log("\n--- createSession ---");

  await test("无消息创建：默认 title='新会话'，state='running'", async () => {
    await withTempWorkspace(async () => {
      const s = await createSession();
      assertEqual(s.title, "新会话", "无消息时 title 应为默认值");
      assertEqual(s.state, "running", "初始 state 应为 running");
      assertEqual(s.messages.length, 0, "messages 应为空数组");
      assert(s.id.length > 0, "id 应非空");
    });
  });

  await test("带消息创建：title 取自第一条 user 消息（短）", async () => {
    await withTempWorkspace(async () => {
      const msgs: ChatMessage[] = [
        { role: "user", content: "你好" },
        { role: "assistant", content: "您好" },
      ];
      const s = await createSession(msgs);
      assertEqual(s.title, "你好", "title 应等于第一条 user 消息");
      assertEqual(s.messages.length, 2, "messages 应被保留");
    });
  });

  await test("带消息创建：title 超过 30 字符时截断 + '...'", async () => {
    await withTempWorkspace(async () => {
      // 注意：源码条件是 text.length > 30，所以用 35 字符确保触发
      const long = "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十壹贰叁肆伍";
      assert(long.length > 30, `测试前置：长字符串长度=${long.length}`);
      const s = await createSession([{ role: "user", content: long }]);
      assertEqual(s.title, long.slice(0, 30) + "...", "长 title 应被截断");
      assertEqual(s.title.length, 33, "截断后 title 长度应为 30 + '...'");
    });
  });

  await test("第一条非 user 消息时 title 退回 '新会话'", async () => {
    await withTempWorkspace(async () => {
      const s = await createSession([{ role: "assistant", content: "hi" }]);
      assertEqual(s.title, "新会话", "无 user 消息应使用默认 title");
    });
  });

  await test("createdAt 与 updatedAt 初始接近相等（saveSession 会推进 updatedAt）", async () => {
    await withTempWorkspace(async () => {
      const s = await createSession();
      // createSession 内会调用 saveSession，后者会设置 updatedAt = Date.now()
      // 因此 updatedAt >= createdAt（可能相等或大 1ms）
      assert(s.updatedAt >= s.createdAt, "updatedAt 应 >= createdAt");
      assert(s.createdAt > 0, "时间戳应为正数");
    });
  });

  await test("真实落盘：.anvil/sessions/<id>.json 文件存在", async () => {
    await withTempWorkspace(async () => {
      const s = await createSession();
      const filePath = join(".anvil", "sessions", `${s.id}.json`);
      const stats = await stat(filePath);
      assert(stats.isFile(), "落盘文件应为普通文件");
      const raw = await readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw) as Session;
      assertEqual(parsed.id, s.id, "落盘文件 id 应匹配");
    });
  });

  await test("生成的 id 为合法 UUID 格式（8-4-4-4-12）", async () => {
    await withTempWorkspace(async () => {
      const s = await createSession();
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      assert(uuidRe.test(s.id), `id 应为 UUID 格式，实际: ${s.id}`);
    });
  });

  // ============================================================
  // 2. saveSession —— 保存/更新
  // ============================================================
  console.log("\n--- saveSession ---");

  await test("saveSession 更新 updatedAt 后落盘", async () => {
    await withTempWorkspace(async () => {
      const s = await createSession();
      const before = s.updatedAt;
      // 等待时间戳精度跨过
      await new Promise((r) => setTimeout(r, 5));
      s.state = "done";
      s.messages.push({ role: "user", content: "二问" });
      await saveSession(s);
      assert(s.updatedAt > before, "saveSession 应推进 updatedAt");
      const reloaded = await loadSession(s.id);
      assert(reloaded !== null, "更新后应能加载");
      assertEqual(reloaded!.state, "done", "state 应为 done");
      assertEqual(reloaded!.messages.length, 1, "messages 应被持久化");
    });
  });

  await test("saveSession 写入的 JSON 可被反序列化为完整 Session", async () => {
    await withTempWorkspace(async () => {
      const msgs: ChatMessage[] = [
        { role: "system", content: "sys" },
        { role: "user", content: "问题" },
        { role: "assistant", content: "回答" },
      ];
      const s = await createSession(msgs);
      const raw = await readFile(join(".anvil", "sessions", `${s.id}.json`), "utf-8");
      const parsed = JSON.parse(raw) as Session;
      assertEqual(parsed.messages[0]!.role, "system", "第 1 条 role 应保留");
      assertEqual(parsed.messages[2]!.content, "回答", "第 3 条 content 应保留");
    });
  });

  // ============================================================
  // 3. loadSession —— 加载会话
  // ============================================================
  console.log("\n--- loadSession ---");

  await test("加载存在的会话返回完整数据", async () => {
    await withTempWorkspace(async () => {
      const original = await createSession([{ role: "user", content: "test msg" }]);
      const loaded = await loadSession(original.id);
      assert(loaded !== null, "存在的会话应返回非 null");
      assertEqual(loaded!.id, original.id, "id 应一致");
      assertEqual(loaded!.title, original.title, "title 应一致");
      assertEqual(loaded!.state, original.state, "state 应一致");
      assertEqual(loaded!.messages.length, original.messages.length, "messages 长度应一致");
    });
  });

  await test("加载不存在的会话返回 null（不抛错）", async () => {
    await withTempWorkspace(async () => {
      const loaded = await loadSession("nonexistent-uuid");
      assertEqual(loaded, null, "不存在的会话应返回 null");
    });
  });

  await test("loadSession 返回的对象与 createSession 的内容等价", async () => {
    await withTempWorkspace(async () => {
      const msgs: ChatMessage[] = [
        { role: "user", content: "hello world" },
        { role: "assistant", content: "hi there" },
      ];
      const s = await createSession(msgs);
      const loaded = await loadSession(s.id);
      assert(loaded !== null, "应加载成功");
      assertEqual(loaded!.createdAt, s.createdAt, "createdAt 应一致");
      assertEqual(loaded!.updatedAt, s.updatedAt, "updatedAt 应一致");
      assertEqual(loaded!.messages[1]!.content, "hi there", "assistant 消息内容应一致");
    });
  });

  // ============================================================
  // 4. listSessions —— 列出所有会话
  // ============================================================
  console.log("\n--- listSessions ---");

  await test("无会话但目录存在时返回空数组", async () => {
    await withTempWorkspace(async () => {
      // 注意：源码 listSessions 直接 readdir，目录不存在时会抛 ENOENT
      // 因此必须先创建一次会话（建立目录）再删除，让目录存在但为空
      const s = await createSession();
      await deleteSession(s.id);
      const list = await listSessions();
      assertEqual(list.length, 0, "目录存在但无会话时应返回空数组");
    });
  });

  await test("无会话且目录不存在时抛 ENOENT（真实行为）", async () => {
    await withTempWorkspace(async () => {
      let threw = false;
      try {
        await listSessions();
      } catch (e) {
        threw = true;
        assert(String(e).includes("ENOENT"), "错误应为 ENOENT");
      }
      assert(threw, "目录不存在时 listSessions 应抛 ENOENT");
    });
  });

  await test("列出多个会话，按 updatedAt 倒序", async () => {
    await withTempWorkspace(async () => {
      const s1 = await createSession();
      await new Promise((r) => setTimeout(r, 5));
      const s2 = await createSession();
      await new Promise((r) => setTimeout(r, 5));
      const s3 = await createSession();
      const list = await listSessions();
      assertEqual(list.length, 3, "应列出 3 个会话");
      assertEqual(list[0]!.id, s3.id, "最新应排第一");
      assertEqual(list[1]!.id, s2.id, "中间应排第二");
      assertEqual(list[2]!.id, s1.id, "最旧应排最后");
    });
  });

  await test("列表项含完整字段（id/title/state/messages）", async () => {
    await withTempWorkspace(async () => {
      await createSession([{ role: "user", content: "完整字段校验" }]);
      const list = await listSessions();
      assertEqual(list.length, 1, "应只有 1 个会话");
      const item = list[0]!;
      assert(typeof item.id === "string", "id 应为 string");
      assert(typeof item.title === "string", "title 应为 string");
      assert(typeof item.createdAt === "number", "createdAt 应为 number");
      assert(typeof item.updatedAt === "number", "updatedAt 应为 number");
      assert(Array.isArray(item.messages), "messages 应为数组");
    });
  });

  await test("删除部分会话后 listSessions 正确反映剩余", async () => {
    await withTempWorkspace(async () => {
      const s1 = await createSession();
      const s2 = await createSession();
      await deleteSession(s1.id);
      const list = await listSessions();
      assertEqual(list.length, 1, "删除后应剩 1 个");
      assertEqual(list[0]!.id, s2.id, "剩余的应为 s2");
    });
  });

  await test("非 .json 文件被忽略（健壮性）", async () => {
    await withTempWorkspace(async () => {
      // 创建一个合法会话
      await createSession();
      // 手动塞一个非 json 文件（模拟目录污染）
      const { writeFile, mkdir } = await import("node:fs/promises");
      await mkdir(".anvil/sessions", { recursive: true });
      await writeFile(".anvil/sessions/README.txt", "garbage", "utf-8");
      const list = await listSessions();
      assertEqual(list.length, 1, "非 .json 文件应被忽略");
    });
  });

  // ============================================================
  // 5. deleteSession —— 删除会话
  // ============================================================
  console.log("\n--- deleteSession ---");

  await test("删除后 loadSession 返回 null", async () => {
    await withTempWorkspace(async () => {
      const s = await createSession();
      await deleteSession(s.id);
      const loaded = await loadSession(s.id);
      assertEqual(loaded, null, "删除后应无法加载");
    });
  });

  await test("删除后文件真实消失", async () => {
    await withTempWorkspace(async () => {
      const s = await createSession();
      const filePath = join(".anvil", "sessions", `${s.id}.json`);
      assert(existsSync(filePath), "删除前文件应存在");
      await deleteSession(s.id);
      assert(!existsSync(filePath), "删除后文件应消失");
    });
  });

  await test("删除不存在的会话抛 ENOENT（rm 未加 force 的真实行为）", async () => {
    await withTempWorkspace(async () => {
      // 源码 deleteSession 使用 rm(path, { recursive: true })，未加 force:true
      // 因此对不存在文件会抛 ENOENT（这是项目当前的真实行为）
      let threw = false;
      try {
        await deleteSession("never-existed");
      } catch (e) {
        threw = true;
        assert(String(e).includes("ENOENT"), "错误应为 ENOENT");
      }
      assert(threw, "删除不存在的会话应抛 ENOENT");
    });
  });

  await test("删除后 listSessions 不再包含它", async () => {
    await withTempWorkspace(async () => {
      const s1 = await createSession();
      const s2 = await createSession();
      await deleteSession(s1.id);
      const list = await listSessions();
      assert(!list.some((s) => s.id === s1.id), "s1 应不在列表");
      assert(list.some((s) => s.id === s2.id), "s2 应仍在列表");
    });
  });

  // ============================================================
  // 6. 端到端：完整生命周期
  // ============================================================
  console.log("\n--- 端到端生命周期 ---");

  await test("创建 → 保存更新 → 加载 → 列表 → 删除 完整流程", async () => {
    await withTempWorkspace(async () => {
      // 1) 创建
      const s = await createSession([{ role: "user", content: "端到端测试任务" }]);
      assertEqual(s.state, "running", "初始 state 应为 running");

      // 2) 模拟对话推进，更新并保存
      await new Promise((r) => setTimeout(r, 5));
      s.messages.push({ role: "assistant", content: "处理中" });
      s.state = "done";
      await saveSession(s);

      // 3) 加载并验证
      const loaded = await loadSession(s.id);
      assert(loaded !== null, "应能加载");
      assertEqual(loaded!.state, "done", "state 应为 done");
      assertEqual(loaded!.messages.length, 2, "messages 应有 2 条");
      assert(loaded!.updatedAt > loaded!.createdAt, "updatedAt 应大于 createdAt");

      // 4) 列表应包含此会话
      const list = await listSessions();
      assert(list.some((x) => x.id === s.id), "列表应含此会话");

      // 5) 删除
      await deleteSession(s.id);
      assertEqual(await loadSession(s.id), null, "删除后应返回 null");
      const listAfter = await listSessions();
      assertEqual(listAfter.length, 0, "删除后列表应为空");
    });
  });
}

try {
  await main();
} catch (e) {
  failed++;
  console.error("\n测试运行异常:", e);
} finally {
  // 兜底恢复 cwd，避免异常导致后续命令在临时目录里执行
  try { process.chdir(originalCwd); } catch {}
}

// ---------- 汇总 ----------
console.log(`\n${"=".repeat(50)}`);
console.log(`passed: ${passed}, failed: ${failed}`);
if (failures.length > 0) {
  console.log("\n失败用例:");
  for (const f of failures) console.log(`  - ${f}`);
}

process.exit(failed > 0 ? 1 : 0);
