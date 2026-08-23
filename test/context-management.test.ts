import type { ChatMessage } from "../src/config.ts";
import { estimateTokens, estimateMessagesTokens } from "../src/agent/tokens.ts";
import { clipToolOutput, truncate, DEFAULT_CTX } from "../src/agent/context.ts";

// ---------- 极简测试框架（与 tool-system.test.ts 保持一致） ----------
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

// ---------- 1. estimateTokens ----------
console.log("\n--- estimateTokens ---");

await test("空字符串返回 0 token", async () => {
  assertEqual(estimateTokens(""), 0, "空文本应为 0 tokens");
});

await test("普通英文文本 token 数合理（gpt-tokenizer）", async () => {
  // "hello world" 通常被编码为 2 tokens
  const n = estimateTokens("hello world");
  assert(n >= 1 && n <= 10, `token 数应在合理范围，实际: ${n}`);
});

await test("中文文本 token 数不为 0", async () => {
  const n = estimateTokens("你好世界，这是一个测试文本");
  assert(n > 0, `中文应有 token，实际: ${n}`);
});

await test("更长文本 token 数更大", async () => {
  const short = estimateTokens("a");
  const long = estimateTokens("a".repeat(1000));
  assert(long > short, `长文本 token(${long}) 应大于短文本(${short})`);
});

// ---------- 2. estimateMessagesTokens ----------
console.log("\n--- estimateMessagesTokens ---");

await test("空消息数组仍有基础开销（3 tokens）", async () => {
  const n = estimateMessagesTokens([]);
  assertEqual(n, 3, "空数组应为 reduce 初始 0 + 最后 +3");
});

await test("单条消息估算 > 纯文本估算", async () => {
  const text = "hello";
  const pure = estimateTokens(text);
  const withMsg = estimateMessagesTokens([{ content: text }]);
  // 每条消息 +3，最后整体再 +3 → 共多 6
  assertEqual(withMsg, pure + 3 + 3, "单条消息开销不匹配");
});

await test("多条消息 token 递增正确", async () => {
  const one = estimateMessagesTokens([{ content: "a" }]);
  const two = estimateMessagesTokens([{ content: "a" }, { content: "b" }]);
  const three = estimateMessagesTokens([{ content: "a" }, { content: "b" }, { content: "c" }]);
  assert(two > one, "两条消息应大于一条");
  assert(three > two, "三条消息应大于两条");
});

// ---------- 3. clipToolOutput ----------
console.log("\n--- clipToolOutput ---");

await test("行数小于 maxLines 时原样返回", async () => {
  const text = "line1\nline2\nline3";
  assertEqual(clipToolOutput(text, 10), text, "短文本不应被修改");
});

await test("行数等于 maxLines 时原样返回", async () => {
  const text = Array.from({ length: 5 }, (_, i) => `L${i + 1}`).join("\n");
  assertEqual(clipToolOutput(text, 5), text, "刚好等于上限不应被修改");
});

await test("超过 maxLines 时保留头+尾并插入省略标记", async () => {
  const lines = Array.from({ length: 10 }, (_, i) => `L${i + 1}`); // L1..L10
  const text = lines.join("\n");
  const clipped = clipToolOutput(text, 4); // maxLines=4, 头2 + 尾2
  assert(clipped.includes("L1"), "应包含头行 L1");
  assert(clipped.includes("L2"), "应包含头行 L2");
  assert(clipped.includes("L9"), "应包含尾行 L9");
  assert(clipped.includes("L10"), "应包含尾行 L10");
  assert(!clipped.includes("L5"), "不应包含中间行 L5");
  assert(clipped.includes("[...省略 6 行...]"), "省略标记行数应为 10-4=6");
});

await test("奇数 maxLines 时裁剪行为合理", async () => {
  const lines = Array.from({ length: 100 }, (_, i) => `L${i + 1}`);
  const text = lines.join("\n");
  const clipped = clipToolOutput(text, 5); // maxLines=5 → 头2 + 尾2
  const resultLines = clipped.split("\n");
  // 至少有省略标记行
  assert(clipped.includes("[...省略"), "应有省略标记");
  // 行数不应显著超过 maxLines + 1（省略行）
  assert(resultLines.length <= 6, `裁剪后行数应合理，实际: ${resultLines.length}`);
});

await test("空字符串返回空", async () => {
  assertEqual(clipToolOutput("", 10), "", "空字符串保持空");
});

await test("单行长文本不被 clipToolOutput 裁剪（按行计数）", async () => {
  const oneLine = "a".repeat(5000);
  assertEqual(clipToolOutput(oneLine, 200), oneLine, "单行文本不应被按行裁剪影响");
});

// ---------- 4. truncate ----------
console.log("\n--- truncate ---");

await test("消息在预算内时 compressed=false，原封不动返回", async () => {
  const messages: ChatMessage[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
  ];
  const result = await truncate(messages, DEFAULT_CTX);
  assertEqual(result.compressed, false, "预算内不应触发压缩");
  assertEqual(result.messages.length, messages.length, "消息数量应一致");
  assertEqual(result.messages[0].content, "sys", "system 消息应保留");
});

