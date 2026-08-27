---
name: telegram-relation-mark-bot
description: Background and feature spec for telegram-relation-mark-bot — a Python service that lets the user text a Telegram bot one line ("對象 分類 內容", space-separated) and have it append a row to the matching "對象-分類" tab of a shared Google Sheet, creating that tab on first use. Records the user's interactions with family/friends (太太/大女/小女/我/其它). Use when the user references "telegram-relation-mark-bot", 「親友互動記錄」, RelationPeopleMarkbot, asks to continue/resume work on it, or asks what this project is / where it lives.
user-invocable: true
---

# telegram-relation-mark-bot

Base directory for this skill: `C:\claude_practicefiles\.claude\skills\telegram-relation-mark-bot`

## What this is

A small Python backend that bridges Telegram and Google Sheets: the user
texts a dedicated Telegram bot one line, space-separated —
`對象 分類 內容` (e.g. `太太 沒想到 我竟然沒有想到今天是我太太的生日`) — and
the bot finds (or creates) a tab named `對象-分類` inside one shared Google
Sheet and appends a row (date/time, content). This is the sibling project to
[[project_telegram_calendar_bot]] and [[project_telegram_heartsutra_bot]] —
same architecture pattern (Telegram long polling + Render + a Google OAuth
Desktop client), but the distinctive piece here is **dynamic tab
management**: tabs aren't pre-created, the bot decides on the fly whether a
new one is needed.

- Local repo: `C:\claude_practicefiles\telegram-relation-mark-bot` (git,
  `master` branch)
- GitHub: https://github.com/sunnywin99/telegram-relation-mark-bot (private)
- `gh` (GitHub CLI) is already authenticated on this machine under account
  `sunnywin99` — same account as [[project_trade_calc]].
- Deploy target: **Render free Web Service** (not a Claude Artifact — this
  is a Python backend). **Deployed and live as of 2026-08-27**:
  `https://telegram-relation-mark-bot.onrender.com` (service id
  `srv-da7r54psrm7s73dbs5r0`, region Oregon). Kept alive on the free tier
  via an UptimeRobot HTTP(s) monitor hitting the Flask health-check route
  (`/`) every 5 minutes, same account/pattern as the sibling bots' monitors.
- Development happens on 第二台桌電 — see [[machine_setup]].
- Telegram bot: **RelationPeopleMarkbot**, a fresh dedicated bot created via
  @BotFather specifically for this project (per the user's established
  per-project-gets-its-own-bot pattern).
- Google Sheet: **「親友互動記錄」**, created automatically by
  `get_refresh_token.py` under the user's own Google account — id
  `1jgegd-7zTvEwyP14E26jpRTEZ1QPRGljI2iE5RE6MJw`. Starts empty; tabs are
  named `對象-分類` and created on first use, each with header row
  `日期時間 / 內容`.
- For the full chronological build history (translated to plain Traditional
  Chinese), see [[project_telegram_relation_mark_bot_history]] / the
  telegram-relation-mark-bot-history Artifact — that's the authoritative
  changelog, this file is just an orientation summary.

**Always re-read `bot.py` and run `git log --oneline` in the repo before
making changes** — this file is a snapshot as of commit `6ec553c`
(2026-08-27) and the code may have moved on since.

## Message format and design decisions

- One line, space-separated: `text.split(maxsplit=2)` → `對象`, `分類`,
  `內容` (內容 keeps everything after the second space, including any
  further spaces).
- **對象 is a fixed whitelist** hardcoded as `OBJECT_WHITELIST` in `bot.py`
  (currently `太太`, `大女`, `小女`, `我`, `其它`) — the user said this list
  will probably grow later but should stay a deliberate code change (part of
  the standing 6-step workflow), not free text. A message with an
  unrecognized 對象 is rejected with an error reply and nothing is written.
- **分類 is fully free text** — the user explicitly chose this
  ("完全自由輸入（推薦）") over having to pre-register categories. The bot
  never validates it; the tab name `對象-分類` is sanitized
  (`_sanitize_sheet_name` strips characters Google Sheets tab names forbid:
  `: \ / ? * [ ]`, truncates to 100 chars) and created via
  `spreadsheets().batchUpdate` + `addSheet` the first time that exact
  combination appears, then reused on every later message with the same
  combination.
- All tabs live in **one shared spreadsheet** — the user was explicit about
  this ("全都放在同一個excel之中"), not one file per person or category.

## Architecture

