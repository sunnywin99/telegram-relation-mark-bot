# telegram-relation-mark-bot

在 Telegram 傳一行「對象 分類 內容」文字，機器人會自動在 Google 試算表裡
依「對象-分類」找到（或建立）對應的工作表分頁，寫入一列，方便整理跟親友的
互動記錄。

執行環境：**Cloudflare Workers 免費方案**（JavaScript），不需要任何一台電腦一直開著。
push 到 GitHub 的 `master` 後，Cloudflare 會自動部署新版本。

---

## 輸入格式

一行文字，用空白分隔三個部分：**代碼 分類 內容**，例如：

```
t 沒想到 我竟然沒有想到今天是我太太的生日
```

- **代碼**：目前只接受 `t`=太太、`1`=大女、`2`=小女、`m`=我、`o`=其它 這 5 個，
  打錯或不在清單裡會收到錯誤提示。試算表分頁名稱仍然用完整中文名（例如上面
  例子會寫進「太太-沒想到」分頁），只有 Telegram 輸入改用短代碼。以後要新增
  對象，改 `src/logic.js` 裡的 `OBJECT_CODES` 對照表，合併到 `master` 就會自動部署。
- **分類**：完全自由輸入，例如「沒想到」「不舒服」「笑話」。第一次用到某個
  「對象-分類」組合時，機器人會自動在試算表建立同名的工作表分頁（表頭是
  「日期時間 / 內容」）；下次用同樣組合就會接著寫在同一個分頁裡。
- **內容**：分類後面剩下的所有文字都算內容，可以包含空白。

全部的分頁都在同一份 Google 試算表（「親友互動記錄」）裡，不會分散成多份檔案。

---

## 運作方式

- Telegram 收到訊息時呼叫 Worker 的 `POST /telegram`（webhook）。
- Worker 用 Google 的 refresh token 換 access token，再直接呼叫 Google Sheets API：
  分頁不存在就先建立（含表頭），再寫入一列。所有資料都在試算表裡，Worker 本身不存任何東西。
- 程式：`src/index.js`（Worker）、`src/logic.js`（代碼對照、指令解析、分頁名稱）。測試：`npm test`。

## 第一次設定（只需要做一次）

1. 登入 [Cloudflare](https://dash.cloudflare.com/)，左邊選單「運算」→「Workers 和 Pages」→「建立」→
   **Continue with GitHub**，選 `sunnywin99/telegram-relation-mark-bot`，專案名稱保持
   `telegram-relation-mark-bot`，其他用預設值，按「部署」。
2. 到 Worker 的「設定」→「變數和機密」→「新增變數」，下面四個都要**勾「秘密」**，
   最後按「新增變數並部署」：

   | 金鑰 | 值 |
   |---|---|
   | `TELEGRAM_BOT_TOKEN` | 這個 bot（RelationPeopleMarkbot）的 Telegram token |
   | `GOOGLE_CLIENT_ID` | 原本 Render／`.env` 裡那組 |
   | `GOOGLE_CLIENT_SECRET` | 同上 |
   | `GOOGLE_REFRESH_TOKEN` | 同上 |

3. 打開 `https://telegram-relation-mark-bot.sunnywin99.workers.dev/setup`。它會逐項檢查
   Token、Google 授權、試算表，全部正常就向 Telegram 註冊 webhook。
4. 在 Telegram 傳 `/help` 確認，再實際記一筆試試。

`ALLOWED_TELEGRAM_USER_ID`、`GOOGLE_SPREADSHEET_ID` 寫在 `wrangler.toml` 的 `[vars]`，不是機密。

## 之後改程式

改好 push（或合併）到 `master`，Cloudflare 會自動重新部署。
Worker 頁面的「部署」看有沒有成功，「Observability」看執行記錄。

## Google 授權失效時：重新申請 refresh token

`/setup` 顯示「Google 授權失敗：Token has been expired or revoked」之類的訊息，
就要重新申請一組 refresh token。需要一台有 Python 的電腦：

1. 到 [Google Cloud Console](https://console.cloud.google.com/) 原本的專案，
   「API 和服務」→「憑證」，下載這個 bot 的 OAuth 用戶端（電腦版應用程式）JSON，
   改名成 `credentials.json` 放在 repo 資料夾。
2. 建好 venv 並 `pip install -r requirements.txt`，執行：

   ```powershell
   .\venv\Scripts\python get_refresh_token.py --keep-sheet
   ```

   `--keep-sheet` 表示沿用原本的試算表，不另外建新的。瀏覽器會打開，選 Google 帳號並同意。
3. 把印出來的 `GOOGLE_REFRESH_TOKEN`（以及 CLIENT_ID／CLIENT_SECRET，如果有變）更新到 Cloudflare，
   再打開一次 `/setup`。

**避免 7 天就失效**：Google Cloud 的 OAuth 同意畫面如果還是「測試中」，refresh token 7 天後就會失效。
到「API 和服務」→「OAuth 同意畫面」（或「目標對象」）按 **發布應用程式**，改成「實際運作中」。
自己用的話不需要送 Google 審查，登入時會看到「未經驗證」的警告，選「進階」→「前往」即可。

## 疑難排解

- **機器人完全沒反應**：重新打開一次 `/setup` 看它說什麼。
  `ALLOWED_TELEGRAM_USER_ID` 打錯的話，機器人會回「沒有權限」。
- **本機測試**：`npm install` 後建立 `.dev.vars`（寫上面四個值），執行 `npx wrangler dev`。
  注意本機的 `/setup` 會把 webhook 指到本機網址，測完要再打開一次正式 Worker 的 `/setup`。
- **舊版**：2026-10 以前是 Python 版（`bot.py`，跑在 Render、後來自架桌電），可以在 git 歷史找到。
