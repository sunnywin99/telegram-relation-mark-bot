---
name: telegram-relation-mark-bot
description: Background and feature spec for telegram-relation-mark-bot — a Cloudflare Worker (JavaScript, formerly Python) that lets the user text a Telegram bot one line ("代碼 分類 內容", space-separated, 代碼 being a short code that maps to a full object name) and have it append a row to the matching "對象-分類" tab (using the full name, not the code) of a shared Google Sheet, creating that tab on first use. Records the user's interactions with family/friends (t=太太/1=大女/2=小女/m=我/o=其它). Use when the user references "telegram-relation-mark-bot", 「親友互動記錄」, RelationPeopleMarkbot, asks to continue/resume work on it, or asks what this project is / where it lives.
user-invocable: true
---

# telegram-relation-mark-bot

Base directory for this skill (second desktop's CLI): `C:\claude_practicefiles\.claude\skills\telegram-relation-mark-bot`

## What this is

A small Telegram ↔ Google Sheets bridge: the user texts a dedicated Telegram
bot one line, space-separated — `代碼 分類 內容` (e.g.
`t 沒想到 我竟然沒有想到今天是我太太的生日`). 代碼 is a short code: `t`=太太,
`1`=大女, `2`=小女, `m`=我, `o`=其它 (codes were introduced 2026-08-29 to make
typing faster). The bot maps the code to the full Chinese name, finds (or
creates) a tab named `對象-分類` (always the full name) inside one shared
Google Sheet and appends a row (date/time, content). **The confirmation
reply echoes the short code, not the full name** (`已記錄到「m-沒想到」：...`)
— the user wanted the reply to match what they typed, so the reply and the
tab name (`我-沒想到`) deliberately differ. The distinctive piece is
**dynamic tab management**: tabs aren't pre-created.

- GitHub: https://github.com/sunnywin99/telegram-relation-mark-bot (private)
- **Production: Cloudflare Workers free plan (since 2026-10-26)**,
  `https://telegram-relation-mark-bot.sunnywin99.workers.dev`, connected to
  GitHub via Workers Builds — every push to `master` auto-deploys.
  - Secrets in the Cloudflare dashboard (Worker → 設定 → 變數和機密, "秘密"
    checked): `TELEGRAM_BOT_TOKEN`, `GOOGLE_CLIENT_ID`,
    `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`.
  - Plain vars in `wrangler.toml`: `ALLOWED_TELEGRAM_USER_ID` (`8735906224`),
    `GOOGLE_SPREADSHEET_ID`.
  - `/setup` checks every secret, the Telegram token, the Google refresh
    token and sheet access, then registers the webhook — use it first when
    anything breaks; it reports exactly which value is wrong.
- History: Python + python-telegram-bot long-polling on Render free tier
  (live 2026-08-27, UptimeRobot keep-alive) → Render's 750hr/month pool ran
  out → self-hosted third desktop via Windows Scheduled Task (2026-09) →
  the third desktop died → rewritten as a Cloudflare Worker (2026-10-26),
  same pattern as telegram-heartsutra-bot. Python bot files were removed;
  they're in git history. Render/UptimeRobot are no longer used.
- **Development: Claude Code cloud sessions.**
- Telegram bot: **RelationPeopleMarkbot**, a dedicated bot (not shared).
- Google Sheet: **「親友互動記錄」** in the user's own Google account, id
  `1jgegd-7zTvEwyP14E26jpRTEZ1QPRGljI2iE5RE6MJw`. Tabs named `對象-分類`,
  created on first use with header row `日期時間 / 內容`.
- Changelog: the telegram-relation-mark-bot-history repo and its Artifact
  https://claude.ai/artifact/DDJDYoTWWJLHc1KNV5gdfy —
  authoritative; this file is an orientation summary.

**Always re-read `src/` and run `git log --oneline` before making changes.**

## Architecture

```
Telegram ──webhook POST /telegram──> Worker (src/index.js)
                                       ├─ checks X-Telegram-Bot-Api-Secret-Token
                                       │  (= first 32 hex chars of sha256(bot token))
                                       ├─ checks ALLOWED_TELEGRAM_USER_ID
                                       ├─ parseCommand (src/logic.js): code → full name,
                                       │  sanitizeSheetName("對象-分類")
                                       ├─ POST oauth2.googleapis.com/token (refresh_token grant)
                                       ├─ GET  spreadsheet ?fields=sheets.properties.title
                                       ├─ if tab missing: batchUpdate addSheet + append header row
                                       └─ POST values '{tab}'!A:B:append (RAW, INSERT_ROWS)
```

- `OBJECT_CODES` in `src/logic.js` is an **array** of `[code, name]` pairs,
  not an object — JS objects reorder numeric keys (`1`, `2`) to the front,
  which would scramble the `/help` text.
- No Durable Object / storage — all data lives in the sheet. The webhook
  always answers 200 so Telegram never re-sends (a re-send would duplicate a
  row). `TELEGRAM_API_BASE` / `GOOGLE_OAUTH_BASE` / `SHEETS_API_BASE` exist
  only so local tests can point at a fake server.

## Google Cloud project

Reuses the sibling bots' project `telegram-calendar-bot-504106`, OAuth client
**`relation-mark-bot-desktop`** (Desktop app type). The client secret can't
be re-downloaded after the creation dialog closes.

If the refresh token is expired/revoked, run
`get_refresh_token.py --keep-sheet` on a computer with Python (needs
`credentials.json` for that OAuth client) and paste the new
`GOOGLE_REFRESH_TOKEN` into Cloudflare. Without `--keep-sheet` the script
also creates a brand-new empty spreadsheet — don't switch to that one.
If the OAuth consent screen is still in "Testing", refresh tokens expire
after 7 days; publishing it to "In production" avoids that.

## Working style for this project

Same user as the other Telegram bots — Traditional Chinese only (see
[[feedback_chinese_only]]). Not a developer: give exact click paths, one
step at a time.

## When invoked

1. Check `git log --oneline -10` + skim `src/`.
2. Answer from the fresh info, not blindly from this file.
3. Standing 4-step workflow for changes:
   1. Edit `src/` (a new 對象 goes into `OBJECT_CODES` — pick an unused
      short code; a new 分類 needs no code change). Keep `README.md` and
      `test/` in sync, run `npm test`; for behavior changes,
      `npx wrangler dev` with fake Telegram/Google servers via the `*_BASE`
      vars in `.dev.vars`.
   2. Commit + push to the session's branch, then (with the user's OK)
      fast-forward `master`; Cloudflare auto-deploys.
   3. Add an `ENTRIES` item to telegram-relation-mark-bot-history's
      `index.html` (plain Traditional Chinese), commit/push, republish its
      Artifact: https://claude.ai/artifact/DDJDYoTWWJLHc1KNV5gdfy
   4. Update this `SKILL-backup.md` (commit + push).
