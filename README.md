# Nifty Weekly Calendar Ratio Strangle Bot

Automated options trading bot designed for the Indian equity derivatives market (NFO) using **Angel One SmartAPI**. The bot systematically plans, executes, and monitors a weekly **Calendar Ratio Strangle** strategy on Nifty 50.

---

## 📈 Strategy Overview

The **Weekly Calendar Ratio Strangle** is a neutral-to-rangebound options structure engineered to capture time-decay ($\theta$) while providing built-in tail-risk protection through next-weekly long options.

### Option Structure & Modes

The strategy supports two operational modes via the `MODE` environment variable (`MODE=1` or `MODE=2`):

| Expiry Leg                     | Option Type    | Ratio / Lots       | Mode 1 Strike Selection                                                            | Mode 2 Strike Selection                                        |
| :----------------------------- | :------------- | :----------------- | :--------------------------------------------------------------------------------- | :------------------------------------------------------------- |
| **T1** (Next Weekly Expiry)    | Buy 1 Lot CE   | **1 Lot** (Long)   | ~500 points OTM from Nifty spot, rounded to nearest 100 strike                     | ~500 points OTM from Nifty spot, rounded to nearest 100 strike |
| **T1** (Next Weekly Expiry)    | Buy 1 Lot PE   | **1 Lot** (Long)   | ~500 points OTM from Nifty spot, rounded to nearest 100 strike                     | ~500 points OTM from Nifty spot, rounded to nearest 100 strike |
| **T0** (Current Weekly Expiry) | Sell 2 Lots CE | **2 Lots** (Short) | 100-multiple strike with premium ≥ ~50% of T1 CE premium (closest match to target) | **Exact same strike** as T1 CE (`longCEStrike`)                |
| **T0** (Current Weekly Expiry) | Sell 2 Lots PE | **2 Lots** (Short) | 100-multiple strike with premium ≥ ~50% of T1 PE premium (closest match to target) | **Exact same strike** as T1 PE (`longPEStrike`)                |

> **Lot Size**: `65` (Verified dynamically against live Angel One Scrip Master).

### 📝 Algorithmic Execution Example

To clarify the strategy's operation, consider this concrete example:

1. **Spot Price Identification**:
   At Wednesday `09:45 AM IST`, the Nifty 50 Index spot price is at **24,500**.
2. **Phase A — Long Legs (T1)**:
   - The bot calculates OTM strikes at $\pm 500$ points from spot:
     - **T1 Call strike**: $24,500 + 500 = 25,000$
     - **T1 Put strike**: $24,500 - 500 = 24,000$
   - Market orders execute to **BUY** 1 lot of `25000 CE` (at say ₹80) and 1 lot of `24000 PE` (at say ₹60).
3. **Phase B — Short Legs (T0)**:
   - The bot targets short premiums equal to $50\%$ of the corresponding T1 fill premium:
     - **Target Call Premium**: $₹80 \times 0.50 = ₹40$
     - **Target Put Premium**: $₹60 \times 0.50 = ₹30$
   - It queries the T0 option chain and selects strikes closest to these targets (e.g., `24800 CE` at ₹42 and `24200 PE` at ₹28).
   - Market orders execute to **SELL** 2 lots of `24800 CE` and 2 lots of `24200 PE`.
4. **State Persistence**:
   All order execution details are recorded to `data/position-nifty.json`, and the bot transitions to WebSocket streaming mode to monitor exit rules.

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
  2. Query option chain for T0 weekly options to select strikes closest to target premium. Candidates are restricted to **100-multiple strikes** within ±1500 points of spot, and only strikes with **premium ≥ target** are eligible (guarantees the short hedge collects at least half the long premium). On ties, the farther OTM strike is preferred.
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

### 📊 Daily Analysis & Reporting

- **Daily Schedule**: Every trading day at **03:40 PM IST**, the bot runs `src/jobs/report.ts` to execute its daily analysis.
- **Reporting Metrics**: The script computes:
  - Realized P&L for closed legs and active Mark-to-Market (MTM) calculations.
  - Execution summary logs and telemetry data.
- **Channels**: The final report output is formatted and sent instantly to Slack or Telegram (based on configured channel webhooks).

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

## 🚀 Getting Started & Deployment Guide

This repository is fully open-source. You can fork this repository to customize the strike selection logic, exit rules, or sizing for your own trading preferences.

### 🍴 Fork and Clone

1. **Fork this repository** to your personal GitHub account by clicking the **Fork** button at the top right of this page.
2. **Clone your fork** to your local environment or virtual private server (VPS):
   ```bash
   git clone https://github.com/YOUR_USERNAME/nifty-weekly-calendar-ratio-strangle.git
   cd nifty-weekly-calendar-ratio-strangle
   ```

### 1. Prerequisites

- Node.js 18+ and `pnpm` installed on your machine.
- Angel One SmartAPI Developer Account with credentials (`API Key`, `Client Code`, `PIN`, and `TOTP Secret`).

### 2. Installation

Install project dependencies:

```bash
pnpm install
```

### 3. Environment Setup

Copy the example environment configuration and supply your broker credentials:

```bash
cp .env.example .env
```

Open `.env` and fill in the required variables:

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

