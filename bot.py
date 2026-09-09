"""
主程式：Telegram 長輪詢，收到「對象 分類 內容」格式的一行文字，
自動在 Google 試算表裡找（或建立）對應的「對象-分類」工作表分頁，寫入一列。
Render 免費方案保活用的健康檢查網址也在這裡。

環境變數（Render 的 Environment 頁籤設定，或本機/自架伺服器同資料夾的 .env 檔，見 .env.example）：
    TELEGRAM_BOT_TOKEN        跟 @BotFather 申請的 token
    ALLOWED_TELEGRAM_USER_ID  只允許這個 Telegram user id 的訊息被記錄（防止別人亂用）
    GOOGLE_CLIENT_ID          get_refresh_token.py 印出來的值
    GOOGLE_CLIENT_SECRET      get_refresh_token.py 印出來的值
    GOOGLE_REFRESH_TOKEN      get_refresh_token.py 印出來的值
    GOOGLE_SPREADSHEET_ID     get_refresh_token.py 印出來的試算表 ID
    PORT                      Render 會自動設定；自架伺服器同時跑多個 bot 時要各自設不同埠號
"""
import logging
import os
import re
import threading
from datetime import datetime
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from flask import Flask
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from telegram import Update
from telegram.ext import Application, ContextTypes, MessageHandler, filters

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
ALLOWED_TELEGRAM_USER_ID = int(os.environ["ALLOWED_TELEGRAM_USER_ID"])
GOOGLE_CLIENT_ID = os.environ["GOOGLE_CLIENT_ID"]
GOOGLE_CLIENT_SECRET = os.environ["GOOGLE_CLIENT_SECRET"]
GOOGLE_REFRESH_TOKEN = os.environ["GOOGLE_REFRESH_TOKEN"]
GOOGLE_SPREADSHEET_ID = os.environ["GOOGLE_SPREADSHEET_ID"]
PORT = int(os.environ.get("PORT", "8080"))

TIMEZONE = ZoneInfo("Asia/Taipei")
SHEETS_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

# 對象輸入用短代碼，但試算表分頁名稱仍用完整中文名。以後要新增對象，
# 改這個對照表、commit/push、確認 Render 重新部署即可（六步驟流程的一部分），
# 不需要改其他邏輯。
OBJECT_CODE_MAP = {
    "t": "太太",
    "1": "大女",
    "2": "小女",
    "m": "我",
    "o": "其它",
}

HEADER_ROW = ["日期時間", "內容"]

USAGE_TEXT = (
    "傳一行文字給我，格式是「代碼 分類 內容」，中間用空白分開，例如：\n"
    "t 沒想到 我竟然沒有想到今天是我太太的生日\n\n"
    "對象代碼目前只接受：" +
    "、".join(f"{code}={name}" for code, name in OBJECT_CODE_MAP.items()) +
    "\n分類可以自由輸入（例如「不舒服」「笑話」），我會自動在試算表建立對應的工作表分頁。"
)

# Google 試算表分頁名稱不能包含這些字元，也不能超過 100 字
_INVALID_SHEET_NAME_CHARS = re.compile(r"[:\\/?*\[\]]")


def _sanitize_sheet_name(name: str) -> str:
    name = _INVALID_SHEET_NAME_CHARS.sub("_", name).strip("'")
    return name[:100] if name else "未命名"


def _get_sheets_service():
    creds = Credentials(
        token=None,
        refresh_token=GOOGLE_REFRESH_TOKEN,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        scopes=SHEETS_SCOPES,
    )
    creds.refresh(GoogleAuthRequest())
    return build("sheets", "v4", credentials=creds, cache_discovery=False)


def _ensure_sheet_exists(service, sheet_name: str):
    meta = (
        service.spreadsheets()
        .get(spreadsheetId=GOOGLE_SPREADSHEET_ID, fields="sheets.properties.title")
        .execute()
    )
    existing_titles = {s["properties"]["title"] for s in meta.get("sheets", [])}
    if sheet_name in existing_titles:
        return

    service.spreadsheets().batchUpdate(
        spreadsheetId=GOOGLE_SPREADSHEET_ID,
        body={"requests": [{"addSheet": {"properties": {"title": sheet_name}}}]},
    ).execute()
    service.spreadsheets().values().append(
        spreadsheetId=GOOGLE_SPREADSHEET_ID,
        range=f"'{sheet_name}'!A:B",
        valueInputOption="RAW",
        insertDataOption="INSERT_ROWS",
        body={"values": [HEADER_ROW]},
    ).execute()
    logger.info("新建工作表分頁：%s", sheet_name)


def _append_row(service, sheet_name: str, content: str):
    now_str = datetime.now(TIMEZONE).strftime("%Y/%m/%d %H:%M:%S")
    service.spreadsheets().values().append(
        spreadsheetId=GOOGLE_SPREADSHEET_ID,
        range=f"'{sheet_name}'!A:B",
        valueInputOption="RAW",
        insertDataOption="INSERT_ROWS",
        body={"values": [[now_str, content]]},
    ).execute()


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    if user is None or user.id != ALLOWED_TELEGRAM_USER_ID:
        await update.message.reply_text("這個機器人只服務特定使用者，你沒有權限使用。")
        logger.warning("拒絕未授權使用者 %s 的訊息", user.id if user else "unknown")
        return

    text = (update.message.text or "").strip()

    if text in ("/start", "/help"):
        await update.message.reply_text(USAGE_TEXT)
        return

    parts = text.split(maxsplit=2)
    if len(parts) < 3:
        await update.message.reply_text("格式不對，少了代碼、分類或內容。\n\n" + USAGE_TEXT)
        return

    code, category, content = parts
    obj = OBJECT_CODE_MAP.get(code)
    if obj is None:
        await update.message.reply_text(
            f"「{code}」不是有效的對象代碼。\n\n" + USAGE_TEXT
        )
        return

    sheet_name = _sanitize_sheet_name(f"{obj}-{category}")

    try:
        service = _get_sheets_service()
        _ensure_sheet_exists(service, sheet_name)
        _append_row(service, sheet_name, content)
    except Exception:
        logger.exception("寫入 Google 試算表失敗")
        await update.message.reply_text("寫入 Google 試算表時發生錯誤，稍後再試一次。")
        return

    await update.message.reply_text(f"已記錄到「{code}-{category}」：{content}")


def _run_health_check_server():
    app = Flask(__name__)

    @app.route("/")
    def index():
        return "telegram-relation-mark-bot is running"

    app.run(host="0.0.0.0", port=PORT)


def main():
    threading.Thread(target=_run_health_check_server, daemon=True).start()

    application = Application.builder().token(TELEGRAM_BOT_TOKEN).build()
    application.add_handler(MessageHandler(filters.TEXT, handle_message))

    logger.info("機器人啟動，開始長輪詢...")
    application.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
