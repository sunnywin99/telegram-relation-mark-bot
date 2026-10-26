/**
 * Cloudflare Worker 版的親友互動記錄機器人：傳「代碼 分類 內容」，自動在 Google 試算表
 * 找（或建立）對應的「對象-分類」工作表分頁，寫入一列。
 *
 * Telegram 有新訊息時呼叫 POST /telegram（webhook）。沒有排程、也不需要另外存狀態，
 * 所有資料都在 Google 試算表裡。
 *
 * 設定（Cloudflare 後台 → Worker → 設定 → 變數和機密，類型都勾「秘密」）：
 *   TELEGRAM_BOT_TOKEN      跟 @BotFather 申請的 token
 *   GOOGLE_CLIENT_ID        get_refresh_token.py 印出來的值（原本 Render／.env 裡那組）
 *   GOOGLE_CLIENT_SECRET    同上
 *   GOOGLE_REFRESH_TOKEN    同上
 * 寫在 wrangler.toml 的 [vars]：
 *   ALLOWED_TELEGRAM_USER_ID  只處理這個 Telegram user id 的訊息
 *   GOOGLE_SPREADSHEET_ID     「親友互動記錄」試算表的 ID
 *
 * 第一次部署、填好上面的值之後，打開 https://<worker 網址>/setup，
 * 會逐項檢查設定，並向 Telegram 註冊 webhook。
 */
import { HEADER_ROW, USAGE_TEXT, parseCommand, recordedText, sheetRange, taipeiDateTime } from "./logic.js";

const REQUIRED_SECRETS = [
  "TELEGRAM_BOT_TOKEN",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN",
  "GOOGLE_SPREADSHEET_ID",
];

// 下面三個 *_BASE 只在本機測試時用來指向假的伺服器
const telegramBase = (env) => env.TELEGRAM_API_BASE || "https://api.telegram.org";
const oauthBase = (env) => env.GOOGLE_OAUTH_BASE || "https://oauth2.googleapis.com";
const sheetsBase = (env) => env.SHEETS_API_BASE || "https://sheets.googleapis.com";

async function webhookSecret(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function telegram(env, method, body) {
  const res = await fetch(`${telegramBase(env)}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
  if (!data.ok) console.error(`Telegram ${method} 失敗：${data.description}`);
  return data;
}

function sendMessage(env, chatId, text) {
  return telegram(env, "sendMessage", { chat_id: chatId, text });
}

/** 用 refresh token 換一個短效的 access token */
async function googleAccessToken(env) {
  const res = await fetch(`${oauthBase(env)}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Google 授權失敗：${data.error_description || data.error || `HTTP ${res.status}`}`);
  }
  return data.access_token;
}

async function sheetsRequest(env, accessToken, path, init = {}) {
  const url = `${sheetsBase(env)}/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SPREADSHEET_ID)}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google 試算表錯誤：${data.error?.message || `HTTP ${res.status}`}`);
  return data;
}

async function sheetTitles(env, accessToken) {
  const meta = await sheetsRequest(env, accessToken, "?fields=sheets.properties.title");
  return (meta.sheets || []).map((s) => s.properties.title);
}

async function appendRow(env, accessToken, sheetName, row) {
  const range = encodeURIComponent(sheetRange(sheetName, "A:B"));
  await sheetsRequest(env, accessToken, `/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    body: JSON.stringify({ values: [row] }),
  });
}

/** 分頁不存在就建一個新的，並寫入表頭 */
async function ensureSheetExists(env, accessToken, sheetName) {
  if ((await sheetTitles(env, accessToken)).includes(sheetName)) return;
  await sheetsRequest(env, accessToken, ":batchUpdate", {
    method: "POST",
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: sheetName } } }] }),
  });
  await appendRow(env, accessToken, sheetName, HEADER_ROW);
  console.log(`新建工作表分頁：${sheetName}`);
}

/** 處理一則文字訊息，回傳要回覆的文字 */
async function handleText(env, text) {
  const cmd = parseCommand(text);
  if (cmd.kind === "help") return USAGE_TEXT;
  if (cmd.kind === "incomplete") return "格式不對，少了代碼、分類或內容。\n\n" + USAGE_TEXT;
  if (cmd.kind === "bad_code") return `「${cmd.code}」不是有效的對象代碼。\n\n` + USAGE_TEXT;

  try {
    const accessToken = await googleAccessToken(env);
    await ensureSheetExists(env, accessToken, cmd.sheetName);
    await appendRow(env, accessToken, cmd.sheetName, [taipeiDateTime(), cmd.content]);
  } catch (err) {
    console.error("寫入 Google 試算表失敗", err);
    return "寫入 Google 試算表時發生錯誤，稍後再試一次。";
  }
  return recordedText(cmd.code, cmd.category, cmd.content);
}

async function handleUpdate(update, env) {
  const message = update.message;
  if (!message || typeof message.text !== "string") return; // 只處理文字訊息
  const userId = message.from?.id;
  if (userId !== Number(env.ALLOWED_TELEGRAM_USER_ID)) {
    console.warn(`拒絕未授權使用者 ${userId ?? "unknown"} 的訊息`);
    await sendMessage(env, message.chat.id, "這個機器人只服務特定使用者，你沒有權限使用。");
    return;
  }
  await sendMessage(env, message.chat.id, await handleText(env, message.text));
}

async function setup(url, env) {
  const missing = REQUIRED_SECRETS.filter((k) => !env[k]);
  if (missing.length) {
    return `還沒設定：${missing.join("、")}\n請到 Cloudflare 後台這個 Worker 的「設定 → 變數和機密」新增（勾選「秘密」），存檔後再打開這個網址一次。`;
  }
  const me = await telegram(env, "getMe", {});
  if (!me.ok) return `Bot Token 無效（${me.description}），請確認 TELEGRAM_BOT_TOKEN 有沒有貼錯。`;

  let titles;
  try {
    titles = await sheetTitles(env, await googleAccessToken(env));
  } catch (err) {
    return `${err.message}\n請確認 GOOGLE_CLIENT_ID／GOOGLE_CLIENT_SECRET／GOOGLE_REFRESH_TOKEN 有沒有貼錯。`;
  }

  const hook = `${url.origin}/telegram`;
  const res = await telegram(env, "setWebhook", {
    url: hook,
    secret_token: await webhookSecret(env.TELEGRAM_BOT_TOKEN),
    allowed_updates: ["message"],
  });
  if (!res.ok) return `向 Telegram 註冊 webhook 失敗：${res.description}`;
  return `設定完成！@${me.result.username} 現在由這個 Worker 處理訊息（${hook}）。\nGoogle 試算表連線正常，目前有 ${titles.length} 個分頁。傳 /help 給機器人試試看。`;
}

const textResponse = (body, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/telegram" && request.method === "POST") {
      const expected = await webhookSecret(env.TELEGRAM_BOT_TOKEN || "");
      if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== expected) {
        return textResponse("forbidden", 403);
      }
      const update = await request.json().catch(() => null);
      // 一律回 200，避免 Telegram 因為錯誤一直重送同一則訊息（重送會重複記錄）
      if (update) {
        try {
          await handleUpdate(update, env);
        } catch (err) {
          console.error("處理訊息失敗", err);
        }
      }
      return textResponse("ok");
    }

    if (url.pathname === "/setup") return textResponse(await setup(url, env));

    return textResponse("telegram-relation-mark-bot is running");
  },
};
