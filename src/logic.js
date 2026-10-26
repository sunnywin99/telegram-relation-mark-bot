// 不碰網路的純邏輯：對象代碼、指令解析、分頁名稱、台北時間。
// 抽出來是為了能用 node --test 直接測（test/logic.test.js）。

const TZ_OFFSET_MS = 8 * 60 * 60 * 1000; // Asia/Taipei，沒有日光節約

// 對象輸入用短代碼，但試算表分頁名稱仍用完整中文名。以後要新增對象，
// 改這個對照表、commit/push、合併到 master 即可（Cloudflare 會自動部署），
// 不需要改其他邏輯。
// （用陣列而不是物件，因為 JS 物件會把數字鍵 1、2 排到最前面，說明文字順序就亂了）
export const OBJECT_CODES = [
  ["t", "太太"],
  ["1", "大女"],
  ["2", "小女"],
  ["m", "我"],
  ["o", "其它"],
];
const OBJECT_CODE_MAP = new Map(OBJECT_CODES);

export const HEADER_ROW = ["日期時間", "內容"];

export const USAGE_TEXT =
  "傳一行文字給我，格式是「代碼 分類 內容」，中間用空白分開，例如：\n" +
  "t 沒想到 我竟然沒有想到今天是我太太的生日\n\n" +
  "對象代碼目前只接受：" +
  OBJECT_CODES.map(([code, name]) => `${code}=${name}`).join("、") +
  "\n分類可以自由輸入（例如「不舒服」「笑話」），我會自動在試算表建立對應的工作表分頁。";

/**
 * 解析訊息，跟 Python 版 handle_message 判斷順序一樣：
 *   help / incomplete / bad_code / record
 */
export function parseCommand(rawText) {
  const text = (rawText || "").trim();
  if (text === "/start" || text === "/help") return { kind: "help" };
  // 等同 Python 的 text.split(maxsplit=2)：前兩段是代碼、分類，剩下全部是內容
  const m = text.match(/^(\S+)\s+(\S+)\s+([\s\S]+)$/);
  if (!m) return { kind: "incomplete" };
  const [, code, category, content] = m;
  const obj = OBJECT_CODE_MAP.get(code);
  if (obj === undefined) return { kind: "bad_code", code };
  return { kind: "record", code, category, content, sheetName: sanitizeSheetName(`${obj}-${category}`) };
}

/** Google 試算表分頁名稱不能包含 : \ / ? * [ ]，也不能超過 100 字 */
export function sanitizeSheetName(name) {
  let s = name.replace(/[:\\/?*[\]]/g, "_").replace(/^'+|'+$/g, "");
  s = [...s].slice(0, 100).join("");
  return s || "未命名";
}

/** 分頁名稱放進 A1 範圍要用單引號包起來，名稱裡的單引號要寫兩次 */
export function sheetRange(sheetName, cols) {
  return `'${sheetName.replace(/'/g, "''")}'!${cols}`;
}

const pad = (n) => String(n).padStart(2, "0");

/** 台北時間 "YYYY/MM/DD HH:MM:SS" */
export function taipeiDateTime(ms = Date.now()) {
  const d = new Date(ms + TZ_OFFSET_MS);
  return (
    `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

export function recordedText(code, category, content) {
  return `已記錄到「${code}-${category}」：${content}`;
}
