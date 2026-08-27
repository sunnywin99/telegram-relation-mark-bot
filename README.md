# telegram-relation-mark-bot

在 Telegram 傳一行「對象 分類 內容」文字，機器人會自動在 Google 試算表裡
依「對象-分類」找到（或建立）對應的工作表分頁，寫入一列，方便整理跟親友的
互動記錄。

執行環境：Python 3。開發機是第二台桌電（`C:\claude_practicefiles\telegram-relation-mark-bot`），
正式運行是免費部署在 Render 上，24 小時都能收 Telegram 訊息。

---

## 輸入格式

一行文字，用空白分隔三個部分：**對象 分類 內容**，例如：

```
太太 沒想到 我竟然沒有想到今天是我太太的生日
```

- **對象**：目前只接受「太太、大女、小女、我、其它」這 5 個，打錯或不在清單裡
  會收到錯誤提示。以後要新增對象，需要改 `bot.py` 裡的 `OBJECT_WHITELIST`
  這一行，走一次完整六步驟流程重新部署。
- **分類**：完全自由輸入，例如「沒想到」「不舒服」「笑話」。第一次用到某個
  「對象-分類」組合時，機器人會自動在試算表建立同名的工作表分頁（表頭是
  「日期時間 / 內容」）；下次用同樣組合就會接著寫在同一個分頁裡。
- **內容**：分類後面剩下的所有文字都算內容，可以包含空白。

全部的分頁都在同一份 Google 試算表（「親友互動記錄」）裡，不會分散成多份檔案。

---

## 部署步驟

### 1. Google Cloud：申請 Sheets API 憑證

沿用跟 telegram-calendar-bot / telegram-heartsutra-bot 一樣的 Google Cloud
專案，只差建一個新憑證：

1. 到 [Google Cloud Console](https://console.cloud.google.com/) 選你原本的專案。
2. Sheets API 應該已經啟用過了（心經計數機械人那次開的），不用重開。
3. 「API 和服務」→「憑證」→「建立憑證」→「OAuth 用戶端 ID」。
   - 應用程式類型選 **電腦版應用程式**（Desktop app），名稱建議取
     `relation-mark-bot-desktop`，跟其他機械人的憑證分開，方便之後管理。
4. 建好後下載 JSON，改名成 `credentials.json`，放到這個資料夾
   （`C:\claude_practicefiles\telegram-relation-mark-bot\credentials.json`）。
   這個檔案已經在 `.gitignore` 裡，不會被 push 上 GitHub。

### 2. 本機取得 refresh token，並自動建立試算表

在這個資料夾底下開終端機：

```powershell
.\venv\Scripts\python get_refresh_token.py
```

瀏覽器會自動打開，選你要串接的 Google 帳號並同意（如果看到「這個應用程式未經
Google 驗證」的警告，選「進階」→「前往（不安全）」即可繼續）。同意後，這支
腳本會**自動在你自己的 Google 帳號下建立一份新的「親友互動記錄」試算表**
（一開始是空的，工作表分頁由機器人依實際使用自動建立）。

完成後終端機會印出四行：

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
GOOGLE_SPREADSHEET_ID=...
```

把這四行存起來，等一下要設到 Render 的環境變數。**不要提交到 git、不要傳給別人。**

### 3. 建立 GitHub repo 並 push 程式碼

（跟我說一聲，我會照既有工作流程幫你在 GitHub 上建 repo 並 push。）

### 4. Render 部署

1. [Render](https://dashboard.render.com/) 新增 **Web Service**，連到剛建立的 GitHub repo。
2. 設定：
   - **Runtime**: Python 3
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `python bot.py`
   - **Instance Type**: Free
3. 到 Environment 頁籤，加入環境變數：

   | Key | Value |
   |---|---|
   | `TELEGRAM_BOT_TOKEN` | 你的 Telegram bot token（跟 @BotFather 申請的） |
   | `ALLOWED_TELEGRAM_USER_ID` | 你自己的 Telegram user id |
   | `GOOGLE_CLIENT_ID` | 步驟 2 印出來的值 |
   | `GOOGLE_CLIENT_SECRET` | 步驟 2 印出來的值 |
   | `GOOGLE_REFRESH_TOKEN` | 步驟 2 印出來的值 |
   | `GOOGLE_SPREADSHEET_ID` | 步驟 2 印出來的值 |

4. 部署完成後，Render 會給一個網址（例如 `https://xxx.onrender.com`），
   打開應該會看到 `telegram-relation-mark-bot is running`，代表健康檢查端點正常。

### 5. UptimeRobot 保活

Render 免費 Web Service 閒置 15 分鐘沒有 HTTP 請求會自動休眠，休眠後 Telegram
訊息會延遲甚至沒反應，要靠外部服務定期打健康檢查網址保持醒著：

1. 到 [UptimeRobot](https://uptimerobot.com/)（可沿用其他機械人那組帳號）。
2. 新增一個 Monitor，類型選 HTTP(s)，網址填 Render 給你的那個網址，
   檢查間隔選 5 分鐘（免費方案最短間隔）。
3. 存檔即可，之後 UptimeRobot 會自動每 5 分鐘 ping 一次，Render 就不會睡著。

### 6. 測試

在 Telegram 找到你的機器人（`@RelationPeopleMarkbot`），傳 `/start` 應該會
收到使用說明，再傳一行像「太太 沒想到 我竟然沒有想到今天是我太太的生日」，
應該會收到「已記錄到「太太-沒想到」：...」的回覆，並且能在 Google 試算表看到
新建立的「太太-沒想到」分頁跟那一列資料。

---

## 疑難排解

- **機器人完全沒反應**：先確認 Render 的 Logs 頁籤有沒有錯誤訊息；再確認
  UptimeRobot 的 Monitor 狀態是 Up；`ALLOWED_TELEGRAM_USER_ID` 打錯也會讓
  機器人「已讀不回」（其實是回了「沒有權限」，但只回給你以外的人才看得到）。
- **對象打錯字**：機器人會直接回錯誤提示跟目前接受的清單，不會誤建工作表。
- **寫入試算表失敗**：多半是 `GOOGLE_REFRESH_TOKEN` 這組值失效或打錯，
  重新執行一次 `get_refresh_token.py` 取得新的一組再更新 Render 環境變數
  （注意這會建立「另一份」新試算表，記得同步更新 `GOOGLE_SPREADSHEET_ID`，
  或改成手動把新 token 跟舊的 `GOOGLE_SPREADSHEET_ID` 搭配使用）。
- **本機測試**：把環境變數用 PowerShell `$env:` 設定後，
  直接 `.\venv\Scripts\python bot.py` 也能在本機跑（記得先設好 `credentials.json`
  跑過一次 `get_refresh_token.py`）。