# Strategy Parameter Overrides (optional)
MODE=1
EXIT_THRESHOLD_PCT=2
WORTHLESS_LTP_THRESHOLD=5
TRADE_CLOSE_HOUR=15
TRADE_CLOSE_MINUTE=20
REPORT_HOUR=15
REPORT_MINUTE=40
```

### 4. Testing with Paper Trading Mode

Before putting real capital at risk, it is highly recommended to run the bot in Paper Trading (Mock Execution) mode.

1. Activate paper trading by creating a `.paper` file in the root directory:
   ```bash
   echo "paper" > .paper
   ```
2. In paper trading mode, no live orders are sent to the exchange. You can run dry runs safely.
3. Remove the `.paper` file to switch back to live execution mode:
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
| `pnpm run backtest`        | Run backtest engine over historical snapshots (both modes)        |
| `pnpm run backtest:mode1`  | Run backtest engine for Mode 1 (½-premium ratio) only             |
| `pnpm run backtest:mode2`  | Run backtest engine for Mode 2 (same-strike calendar) only        |
| `pnpm run backtest:charts` | Generate performance comparison charts via Python matplotlib      |
| `pnpm run test:entry`      | Manually execute entry sequence once                              |
| `pnpm run verify`          | Full quality check (`prettier`, `eslint`, `tsc`, `jest`, `build`) |
| `pnpm run test`            | Run Jest unit tests                                               |

---

## 📊 Backtesting Engine

The repository includes a deterministic backtest engine in `backtest/` that replays historical option chain snapshots stored in the sibling repository `nifty-optionchain-data` (`data/chains/`).

### Key Capabilities & Rules

- **Production Logic Parity**: Uses exact strike selection rules from `src/jobs/entry.ts` and exit rules from `src/jobs/monitor.ts`.
- **Gap Handling**: Reads `data/manifest.json` gaps and skips any cycle with missing data (`SKIPPED_INCOMPLETE_DATA`).
- **Modes**: Replays Wed-Tue cycles for both **Mode 1 (½-premium ratio)** and **Mode 2 (same-strike calendar)** side-by-side.
- **Metrics**: Computes P&L, Win Rate, Profit Factor, Expectancy, Max Drawdown, Sharpe Ratio, P(Breach Loss), Whipsaw Rate, and Expiry Bleed Rate.
- **Reports**: Generates `backtest/reports/comparison_report.md`, per-mode CSV files (`mode1_cycles.csv`, `mode2_cycles.csv`), and equity curve charts.

### CLI Usage

```bash
# Run backtest for both modes over full data lake
pnpm backtest

# Custom flags
pnpm backtest --mode 1 --from 2026-05-01 --to 2026-07-31 --margin 180000
```

---

## 🏭 Production Deployment

For continuous 24/7 hosting (e.g., on an AWS EC2 instance, DigitalOcean Droplet, or local server), we recommend running the bot with **PM2** process manager to handle restarts and logging automatically.

### Detailed Deployment Steps:

1. **Prepare Node environment**: Make sure Node 18+ and `pnpm` are installed globally.
2. **Build the project**: Compile the TypeScript source code:
   ```bash
   pnpm run build
   ```
3. **Start the Process**: Deploy and manage the bot lifecycle using PM2:
   ```bash
   pm2 start ecosystem.config.cjs
   ```
4. **Monitor Logs**: Monitor the live trading logs and check status:
   ```bash
   pm2 logs nifty-weekly-calendar-ratio-strangle
   pm2 status
   ```
5. **Ensure Persistence**: Configure PM2 to start automatically on system reboot:
   ```bash
   pm2 startup
   pm2 save
   ```

### 🤖 Automated CI/CD Deployment with GitHub Actions

If you fork this repository, you can enable auto-deployment to your production server via the included GitHub Actions workflow (`.github/workflows/deploy.yml`).

Whenever the `CI` workflow completes successfully on the `master` branch, the `Deploy` workflow triggers an SSH connection to your server, pulls the latest changes, builds the project, and restarts the PM2 process.

To configure this, add the following **GitHub Repository Secrets** in your fork (`Settings > Secrets and variables > Actions`):

| Secret Key              | Description                                                                            | Example                                  |
| :---------------------- | :------------------------------------------------------------------------------------- | :--------------------------------------- |
| `ORACLE_HOST`           | Host IP address or domain name of your production server                               | `123.45.67.89`                           |
| `ORACLE_USER`           | SSH username on your production server                                                 | `ubuntu`                                 |
| `ORACLE_SSH_KEY`        | Private SSH key used to authenticate with your server                                  | `-----BEGIN OPENSSH PRIVATE KEY-----...` |
| `ORACLE_SSH_PASSPHRASE` | Passphrase of your private SSH key (leave blank or omit if your key has no passphrase) | `my_ssh_key_passphrase`                  |

---

## 🤝 Contributing

This is an **open-source** repository. We welcome contributions of all forms, including bug fixes, performance optimizations, strategy enhancements, or better logging features.

To contribute:

1. Fork the project.
2. Create your feature branch (`git checkout -b feature/AmazingFeature`).
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`).
4. Push to the branch (`git push origin feature/AmazingFeature`).
5. Open a Pull Request for review.

---

## 🛡️ License

MIT License. Designed for quantitative strategy automation and educational purposes. Use at your own risk.
