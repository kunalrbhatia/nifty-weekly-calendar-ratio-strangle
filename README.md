# Nifty Weekly Calendar Ratio Strangle Bot

Automated options trading bot designed for the Indian equity derivatives market (NFO) using **Angel One SmartAPI**. The bot systematically plans, executes, and monitors a weekly **Calendar Ratio Strangle** strategy on Nifty 50.

---

## 📈 Strategy Overview

The **Weekly Calendar Ratio Strangle** is a neutral-to-rangebound options structure engineered to capture time-decay ($\theta$) while providing built-in tail-risk protection through next-weekly long options.

```
                   ▲ P&L
                   │
            ───────┼───────  Max Profit Range
           /       │       \
          /        │        \
  ───────┼─────────┼─────────┼───────  Break-even points
        /          │          \
       /           │           \
                                 ▼
```

### Option Structure

| Expiry Leg                     | Option Type    | Ratio / Lots       | Strike Selection Method                                        |
| :----------------------------- | :------------- | :----------------- | :------------------------------------------------------------- |
| **T1** (Next Weekly Expiry)    | Buy 1 Lot CE   | **1 Lot** (Long)   | ~500 points OTM from Nifty spot, rounded to nearest 100 strike |
| **T1** (Next Weekly Expiry)    | Buy 1 Lot PE   | **1 Lot** (Long)   | ~500 points OTM from Nifty spot, rounded to nearest 100 strike |
| **T0** (Current Weekly Expiry) | Sell 2 Lots CE | **2 Lots** (Short) | Strike matching ~50% of T1 CE premium (target ratio hedge)     |
| **T0** (Current Weekly Expiry) | Sell 2 Lots PE | **2 Lots** (Short) | Strike matching ~50% of T0 PE premium (target ratio hedge)     |

> **Lot Size**: `65` (Verified dynamically against live Angel One Scrip Master).

---

## ⚙️ Entry & Exit Rules

### 🚀 Entry Plan

- **Execution Schedule**: `09:45 AM IST` **strictly on Wednesday** (or next trading day if Wednesday is a holiday).
- **Phase A — Long Protection (T1)**:
  1. Fetch live Nifty 50 Index spot LTP (Token: `99926000`).
  2. Compute candidate strikes: `Spot + 500` (CE) & `Spot - 500` (PE), rounded to nearest 100.
  3. Execute market BUY order for 1 Lot T1 CE & 1 Lot T1 PE. Confirm fills via order book retry mechanism.
- **Phase B — Short Ratio Hedge (T0)**:
  1. Target premium = `T1 Fill Premium / 2`.
  2. Query option chain for T0 weekly options to select strikes closest to target premium.
  3. Execute market SELL order for 2 Lots T0 CE & 2 Lots T0 PE. Confirm fills via order book retry mechanism.
- **Phase C — State & Stream Initialization**:
  1. Record filled leg details (tokens, prices, quantities, symbols) into local position store (`data/position-nifty.json`).
  2. Connect to Angel One WebSocket to stream real-time tick updates for spot and open leg option contracts.

### 🚪 Exit Plan & Risk Rules

1. **Spot Movement Limit (±2%)**:
   - Monitored continuously via live WebSocket ticks.
   - If Nifty spot moves $\ge 2\%$ up or down from entry spot, an emergency exit is triggered.
   - Order sequence: BUY to close short legs (T0), then SELL to close long legs (T1).
2. **Expiry Day Time Exit (Tuesday at 03:15 PM IST)**:
   - On Tuesday (`15:15 IST`), the bot automatically wind-downs and exits open position legs.
3. **Worthless Option Filter (Premium > ₹5)**:
   - Only options with premium $> ₹5$ (`WORTHLESS_LTP_THRESHOLD`) are squared off on exit. Options with premium $\le ₹5$ are marked `EXPIRED_UNBOOKED` and allowed to expire unbooked to avoid unnecessary slippage.
4. **Safety Switches**:
   - `.kill` file presence: Soft pauses entry without closing existing positions.
   - `.panic` file presence: Triggers immediate market exit for all open legs and stops execution.

---

## 🛠️ Architecture & Tech Stack