await test("预算极小时触发压缩，compressed=true", async () => {
  const messages: ChatMessage[] = [
    { role: "system", content: "SYSTEM_PROMPT " + "S".repeat(200) },
    { role: "user", content: "msg1 very long text to consume tokens " + "x".repeat(500) },
    { role: "assistant", content: "reply1 " + "y".repeat(500) },
    { role: "user", content: "msg2 " + "a".repeat(300) },
    { role: "assistant", content: "reply2 " + "b".repeat(300) },
  ];
  const totalTokens = estimateMessagesTokens(messages);
  const tightCfg = { maxTokens: Math.floor(totalTokens / 3), reservedTokens: 0 };
  let summarizeCalled = false;
  const result = await truncate(messages, tightCfg, async (old) => {
    summarizeCalled = true;
    return `摘要: 共 ${old.length} 条旧消息`;
  });
  assertEqual(result.compressed, true, "超预算 compressed 应为 true");
  assert(summarizeCalled, "有旧消息时应调用 summarize 回调");
  // 第一条仍为 system
  assertEqual(result.messages[0].role, "system", "首条应为原 system 消息");
  // 应插入历史摘要 system 消息
  const hasSummary = result.messages.some(
    (m) => m.role === "system" && m.content.startsWith("[历史摘要]"),
  );
  assert(hasSummary, "应存在 [历史摘要] system 消息");
  // 所有保留下来的非 system 消息，都必须是原消息中靠后的几条（验证从末尾往前取）
  const originalNonSystem = messages.slice(1);
  const keptNonSystem = result.messages.filter((m) => !m.content.startsWith("[历史摘要]") && m.role !== "system");
  if (keptNonSystem.length > 0) {
    const firstKeptIdx = originalNonSystem.findIndex((om) => om.content === keptNonSystem[0].content);
    assert(firstKeptIdx >= 0, "保留的消息必须来自原消息");
    // keptNonSystem 的顺序应当是原数组从 firstKeptIdx 开始的尾部
    for (let k = 0; k < keptNonSystem.length; k++) {
      assertEqual(
        keptNonSystem[k].content,
        originalNonSystem[firstKeptIdx + k].content,
        `保留的第 ${k} 条应与原数组第 ${firstKeptIdx + k} 条一致`,
      );
    }
    // 且应包含最后一条或几条最新消息（末尾匹配）
    const lastKept = keptNonSystem[keptNonSystem.length - 1];
    const lastOriginal = originalNonSystem[originalNonSystem.length - 1];
    const secondLastOriginal = originalNonSystem[originalNonSystem.length - 2];
    assert(
      lastKept.content === lastOriginal.content || lastKept.content === secondLastOriginal?.content,
      "保留的末尾必须是原数组最后 1-2 条最新消息之一",
    );
  }
});

await test("无旧消息时（全保留）不调用 summarize，compressed=false", async () => {
  const messages: ChatMessage[] = [
    { role: "user", content: "hi" },
  ];
  let summarizeCalled = false;
  const result = await truncate(messages, DEFAULT_CTX, async () => {
    summarizeCalled = true;
    return "summary";
  });
  assertEqual(result.compressed, false, "全保留时 compressed=false");
  assert(!summarizeCalled, "无旧消息不应调用 summarize");
});

await test("即使触发压缩，原 system 消息仍在首位", async () => {
  const sysContent = "MY_SYSTEM_V1_" + "z".repeat(50);
  const messages: ChatMessage[] = [
    { role: "system", content: sysContent },
    { role: "user", content: "u1 " + "x".repeat(300) },
    { role: "assistant", content: "a1 " + "y".repeat(300) },
    { role: "user", content: "u2 " + "m".repeat(50) },
  ];
  const tightCfg = { maxTokens: 250, reservedTokens: 0 };
  const result = await truncate(messages, tightCfg, async (old) => {
    return `摘要(${old.length}条)`;
  });
  assertEqual(result.messages[0].role, "system", "首条角色仍为 system");
  assertEqual(result.messages[0].content, sysContent, "首条内容应为原 system");
});

await test("没有原 system 消息时也能正常工作", async () => {
  const messages: ChatMessage[] = [
    { role: "user", content: "u1 " + "x".repeat(800) },
    { role: "assistant", content: "a1 " + "y".repeat(800) },
    { role: "user", content: "u2 latest short msg" },
  ];
  const totalTokens = estimateMessagesTokens(messages);
  const tightCfg = { maxTokens: Math.floor(totalTokens / 4), reservedTokens: 0 };
  const result = await truncate(messages, tightCfg, async (old) => {
    return `压缩了${old.length}条`;
  });
  assertEqual(result.compressed, true, "超预算应压缩");
  // 末尾应保留最新用户消息
  const last = result.messages[result.messages.length - 1];
  assert(last.content.includes("u2 latest short msg"), "末尾应保留最新消息");
});

await test("压缩后 token 数应显著小于原 token 数", async () => {
  const manyMsg: ChatMessage[] = [
    { role: "system", content: "sys " + "s".repeat(50) },
  ];
  for (let i = 0; i < 30; i++) {
    manyMsg.push({ role: "user", content: `user-round-${i} ${("u" + i).repeat(80)}` });
    manyMsg.push({ role: "assistant", content: `assist-round-${i} ${("a" + i).repeat(80)}` });
  }
  const before = estimateMessagesTokens(manyMsg);
  const tightCfg = { maxTokens: Math.floor(before / 3), reservedTokens: 0 };
  const result = await truncate(manyMsg, tightCfg, async (old) => {
    return `摘要共${old.length}条历史消息，含多轮读写操作结论`;
  });
  const after = estimateMessagesTokens(result.messages);
  assert(result.compressed, "应已压缩");
  assert(after < before, `压缩后(${after})应小于压缩前(${before})`);
  assert(after <= tightCfg.maxTokens + 50, `压缩后(${after})应接近预算(${tightCfg.maxTokens})`);
});

// ---------- 汇总 ----------
console.log(`\n${"=".repeat(50)}`);
console.log(`passed: ${passed}, failed: ${failed}`);
if (failures.length > 0) {
  console.log("\n失败用例:");
  for (const f of failures) console.log(`  - ${f}`);
}

process.exit(failed > 0 ? 1 : 0);
