import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommand, sanitizeSheetName, sheetRange, taipeiDateTime, recordedText, USAGE_TEXT } from "../src/logic.js";

test("解析指令", () => {
  assert.deepEqual(parseCommand("/help"), { kind: "help" });
  assert.deepEqual(parseCommand("t 沒想到 我竟然沒有想到 今天是 生日"), {
    kind: "record", code: "t", category: "沒想到", content: "我竟然沒有想到 今天是 生日", sheetName: "太太-沒想到",
  });
  assert.equal(parseCommand("1 笑話 哈哈").sheetName, "大女-笑話");
  assert.equal(parseCommand("m  不舒服   頭痛").content, "頭痛");
  assert.deepEqual(parseCommand("t 沒想到"), { kind: "incomplete" });
  assert.deepEqual(parseCommand(""), { kind: "incomplete" });
  assert.deepEqual(parseCommand("x 分類 內容"), { kind: "bad_code", code: "x" });
  assert.deepEqual(parseCommand("toString 分類 內容"), { kind: "bad_code", code: "toString" });
});

test("分頁名稱與範圍", () => {
  assert.equal(sanitizeSheetName("太太-a/b:c"), "太太-a_b_c");
  assert.equal(sanitizeSheetName("'''"), "未命名");
  assert.equal([...sanitizeSheetName("我-" + "字".repeat(200))].length, 100);
  assert.equal(sheetRange("我-it's", "A:B"), "'我-it''s'!A:B");
});

test("台北時間與回覆", () => {
  assert.equal(taipeiDateTime(Date.parse("2026-10-25T23:30:05Z")), "2026/10/26 07:30:05");
  assert.equal(recordedText("t", "沒想到", "生日"), "已記錄到「t-沒想到」：生日");
  assert.ok(USAGE_TEXT.includes("t=太太、1=大女、2=小女、m=我、o=其它"));
});