```
nifty-weekly-calendar-ratio-strangle/
├── src/
│   ├── config/env.ts          # Environment schema validation using Zod
│   ├── helpers/
│   │   ├── api.ts             # SmartAPI wrapper (LTP, option chain, market data)
│   │   ├── login.ts           # Broker auth & TOTP generation (otplib)
│   │   ├── scripMaster.ts     # Download, cache & query NFO Scrip Master CSV
│   │   ├── orders.ts          # Market order execution & fill confirmation
│   │   ├── websocket.ts       # Real-time LTP tick streaming
│   │   └── modeManager.ts     # Paper mode & kill/panic switch handlers
│   ├── jobs/
│   │   ├── entry.ts           # 3-phase entry execution sequence
│   │   ├── monitor.ts         # Real-time position tracking & exit triggers
│   │   ├── report.ts          # End-of-day P&L report generation
│   │   ├── generateBasket.ts  # Dry-run basket preview generator
│   │   └── runEntry.ts        # Manual entry trigger for testing
│   ├── store/index.ts         # Persistent JSON file storage for position state
│   ├── main.ts                # Master cron scheduler & process lifecycle
│   └── server.ts              # Express HTTP health check server
├── ecosystem.config.cjs       # PM2 production process configuration
└── SESSION_NOTES.md           # Session documentation & operational notes
```

- **Runtime**: Node.js ESM with TypeScript.
- **Broker SDK**: `smartapi-javascript` v1.0.10.
- **Process Manager**: PM2.
- **Testing & Quality**: Jest (100% core coverage), ESLint, Prettier.
- **Alerting**: Webhook notifications (Slack / Telegram).

---

## 🚀 Getting Started

### 1. Prerequisites

- Node.js 18+ and `pnpm`.
- Angel One SmartAPI Developer Account (`API Key`, `Client Code`, `PIN`, `TOTP Secret`).

### 2. Installation

```bash
git clone https://github.com/kunalrbhatia/nifty-weekly-calendar-ratio-strangle.git
cd nifty-weekly-calendar-ratio-strangle
pnpm install
```

### 3. Environment Setup

Copy `.env.example` to `.env` and fill in credentials:

```bash
cp .env.example .env
```

```env
API_KEY=your_api_key
CLIENT_CODE=your_client_code
CLIENT_PIN=your_4_digit_pin
CLIENT_TOTP_PIN=your_base32_totp_secret

USE_SLACK=false
SLACK_WEBHOOK_URL=https://hooks.slack.com/...

USE_TELEGRAM=false
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

### 4. Modes of Operation

#### 📝 Paper Trading Mode (Mock Execution)

Activate mock trading by creating a `.paper` file in the root directory:

```bash
echo "paper" > .paper
```

In Paper Mode:

- No real orders hit the exchange.
- Market data falls back cleanly if APIs are unaccessible outside market hours.

Remove `.paper` to return to live mode:

```bash
rm .paper
```

---

## 📜 Available Scripts

| Command                    | Description                                                       |
| :------------------------- | :---------------------------------------------------------------- |
| `pnpm run dev`             | Run bot in dev mode with hot reloading (`tsx`)                    |
| `pnpm run build`           | Compile TypeScript into `dist/`                                   |
| `pnpm run start`           | Run compiled production build (`dist/src/main.js`)                |
| `pnpm run show-pnl`        | Display high-visibility ASCII P&L banner from MTM log files       |
| `pnpm run generate-basket` | Dry-run preview of strangle legs without placing orders           |
| `pnpm run test:entry`      | Manually execute entry sequence once                              |
| `pnpm run verify`          | Full quality check (`prettier`, `eslint`, `tsc`, `jest`, `build`) |
| `pnpm run test`            | Run Jest unit tests                                               |

---

## 🏭 Production Deployment with PM2

Start the bot using PM2:

```bash
pnpm run build
pm2 start ecosystem.config.cjs
```

View live logs and process status:

```bash
pm2 logs nifty-weekly-calendar-ratio-strangle
pm2 status
```

---

## 🛡️ License

MIT License. Designed for quantitative strategy automation and educational purposes. Use at your own risk.
