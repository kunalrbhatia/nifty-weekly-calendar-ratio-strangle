# Session Notes — Nifty Weekly Calendar Ratio Strangle Bot

> **Purpose**: This file is a living reference for any AI session.
> When starting a new session, ask the agent to read this file first so it has full context of what has been built, what decisions were made, and what the next steps are.

---

## 1. What This Project Is

An **automated options trading bot** for the Indian market (Angel One SmartAPI) that executes a weekly **calendar ratio strangle** strategy on Nifty 50.

### Strategy Logic

- **T1 (Next weekly expiry)**: Buy 1 lot CE + 1 lot PE at ~500 points OTM (long strangle)
- **T0 (Current weekly expiry)**: Sell 2 lots CE + 2 lots PE at ~half the T1 premium (ratio hedge)
- **Exit**: Monitor via WebSocket; close all legs if Nifty moves ±2% from entry spot, or at 3:20 PM on expiry day
- **Lot size**: 65 (verified from Angel One scrip master as of July 2026)

---

## 2. Tech Stack

| Layer              | Tool                                          |
| ------------------ | --------------------------------------------- |
| Language           | TypeScript (ESM, `tsx` for dev)               |
| Package Manager    | `pnpm`                                        |
| Broker SDK         | `smartapi-javascript` v1.0.10                 |
| Scheduler          | `node-cron`                                   |
| Process Manager    | `pm2` (`ecosystem.config.cjs`)                |
| Testing            | Jest + ts-jest, 100% coverage on core modules |
| Linting/Formatting | ESLint + Prettier                             |
| CI                 | GitHub Actions (`.github/workflows/ci.yml`)   |
| Notifications      | Slack webhook + optional Telegram bot         |

---

## 3. Key Files

```
src/
├── config/env.ts              # Zod-validated env schema
├── helpers/
│   ├── api.ts                 # SmartAPI wrapper (LTP fetch, bulk LTP, margin, retryCall)
│   ├── login.ts               # Broker auth with TOTP via otplib
│   ├── orders.ts              # placeMarketOrder, confirmOrderFill
│   ├── scripMaster.ts         # Download + cache NFO scrip master CSV
│   ├── constants.ts           # defaultLotSize = 65
│   ├── modeManager.ts         # isPaperMode() checks for .paper file
│   ├── holidayCheck.ts        # NSE holiday detection
│   └── websocket.ts           # Live LTP streaming for exit monitoring
├── jobs/
│   ├── entry.ts               # Full strangle entry sequence (Phase A/B/C)
│   ├── monitor.ts             # Position monitoring + exit trigger
│   ├── report.ts              # Daily P&L report generation
│   ├── generateBasket.ts      # Basket preview (dry-run leg report)
│   └── runEntry.ts            # Manual test trigger for entry sequence
├── store/index.ts             # JSON file-based position state (data/position-nifty.json)
├── main.ts                    # Cron scheduling (entry @ 9:45, monitor, close @ 15:20)
└── server.ts                  # Express health check endpoint
```

---

## 4. Environment Configuration

See `.env.example` for the full list. Required keys:

```env
API_KEY=            # Angel One SmartAPI key
CLIENT_CODE=        # Angel One client code
CLIENT_PIN=         # Angel One login PIN
CLIENT_TOTP_PIN=    # TOTP secret key (NOT the 6-digit code — the base32 secret)
```

Optional:

