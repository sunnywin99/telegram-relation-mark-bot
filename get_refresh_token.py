"""
一次性小工具：在本機（第二台桌電）跑這支腳本。做兩件事：
    1. 用瀏覽器登入 Google 帳號授權一次，拿到可以長期使用的 refresh token，
       之後部署到 Render 時把它設成環境變數即可，Render 上的機器人不需要
       再開瀏覽器登入。
    2. 用這組授權，在你自己的 Google 帳號下建立一份全新的「親友互動記錄」
       試算表，並印出它的 ID。這份試算表一開始是空的，之後機器人收到訊息
       時會自動依「對象-分類」建立工作表分頁，不需要在這裡預先建好。

使用方式：
    1. 到 Google Cloud Console 建立 OAuth 用戶端 ID（類型選「電腦版應用程式」），
       下載 JSON，存成這個資料夾底下的 credentials.json（README 有詳細步驟）。
    2. 執行： .\\venv\\Scripts\\python get_refresh_token.py
    3. 瀏覽器會自動打開，選你要串接的 Google 帳號、按同意。
    4. 終端機會印出四個值，都要設到 Cloudflare Worker 的秘密：
       GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN /
       GOOGLE_SPREADSHEET_ID

只是授權失效、要重新拿 refresh token 時，加上 --keep-sheet：
    .\\venv\\Scripts\\python get_refresh_token.py --keep-sheet
就不會另外建一份新試算表，繼續用原本的 GOOGLE_SPREADSHEET_ID。
"""
import sys

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
SHEET_TITLE = "親友互動記錄"


def _create_spreadsheet(creds: Credentials) -> str:
    service = build("sheets", "v4", credentials=creds, cache_discovery=False)
    spreadsheet = (
        service.spreadsheets()
        .create(body={"properties": {"title": SHEET_TITLE}}, fields="spreadsheetId,spreadsheetUrl")
        .execute()
    )
    spreadsheet_id = spreadsheet["spreadsheetId"]
    print(f"已建立試算表：{spreadsheet['spreadsheetUrl']}")
    return spreadsheet_id


def main():
    flow = InstalledAppFlow.from_client_secrets_file("credentials.json", SCOPES)
    creds = flow.run_local_server(port=0)

    keep_sheet = "--keep-sheet" in sys.argv[1:]
    spreadsheet_id = None if keep_sheet else _create_spreadsheet(creds)

    print("\n授權成功！請把以下值設成 Cloudflare Worker 的秘密（勾選「秘密」）：\n")
    print(f"GOOGLE_CLIENT_ID={creds.client_id}")
    print(f"GOOGLE_CLIENT_SECRET={creds.client_secret}")
    print(f"GOOGLE_REFRESH_TOKEN={creds.refresh_token}")
    if spreadsheet_id:
        print(f"GOOGLE_SPREADSHEET_ID={spreadsheet_id}")
    else:
        print("（沿用原本的 GOOGLE_SPREADSHEET_ID，不用改）")
    print("\n前三個值等同於你 Google 帳號的鑰匙，請勿分享給別人或提交到 git。")


if __name__ == "__main__":
    main()