```
Telegram user ──("對象 分類 內容", space-separated)──> bot.py (long polling, python-telegram-bot)
                                                            │
                                                            ├─ split into 對象/分類/內容
                                                            ├─ 對象 in OBJECT_WHITELIST? no → reply error, stop
                                                            ├─ sheet_name = sanitize("對象-分類")
                                                            ├─ sheet_name in spreadsheet already? no → batchUpdate addSheet + write header row
                                                            └─ Google Sheets API (googleapiclient)
                                                                 spreadsheets().values().append() on sheet_name!A:B
```

`bot.py` also runs a tiny Flask app (`/` → "telegram-relation-mark-bot is
running") in a background thread purely so Render's free Web Service tier
has an HTTP endpoint to consider "alive" — the actual bot logic is 100%
Telegram long polling, no webhook.

### Environment variables (set in Render's dashboard, never committed)

| Key | Purpose |
|---|---|
| `TELEGRAM_BOT_TOKEN` | RelationPeopleMarkbot's token from @BotFather |
| `ALLOWED_TELEGRAM_USER_ID` | Only this Telegram user id may record entries (`8735906224`, same account as the sibling bots — get via @userinfobot) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` | From `get_refresh_token.py`'s one-time local OAuth run |
| `GOOGLE_SPREADSHEET_ID` | Printed by the same one-time script, which also creates the sheet |
| `PORT` | Set automatically by Render |

`credentials.json` (the OAuth client credentials) is git-ignored — it only
ever exists locally, never in the repo. This session's client secret was
never actually downloaded as a file: the Google Cloud Console dialog's
values were transcribed directly into `credentials.json` by hand (same
workaround [[project_telegram_heartsutra_bot]] used when the download
destination across machines was ambiguous).

## Google Cloud project

Reuses the **same** Google Cloud project as the sibling bots,
`telegram-calendar-bot-504106` — Sheets API was already enabled. This
project added its own OAuth client, **`relation-mark-bot-desktop`** (Desktop
app type). Same "can't re-download the client secret after the creation
dialog closes" constraint as the other bots.

`get_refresh_token.py` in this project, like heartsutra-bot's, does **two
things** in one run: obtains the refresh token **and** immediately creates
the new spreadsheet under the same authorization (just the bare spreadsheet,
no pre-made tabs — tabs are created lazily by `bot.py` itself). Re-running
this script to rotate a lost/expired refresh token will therefore also
create a **second, empty** spreadsheet — the sensible recovery move is to
manually swap the new `GOOGLE_REFRESH_TOKEN` in but keep the original
`GOOGLE_SPREADSHEET_ID` (don't blindly use whatever new spreadsheet id gets
printed), so accumulated tabs aren't split across two files.

## Working style for this project

Same user as [[project_trade_calc]] and the other Telegram bots — expect
Traditional Chinese only (see [[feedback_chinese_only]]). Same
external-service setup pattern: Google Cloud console clicks, Render account,
UptimeRobot account, Telegram bot creation via @BotFather — flag clearly
which steps need the user's own hands (account logins, clicking "Allow" on
OAuth consent) versus which Claude can do directly (code, git, `gh`, browser
automation on consoles once a browser session is already logged in — see
[[machine_setup]]). UptimeRobot's own dashboard (`dashboard.uptimerobot.com`)
is known to hang under claude-in-chrome automation — the user set that step
up manually, same as the sibling bots.

## When invoked

1. Confirm the repo is still at
   `C:\claude_practicefiles\telegram-relation-mark-bot` and check
   `git log --oneline -10` + skim `bot.py` to see what's changed since this
   doc was written.
2. Summarize current state / answer the user's question using the fresh
   info, not blindly from this file.
3. If asked to continue development, every change follows the same
   **standing 6-step workflow** (see
   [[feedback_telegram_relation_mark_bot_workflow]], mirroring the sibling
   bots' workflow):
   1. Edit the code (`bot.py`/`get_refresh_token.py`/`README.md`) — a new
      對象 goes into `OBJECT_WHITELIST` here; a new 分類 needs no code change
      at all, the user just starts using it in Telegram.
   2. `git commit` + `git push` (telegram-relation-mark-bot repo).
   3. Confirm Render picked up the new commit and redeployed cleanly (check
      the Render dashboard's Deploy/Logs tab) — pushing to GitHub does not
      by itself mean the live bot is running the new code.
   4. Add a new `ENTRIES` item to telegram-relation-mark-bot-history's
      `index.html` (translated to plain Traditional Chinese), then
      commit/push/republish that repo's Artifact.
   5. Update this skill file (`SKILL.md`) with whatever changed, and sync
      `SKILL-backup.md` in the telegram-relation-mark-bot repo (commit+push)
      so the disaster-recovery backup copy doesn't drift.
   6. Update memory (`[[project_telegram_relation_mark_bot]]` and any other
      relevant memory file) with what changed and why.