```env
USE_SLACK=true
SLACK_WEBHOOK_URL=
USE_TELEGRAM=false
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

---

## 5. Running the Bot

| Command                    | Purpose                                               |
| -------------------------- | ----------------------------------------------------- |
| `pnpm run dev`             | Dev mode with tsx hot reload                          |
| `pnpm run start`           | Production (runs compiled `dist/main.js`)             |
| `pnpm run test:entry`      | Manually trigger entry sequence once                  |
| `pnpm run generate-basket` | Preview basket legs without placing orders            |
| `pnpm run verify`          | Full check: format + lint + typecheck + tests + build |
| `pnpm run test`            | Jest tests only                                       |
| `pnpm run build`           | Compile TypeScript to `dist/`                         |

### Paper Mode (Mock Trading)

Create a `.paper` file in the project root to activate mock mode:

```bash
echo "paper" > .paper
```

- Login uses mock credentials
- Orders are logged as `[PAPER]` without hitting the exchange
- Nifty LTP falls back to `24500` if real API fails
- Delete the `.paper` file to return to live mode

---

## 6. Important Implementation Decisions

### SmartAPI SDK Quirks (Critical)

- After `generateSession()`, you **must** call `api.setAccessToken(jwtToken)` — the SDK will not attach auth to subsequent calls otherwise
- `getLtpData` does **not exist** on the SDK — use `api.marketData({ mode: 'LTP', exchangeTokens: { NSE: ['99926000'] } })`
- `api.getMarketData()` is used for bulk NFO option chain LTP fetches
- Nifty 50 spot index token on NSE is `99926000`

### Scrip Master Expiry Format

- Angel One scrip master uses `DDMMMYYYY` format (e.g. `04AUG2026`)
- Single-digit days **must be zero-padded** — use `.padStart(2, '0')`
- This fix exists in both `src/jobs/entry.ts` and `src/jobs/generateBasket.ts`

### `confirmOrderFill` Behaviour

- Polls the order book up to 3 times (1.5s delay between retries)
- Throws if order is still `open/pending` — this is intentional and correct
- Outside market hours, placed orders remain `open` — the bot must only run during market hours (9:15 AM – 3:30 PM IST)

### Lot Size

- Default lot size is `65` (as of July 2026 Nifty weekly contracts)
- Defined in `src/helpers/constants.ts` as `defaultLotSize`
- The scrip master validation checks this against the live scrip master and alerts if there is a mismatch

---

## 7. Workflow and Git Rules

- **Never push directly to `master`** — always raise a PR via the `gh-pr-workflow` skill
- **Always squash and merge**: `gh pr merge <N> --squash` (ensures a clean, linear commit history on `master`)
- **Linear History**: Maintain a 1-to-1 linear commit log on `master` without merge commits
- **PR descriptions**: All file paths, commands, and code snippets must use backticks
- **After merging**: Run the `git-cleanup-sync` skill to switch back to master and delete the local branch

### Skills Available (in `.agents/skills/`)

- `gh-pr-workflow` — creates branch, commits, pushes, raises PR
- `git-cleanup-sync` — switches to master, pulls, deletes merged branches
- `pr-description-check` — validates PR body formatting (backtick rule)
- `verify-pr-status` — polls GitHub CI checks until pass/fail
- `readme-auto-update` — ensures README reflects code changes

---

## 8. Production Deployment

- **Process manager**: `pm2` with `ecosystem.config.cjs`
- **Entry point**: `dist/main.js` (compiled output)
- **Cron schedules** (IST / Asia/Kolkata):
  - `9:45 AM` — Download scrip master + run entry sequence
  - Every minute during market hours — Monitor open positions
  - `3:20 PM` — Force close all open legs
  - `3:40 PM` — Generate and send daily P&L report
- **Scrip master cache**: Stored in `data/scrip-master.json`, downloaded fresh each morning

### Server Setup Checklist

- [ ] Copy `.env` with live credentials
- [ ] Whitelist server static IP in Angel One SmartAPI app settings
- [ ] `pnpm install`
- [ ] `pnpm run build`
- [ ] `pm2 start ecosystem.config.cjs`
- [ ] `pm2 logs` to monitor

---

## 9. Known Issues / Limitations

| Issue                                  | Status          | Notes                                                               |
| -------------------------------------- | --------------- | ------------------------------------------------------------------- |
| Angel One IP whitelist required        | Working         | Must whitelist server IP in SmartAPI dashboard                      |
| Bot only runs during market hours      | By design       | Cron schedule enforces this                                         |
| Order confirmation fails outside hours | By design       | Correctly rejects `open/pending` status                             |
| ESLint unused-var warnings (24 total)  | Non-blocking    | All are minor (unused imports, `err` in catch blocks). Zero errors. |
| Margin API fallback                    | Alert-triggered | If `getRMS` fails, uses Rs 200,000 fallback with alert              |

---

## 10. What Was Done in This Session (July 31, 2026)

1. Fixed `pr-description-check` regex to support dot-prefixed paths
2. Added workspace rules enforcing PR workflow (`.agent/rules/pr-rules.md`)
3. Updated `.gitignore` to exclude all image files
4. Fixed `defaultLotSize` to `65` in constants and updated test mocks
5. Built `src/jobs/generateBasket.ts` — basket preview script
6. Built `src/jobs/runEntry.ts` — manual live entry trigger
7. Fixed `formatScripExpiry()` to pad single-digit days in both `entry.ts` and `generateBasket.ts`
8. Fixed SmartAPI SDK usage in `api.ts`:
   - Made `setSession` async and added `api.setAccessToken(jwtToken)` call after login
   - Replaced non-existent `getLtpData` with correct `api.marketData()` call
9. Created `.env.example` template
10. Successfully tested live entry — real orders were placed on Angel One exchange
11. Merged all changes via squash PRs (#3 through #6)

---

## 11. Next Steps

- [ ] Deploy to a VPS/server
- [ ] Whitelist server static IP in Angel One SmartAPI dashboard
- [ ] Run `pnpm run start` (or `pm2 start`) during market hours
- [ ] Monitor logs and share with agent for debugging/analysis
- [ ] Potentially hook up Telegram notifications for real-time trade alerts
