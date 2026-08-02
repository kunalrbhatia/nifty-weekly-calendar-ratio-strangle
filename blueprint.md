# Algo Trading Strategy Blueprint

_A reusable blueprint for building expiry/options/equity trading algos on Angel One SmartAPI. Section 1 documents the current strategy (Nifty Weekly Calendar Ratio Strangle). Section 2 is a strategy-agnostic checklist of hard-won engineering rules — carry these into any new strategy built from this blueprint, before writing strategy-specific logic._

---

## 1. Current Strategy — Nifty Weekly Calendar Ratio Strangle (Carryforward)

### Overview

**NIFTY only** for now (SENSEX is a planned later expansion — do not implement until explicitly enabled). **Carryforward** style: positions may be held overnight and across multiple sessions; this is **not** an intraday square-off strategy. Scheduled **entry at 09:45 AM IST every Wednesday** (or the next valid trading day if Wednesday is a holiday — search forward, not backward). Uses Angel One SmartAPI; all date/time logic is `Asia/Kolkata`-anchored via `Intl.DateTimeFormat` (see §2.5).

Nifty weekly index options expire on **Tuesday**. At entry time, resolve two expiries:

- **Current expiry (T0):** the nearest upcoming Nifty weekly expiry (typically the following Tuesday when entering on Wednesday).
- **Next expiry (T1):** the Nifty weekly expiry exactly **one calendar week after T0** (not “the next Tuesday after today” in isolation — always T0 + 7 days on the weekly expiry chain).

### Position structure (4 legs after full entry)

The strategy supports two operational modes via environment variable `MODE`:

| Leg      | Expiry | Side | Qty    | Strike selection (Mode 1: `MODE=1`)                  | Strike selection (Mode 2: `MODE=2`)              |
| -------- | ------ | ---- | ------ | ---------------------------------------------------- | ------------------------------------------------ |
| Long CE  | T1     | BUY  | 1 lot  | `round_to_nearest_100(Nifty_LTP + 500)`              | `round_to_nearest_100(Nifty_LTP + 500)`          |
| Long PE  | T1     | BUY  | 1 lot  | `round_to_nearest_100(Nifty_LTP − 500)`              | `round_to_nearest_100(Nifty_LTP − 500)`          |
| Short CE | T0     | SELL | 2 lots | strike whose CE premium ≈ `long_CE_fill_premium / 2` | Exact same strike as T1 Long CE (`longCEStrike`) |
| Short PE | T0     | SELL | 2 lots | strike whose PE premium ≈ `long_PE_fill_premium / 2` | Exact same strike as T1 Long PE (`longPEStrike`) |

In **Mode 1**, short legs are chosen by target premium (~50% of long leg premium). In **Mode 2**, short legs select the exact same strike in the T0 current weekly expiry and sell 2 lots (double quantity).

### Strike rounding

Nifty strikes are in **multiples of 100**. Use **round to nearest 100** (ties: standard half-up, e.g. 24,850 → 24,900; 24,840 → 24,800).

```javascript
function roundStrikeToNearest100(spotDerivedStrike) {
  return Math.round(spotDerivedStrike / 100) * 100;
}
// Long CE strike  = roundStrikeToNearest100(niftyLTP + 500)
// Long PE strike  = roundStrikeToNearest100(niftyLTP - 500)
```

### Entry sequence (strict order — do not parallelize across phases)

#### Phase A — Spot & expiries (09:45 AM IST Wednesday)

1. Confirm today is a valid trading day and not blocked by `.kill` / `.panic` (§2.3).
2. Fetch **Nifty 50 index LTP** (spot). Retry per idempotent-call rules (§2.4); **abort entry** if spot cannot be confirmed.
3. Resolve **T0** and **T1** from the scrip master / holiday calendar (Tuesday weekly chain only — no monthly/quarterly substitutes unless owner later expands scope).
4. Compute long-leg strikes from spot (see strike rounding above).

#### Phase B — Buy long strangle on T1 (must complete before Phase C)

5. Place **BUY 1 lot T1 CE** at the computed CE strike.
6. Place **BUY 1 lot T1 PE** at the computed PE strike.
7. Confirm each fill premium via order status + LTP read (retry ×3 per §2.4 idempotent reads). **Abort the entire entry** (and do not open short legs) if either long fill cannot be confirmed — never guess a fill price for hedge sizing.
8. Record immutable snapshot: `{ longCE: { strike, fillPremium, orderId }, longPE: { strike, fillPremium, orderId }, niftyLTP, T0, T1, entryTimestamp }` before proceeding (§2.6).

#### Phase C — Sell ratio hedges on T0 (only after Phase B fills confirmed)

9. **Per leg independently, same option type** (§1.1):
   - Long T1 CE → scan **T0 CE** chain only; target = `long_CE_fill_premium / 2`.
   - Long T1 PE → scan **T0 PE** chain only; target = `long_PE_fill_premium / 2`.
   - Pick the strike whose **ask-side workable premium** (prefer LTP; fall back to mid of bid/ask for scanning only) is **closest to the target** (absolute difference). If two strikes tie, prefer the **farther OTM** strike (higher strike for CE, lower strike for PE).
10. Place **SELL 2 lots** at the selected T0 CE strike; place **SELL 2 lots** at the selected T0 PE strike (two separate orders).
11. Confirm short fills the same way as long fills. If a short leg fails after its corresponding long leg filled, follow **§1.2 partial-entry policy** (alert + owner-visible state; do not silently leave an unhedged long).

#### Phase D — Post-entry

12. Fetch **entry utilized margin** for the complete open position (all four legs) from the broker (retry ×3; alert + labeled fallback per §2.2). Store as `entryMargin` — this is the fixed baseline for all §1.3 exit math for the life of the trade.
13. Compute and persist exit thresholds (§1.3): `exitThreshold = entryMargin × 0.02`.
14. Begin carryforward monitoring (WebSocket ticks + periodic MTM recompute). Auto-exit when combined P&L crosses ±2% of `entryMargin` (§1.3). No time-based square-off.

### §1.1 Short-leg type — same type per leg (confirmed)

Each T0 short hedge **must** use the **same option type** as its corresponding T1 long leg:

| Long leg (T1)       | Short hedge (T0)                    | Structure                      |
| ------------------- | ----------------------------------- | ------------------------------ |
| CE, 1 lot, +500 OTM | **CE**, 2 lots, premium ≈ ½ CE fill | Calendar **call ratio spread** |
| PE, 1 lot, −500 OTM | **PE**, 2 lots, premium ≈ ½ PE fill | Calendar **put ratio spread**  |

**Do not** cross types (e.g. never sell T0 PE to hedge a long T1 CE). Combined position: long OTM strangle on T1, partially financed by 2× ratio shorts on T0 on each side.

**Risk note for implementers:** 2× short vs 1× long is a ratio structure — short CE adds upside margin risk; short PE adds downside margin risk. Monitor per-leg, not combined premium only.

### §1.2 Partial-entry policy

- Long filled, short failed → **alert immediately** (Telegram + Slack), set position state to `PARTIAL_ENTRY`, **do not** retry short orders blindly (§2.4). Optional single reconciliation pass: check order book for duplicate before any resubmit.
- Never open Phase C shorts without confirmed Phase B fill premiums.
- Never clear position snapshots until post-trade reporting has consumed them (§2.1, §2.6).

### §1.3 Exit rules — 2% profit / 2% loss on entry margin

Exit is **P&L-driven only** (not time-based). The same threshold applies to **profit** and **loss**.

#### Baseline margin

- **`entryMargin`** = broker **utilized margin for the complete trade** (all four legs), fetched once in Phase D step 12 after every leg is confirmed open.
- Fixed for the life of the position — **do not** recalculate thresholds from live/intraday margin changes.
- If margin API fails after retries, follow §2.2 (alert + labeled fallback). Prefer **blocking monitoring exits on unverified fallback margin** over trading on silent fabricated numbers.

#### Threshold

```
exitThreshold₹ = entryMargin × (EXIT_THRESHOLD_PCT / 100)   // default EXIT_THRESHOLD_PCT = 2
```

| Condition                              | Action                                                              |
| -------------------------------------- | ------------------------------------------------------------------- |
| Combined MTM P&L **≥ +exitThreshold₹** | **Close position** — exit every **non-worthless** open leg (§1.3.2) |
| Combined MTM P&L **≤ −exitThreshold₹** | **Close position** — exit every **non-worthless** open leg (§1.3.2) |

**Example:** `entryMargin = ₹2,00,000` → `exitThreshold₹ = ₹4,000`. Exit when combined P&L reaches **+₹4,000** (profit target) or **−₹4,000** (stop-loss).

#### P&L calculation

- **Combined unrealized MTM** across **all open legs**, recomputed on every WebSocket tick (and on any periodic refresh if implemented).
- Leg set shrinks over the trade lifecycle (e.g. after T0 expiry wind-down per §1.3.1, only T1 legs remain in MTM).
- Use the same mark logic for monitoring and exit (LTP-based per leg; document per-leg exit fill confirmation separately in order layer).
- **Worthless legs** (§1.3.2) are marked at ~₹0 for MTM but are **never** sent exit orders — on any exit path.

#### Exit execution (±2% breach)

1. On threshold breach during market hours, place exit orders **immediately** for **every open, non-worthless leg** (buy back shorts, sell longs) — do not wait for 15:20.
2. **Skip worthless legs** — do not place orders (brokerage savings; same rule as §1.3.1).
3. Track per-leg exit success/failure independently (§2.1). Alert on any non-worthless leg that fails to close.
4. `.panic` still halts automated exits (§2.3); `.kill` does not block exits on an open position.
5. If ±2% exit runs that session, still run the **15:40 IST report** job (§1.5) for that day.

#### Carryforward & sessions

- Monitoring runs on **every trading session** while any leg is open (Wednesday entry through subsequent days until fully flat).
- Position may be held overnight and across weekends/holidays until ±2% is hit or §1.3.1 expiry wind-down runs at **15:20 IST**.

#### §1.3.1 Expiry-day wind-down (Tuesday — T0 and T1)

Nifty weeklies expire on **Tuesday**. On each expiry Tuesday, at **15:20 IST** (§1.3.3), run an **expiry-day exit pass** for the legs expiring **that day** (T0 on the first Tuesday after entry; T1 on the following Tuesday). Same logic for both expiries.

| Leg status on its expiry Tuesday | Action at 15:20 IST                                                         |
| -------------------------------- | --------------------------------------------------------------------------- |
| **Worthless** (§1.3.2)           | **Do not book** — no exit order; let expire naturally (saves brokerage)     |
| **Not worthless**                | **Close** — place exit order as part of the 15:20 complete-trade close pass |

**Per-expiry scope (important):**

- **T0 expiry Tuesday @ 15:20:** apply the table to **T0 short legs** expiring that day. **T1 long legs stay open** — carryforward monitoring (±2% on original `entryMargin`) continues on remaining legs.
- **T1 expiry Tuesday @ 15:20:** apply the table to **T1 long legs** expiring that day. T0 legs are already gone from the prior week. After this pass, the trade cycle is complete (aside from any worthless legs left unbooked).

**Holiday handling:** if Tuesday is a non-trading day, run the expiry-day pass on the **exchange’s actual expiry session** for that weekly series, still at **15:20 IST** on that session.

**Interaction with ±2% exit:**

- If ±2% triggers **before** expiry Tuesday → close all **non-worthless** open legs **immediately** (including legs not yet expiring that day).
- If ±2% has **not** triggered by expiry Tuesday → run §1.3.1 at **15:20 IST** for that expiry’s legs only; do not force-close non-expiring legs (e.g. keep T1 longs after T0 expiry).

#### §1.3.3 Scheduled close & report times (IST)

| Time      | Job                      | Details                                                                                                                                                                                                           |
| --------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **15:20** | **Complete-trade close** | Expiry-day wind-down (§1.3.1): close all **non-worthless** legs due for exit that session. Write an **immutable pre-close snapshot** before placing orders (§2.1, §2.6).                                          |
| **15:40** | **Trade report**         | Generate markdown report — **primary input is that day’s MTM log file** (`logs/mtm/mtm-{index}-{date}.log`, §1.8). Runs after 15:20 close when applicable (~20 min buffer for last MTM minute + fill settlement). |

- **Cron (Asia/Kolkata):** close `20 15 * * 2` (Tuesday 15:20); report **`40 15 * * 1-5`** (weekdays **15:40 IST**, §1.8).
- Verify **15:20** is still **before** Angel One’s mandatory expiry square-off window (paper-mode check, §2.7).
- Do **not** clear `entryMargin` or position snapshots before the **15:40** report job has read supplementary metadata (§1.8).

#### §1.3.2 Worthless leg definition

A leg is **worthless** when its **LTP < WORTHLESS_LTP_THRESHOLD** (default **₹5** — env `WORTHLESS_LTP_THRESHOLD`).

- Worthless legs are **never** sent exit orders on **any** exit path (±2% profit/loss, expiry-day wind-down, manual bot exit).
- They are excluded from order placement but included in position state as `EXPIRED_UNBOOKED` after expiry for reporting.
- **ITM / non-worthless legs must always be closed** — never treat an ITM option as worthless to save brokerage.

```javascript
function isWorthless(ltp, threshold = 5) {
  return ltp < threshold;
}
```

#### Partial-entry (§1.2)

- Do **not** apply §1.3 thresholds until status is `FULL_ENTRY` (all intended legs open and `entryMargin` captured).
- `PARTIAL_ENTRY` positions: alert only; no auto-exit math until owner resolves or position is completed/aborted manually.

### §1.4 Instrument scope & future expansion

- **In scope now:** NIFTY index options only (`NFO`, `OPTIDX`, name `NIFTY`), weekly Tuesday expiries.
- **Out of scope until enabled:** SENSEX (planned — mirror this section with BSE Thursday expiry and its own lot-size / strike-step config when `ENABLE_SENSEX=true` is added).
- Lot size: never hardcode — verify dynamically (§2.10).

### §1.5 Scheduling

- **Entry cron:** `45 9 * * 3` interpreted in **Asia/Kolkata** (Wednesday 09:45).
- If Wednesday is a non-trading day: run entry on the **next trading day** at 09:45 IST (forward search).
- **Expiry close cron:** `20 15 * * 2` — Tuesday **15:20 IST** complete-trade close pass (§1.3.1, §1.3.3).
- **Report cron:** `40 15 * * 1-5` — **15:40 IST** on weekdays; generate report from that day’s MTM log (§1.8). Skip if no `logs/mtm/mtm-{index}-{date}.log` exists for the index.
- Between entry and exit: carryforward — no mandatory daily flat; ±2% exits are **immediate** when breached (§1.3).

### §1.6 Kill switch, reporting, margin

- **Kill Switch vs Panic Switch** (§2.3): `.kill` blocks new Wednesday entries only; `.panic` halts monitoring/exits too.
- **MTM log:** WebSocket-driven, **once per minute** — format and paths in **§1.7**.
- **Trade report:** **15:40 IST** markdown report built from the **MTM log file** (§1.8); never from live mutable position state.
- **Margin alerts:** any fallback margin value must be labeled and alerted (§2.2).

### §1.7 MTM log (WebSocket → file)

While a position is open and the market-data **WebSocket is connected**, recompute combined unrealized MTM (§1.3) from the latest leg LTPs and append to the day’s MTM file. This log is the **authoritative source for the 15:40 trade report** (§1.8) and must remain independent of mutable position state (§2.6).

#### File naming & location

- **Directory:** `logs/mtm/`
- **Pattern:** `mtm-{index}-{YYYY-MM-DD}.log`
- **One file per index per IST calendar day** (rotate at IST midnight, §2.5).
- **Examples:**
  - `logs/mtm/mtm-nifty-2026-07-28.log`
  - _(future)_ `logs/mtm/mtm-sensex-2026-07-28.log`

`{index}` is lowercase (`nifty`, `sensex`). `{YYYY-MM-DD}` is the **IST trading date**.

#### Line format (exact)

```
[DD/MM/YYYY, H:mm:SS am/pm] [INFO] INDEX: MTM = VALUE
```

| Field     | Rule                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------ |
| Timestamp | **IST**; `DD/MM/YYYY` day/month **without** forced leading zeros (`28/7/2026`, not `28/07/2026`) |
| Time      | 12-hour clock, `H:mm:SS`, lowercase `am` / `pm`, seconds two digits                              |
| Level     | Literal `[INFO]`                                                                                 |
| Index     | Uppercase symbol (`NIFTY`, later `SENSEX`)                                                       |
| VALUE     | Combined MTM in ₹, decimal allowed; use the **full computed value** (do not round to int)        |

**Examples (required shape):**

```
[28/7/2026, 3:16:00 pm] [INFO] NIFTY: MTM = 3974.75
[28/7/2026, 9:45:00 am] [INFO] NIFTY: MTM = -120.50
```

#### When to write

1. **WebSocket connected + open position:** compute MTM on incoming ticks; **append at most one line per clock minute** (aligned to `:00` seconds — e.g. `3:16:00 pm`, not `3:16:47 pm`) to avoid unbounded file growth from tick bursts.
2. **Also append immediately** when ±2% exit threshold is breached (in addition to the regular minute line if one did not fire that second).
3. **Do not write** when no position is open for that index, or when WebSocket is disconnected (log a Winston warning separately; do not fabricate MTM lines).
4. Continue logging on carryforward days (Wed → Thu → … → expiry Tuesday) for every session the position is live.

#### Implementation notes

- MTM on each line = same combined unrealized P&L used for ±2% exit checks (§1.3), across all **open** legs; worthless legs marked ~₹0.
- Use `Intl.DateTimeFormat` with `Asia/Kolkata` for both filename date and line timestamp (§2.5) — do not rely on host timezone.
- Append-only: never rewrite or truncate the day’s file from the trading process.
- Add a unit test that formats a fixture timestamp + MTM and asserts exact string match (including `28/7` style and lowercase `pm`).

```javascript
// Illustrative — exact spacing and casing must match §1.7
function formatMtmLogLine(date: Date, index: 'NIFTY', mtm: number): string {
  const ist = /* Intl.DateTimeFormat parts in Asia/Kolkata */;
  // e.g. [28/7/2026, 3:16:00 pm] [INFO] NIFTY: MTM = 3974.75
  return `[${day}/${month}/${year}, ${hour}:${min}:${sec} ${ampm}] [INFO] ${index}: MTM = ${mtm}`;
}
```

### §1.8 Daily trade report (15:40 IST — from MTM log)

At **15:40 IST** on each weekday, generate a markdown trade report by reading **that IST day’s MTM log file** — not live position state and not recomputed MTM at report time.

#### Input (required)

- **Primary:** `logs/mtm/mtm-{index}-{YYYY-MM-DD}.log` for the report date (IST) and index (e.g. `logs/mtm/mtm-nifty-2026-07-28.log`).
- Parse every line matching §1.7 format into `{ timestamp, index, mtm }` records.
- **If the MTM file is missing or empty** for that index/day → skip report generation and alert (do not fabricate MTM from position store).

#### Input (supplementary — static trade metadata only)

Entry/exit snapshots (§2.6) may supply fields **not present in the MTM log**: strikes, fill premiums, `entryMargin`, `exitThreshold₹`, T0/T1 dates, leg order IDs, exit reason. **All MTM figures and intraday MTM charts/stats in the report must come from the MTM log**, not snapshots or live state.

#### Report content (minimum)

Derived from parsed MTM log lines:

- Session **open MTM** (first line) and **close MTM** (last line, typically ~15:16 pm or final minute before report)
- Session **high / low** MTM and timestamps
- Full **MTM time series** for the day (or summarized table of minute readings)
- Whether ±2% threshold (from supplementary `entryMargin`) was breached during the session (cross-check last MTM vs threshold)

Output path: `analysis/reports/` (visibility per §2.8). Filename pattern: implementer choice, e.g. `nifty-2026-07-28.md`.

#### Scheduling & ordering

- **Cron:** `40 15 * * 1-5` in **Asia/Kolkata** (15:40 IST weekdays).
- Runs **after** the last once-per-minute MTM write for the session (final minute line ~15:16:00 pm or later if still monitoring) and **after** any 15:20 expiry close on Tuesdays.
- On ±2% exit days (any weekday), still run at 15:40 using the same day’s MTM log (which includes the breach-minute line per §1.7).
- Add a CI smoke test: parse a fixture `mtm-nifty-*.log` and assert report renders expected high/low/close (§2.9).

```javascript
// Report job must read the file — never recompute MTM from WebSocket/state at 15:40
const mtmLogPath = `logs/mtm/mtm-nifty-${istDateString}.log`;
const lines = await readFile(mtmLogPath, 'utf8');
const series = parseMtmLogLines(lines); // regex matching §1.7 line format
// build markdown from series + supplementary snapshot metadata
```

_(Full stack/structure/env reference: §3. Environment toggles for this strategy: see §3 — future `ENABLE_SENSEX`.)_

---

## 2. Core Engineering Principles — Apply to Every New Strategy

These are not strategy-specific. Each one maps to a real incident already hit while building this bot — read the "why" once, then treat it as a non-negotiable default for any future algo built from this blueprint.

### 2.1 Never let cleanup destroy data another process still needs

**Why:** `positionStore.clear()` was fixed to zero out `entryMargin` (correctly, to stop stale legs lingering). But the post-expiry report generator reads that same file 20 minutes later and now silently computes "Return on Margin" against 0.
**Rule:** Before any store/state "clear" or "reset" operation, ask _who else reads this state after I clear it?_ If a downstream job (reporting, reconciliation, audit) depends on post-trade values, either (a) write an immutable snapshot/log entry _before_ clearing, or (b) have downstream consumers read from an append-only log, never from the same mutable file the live process clears. Cleanup and reporting must never share a single mutable source of truth.

### 2.2 Fallback values are a production incident waiting to happen — never let them be silent

**Why:** The margin API was broken for ~2 weeks of live trading (a missing required field caused every call to fail), and the bot silently traded on a hardcoded ₹3,50,000 fallback margin the entire time, with no one aware until the reports were reviewed after the fact.
**Rule:** Any fallback/default value that feeds into a risk calculation (SL, margin, position sizing, entry price) must:

- Trigger an explicit alert every time it's used, not just a log line.
- Be visually distinguishable in every downstream report/status output (e.g. `₹3,50,000 (fallback)` never bare `₹3,50,000`).
- Have a retry budget before falling back at all — and the retry failure itself should be alerted, since a repeatedly-failing API call is itself the real signal.
- Be treated as a "degrade, don't guess" trigger where possible: consider blocking entry entirely rather than trading on fabricated numbers, if the risk math is safety-critical.

### 2.3 Separate "pause new activity" from "stop everything, no exceptions"

**Why:** An earlier single kill switch paused entries _and_ exits _and_ monitoring together — meaning the safety net (stop-loss) could be accidentally disabled by the same switch meant to just pause new trades.
**Rule:** Every algo needs at least two independent switches:

- A **soft pause** (blocks new entries only) — the default, low-risk lever.
- A **hard stop** (blocks exits/monitoring too) — reserved, clearly named (`/panic`, not `/kill`), and never the first thing reached for mid-trade.
  Never conflate these into one flag, and never let the "obvious" command name (`/kill`, `/stop`) map to the more dangerous behavior.

### 2.4 Order placement must never be blindly auto-retried

**Why:** A generic retry-with-backoff wrapper was applied to every API call including order placement. If a placed order succeeds broker-side but the HTTP response drops/times out, blind retry would submit a duplicate live order.
**Rule:** Classify every external call as **idempotent** (safe to retry: quotes, margin, LTP, scrip master) or **non-idempotent** (never blind-retry: order placement, any "do a thing" mutation). Non-idempotent calls should either skip retry entirely, or check the broker's order/trade book for an existing matching order before resubmitting.

### 2.5 Timezone logic must not depend on the host machine's config

**Why:** An early IST-date trick (`new Date(date.toLocaleString('en-US', {timeZone:'Asia/Kolkata'}))`) only worked correctly if the server's own OS timezone happened to be UTC — an implicit, unverified assumption.
**Rule:** Use `Intl.DateTimeFormat` + explicit `Date.UTC(...)` reconstruction for all "what day/date is it in IST" logic (never the `toLocaleString` round-trip). Additionally, pin `TZ=UTC` explicitly in the process manager config (`ecosystem.config.cjs` env block) as a second, independent safety layer — don't rely on either fix alone.

### 2.6 Reports and audit trails must read from append-only data, not live mutable state

**Why:** Because the report generator reads the same file the live trading logic clears (§2.1), report accuracy is hostage to trading-code timing, not a report-code decision.
**Rule:** Any "what happened" artifact (post-trade report, MTM history, audit log) should be built from its own independent, append-only log written incrementally during the day — never reconstructed after the fact from the current value of live/mutable state. Snapshot early and often; read snapshots, not live state, when generating summaries.

### 2.7 Verify every broker endpoint before trusting it in production

**Why:** On initial go-live, the login endpoint, scrip master URL, spot-quote endpoint, and WebSocket host were all outright wrong (old/deprecated paths) — not edge cases, just untested assumptions that only surfaced once real traffic hit them.
**Rule:** Before a new strategy or a new broker integration goes live, do a dry-run checklist against real (paper-mode-safe) calls to every endpoint the strategy touches: auth, quote/LTP, margin, order placement, WebSocket connect. Don't assume an endpoint copied from an old strategy or from docs is still current — hit it once in paper mode first.

### 2.8 Decide deliberately what trading data becomes public

**Why:** Automated post-expiry reports (real spot prices, strikes, quantities, P&L, margin) get committed straight to a public GitHub repo every expiry day as a side effect of the CI pipeline, with no explicit decision ever made about it.
**Rule:** Before wiring any automated commit-based reporting/logging pipeline, explicitly decide the visibility of the output (public repo, private repo, or gitignored entirely) as a deliberate step — not as an accidental default of "the pipeline already commits things."

### 2.9 Keep report-generation code changes independent of trading-logic changes

**Why:** The report generator's field-reading logic went stale relative to trading-code changes without anyone noticing (§2.1), and at least one report was manually hand-written with a different schema after the automated pipeline apparently failed silently for a day.
**Rule:** Whenever trading-logic state shape changes (new fields, cleared fields, renamed fields), grep every consumer of that state file — reports, dashboards, Telegram `/status` — in the same change, not as a follow-up. Add a smoke-test that renders a full end-of-day report against fixture data as part of CI, so a broken report is caught before it silently produces wrong numbers for weeks.

### 2.10 Never hardcode lot size — verify it dynamically against the scrip master, and never trust a single row

**Why:** NSE/BSE revise index lot sizes periodically (a live example: Nifty's lot size has changed more than once in recent years), and the scrip master itself contains one row per contract (every strike × every expiry) — naively looping and overwriting `lotSizes[name] = row.lotsize` on every match means the final value is just whatever row happened to be _last_ in the array that day, not a verified value. This is exactly how a "vague" or wrong lot size (e.g. a stray `75` instead of the real `65`) sneaks in silently.
**Rule:**

- Never hardcode lot size as a bare constant and trust it forever (`INDEX_CONFIGS.NIFTY.lotSize = 65` must be treated as a _default to verify_, not a fact).
- When deriving lot size from the scrip master, aggregate across **every matching contract row** for that index and take the **majority value**, not the last-seen value. If more than one distinct lot size appears across the day's contracts for the same index, that disagreement itself is the signal — log/alert it loudly rather than silently picking one.
- Reconcile the derived value against the hardcoded config at startup (and ideally on the 08:30 AM scrip-master-refresh cron too — see §1 step 1). If they disagree, **block entry and alert**; don't quietly trade with a lot size no one has verified for today.
- Skip/discard any row where `lotsize` fails to parse as a positive integer — don't let a single malformed row corrupt the aggregate.

```javascript
// Aggregate lot sizes across ALL matching contract rows — never overwrite with the last one seen.
function extractLotSizes(instruments, targetIndices) {
  const freq = {}; // { NIFTY: { 65: 412, 75: 1 } }

  for (const item of instruments) {
    if (
      item.exch_seg === 'NFO' &&
      (item.instrumenttype === 'FUTIDX' || item.instrumenttype === 'OPTIDX') &&
      targetIndices.includes(item.name)
    ) {
      const lot = parseInt(item.lotsize, 10);
      if (!Number.isFinite(lot) || lot <= 0) continue; // discard malformed rows, don't let them win

      freq[item.name] = freq[item.name] || {};
      freq[item.name][lot] = (freq[item.name][lot] || 0) + 1;
    }
  }

  const resolved = {};
  for (const [name, counts] of Object.entries(freq)) {
    const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const [majorityLot, majorityCount] = ranked[0];
    const total = ranked.reduce((sum, [, c]) => sum + c, 0);

    resolved[name] = parseInt(majorityLot, 10);

    if (ranked.length > 1) {
      // Disagreement across contracts for the same index — this is the real finding, alert on it.
      console.warn(
        `Lot size disagreement for ${name}: ${JSON.stringify(counts)} — using majority ${majorityLot} (${majorityCount}/${total} contracts). Verify before trading.`
      );
    }
  }
  return resolved;
}

// At startup / on scrip-master refresh: reconcile against the hardcoded config, don't just log and move on.
function verifyLotSizeOrBlock(symbol, derivedLotSize, configuredLotSize, sendAlert) {
  if (derivedLotSize !== configuredLotSize) {
    sendAlert(
      `🚨 Lot size mismatch for ${symbol}: scrip master says ${derivedLotSize}, config says ${configuredLotSize}. Entry blocked until resolved.`
    );
    return false; // block entry for this symbol until config is corrected
  }
  return true;
}
```

---

## 3. Project Stack, Structure & Environment (Reference)

### Stack

| Concern         | Choice                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------- |
| Runtime         | Node.js >= 22 LTS                                                                            |
| Language        | TypeScript (strict), ES modules                                                              |
| Package manager | pnpm                                                                                         |
| Framework       | Express (health check endpoint only)                                                         |
| Broker          | Angel One SmartAPI                                                                           |
| TOTP            | `otplib`                                                                                     |
| Scheduling      | `node-cron`                                                                                  |
| Telegram Bot    | `telegraf`, polling mode, owner-only auth middleware (§2.3 applies to its commands)          |
| Slack Backup    | Incoming Webhook fallback                                                                    |
| Logging         | Winston (daily rotated files, IST timestamps) + WebSocket-driven MTM append log (§1.7, §2.6) |
| Persistence     | Local JSON files, one position file per index/instrument                                     |
| Switches        | `.paper` (paper mode), `.kill` (soft pause), `.panic` (hard stop) — see §2.3                 |
| Testing         | Jest + ts-jest, coverage enforced on core modules; add a report-fixture smoke test (§2.9)    |
| Env             | `.env` via `dotenv`, no `process.env` access outside `src/config/env.ts`                     |
| Process manager | PM2, with `TZ=UTC` pinned explicitly (§2.5)                                                  |

### Structure

```
<strategy-name>/
├── src/
│   ├── server.ts                # Express health route
│   ├── config/env.ts            # dotenv validation + typed config
│   ├── store/                   # Position/session/config state (mutable, live)
│   ├── helpers/
│   │   ├── constants.ts         # Per-instrument config (lot size, strike step, tokens)
│   │   ├── api.ts               # axios wrapper: real IP/MAC, timeout, throttle, retry (idempotent calls only — §2.4)
│   │   ├── login.ts             # TOTP + session login
│   │   ├── holidayCheck.ts      # Timezone-safe (§2.5) expiry/trading-day logic
│   │   ├── scripMaster.ts / marketData.ts / websocket.ts / orders.ts
│   │   └── modeManager.ts       # .paper / .kill / .panic switches (§2.3)
│   ├── jobs/                    # Entry, exit/monitor, MTM logger (§1.7 — append-only, WebSocket-driven)
│   ├── telegram/bot.ts          # Owner-only auth middleware, mirrors switch semantics
│   ├── notifier.ts              # Telegram primary + Slack fallback
│   └── main.ts                  # Cron registration
├── analysis/
│   ├── generateReport.ts        # 15:40 job — reads logs/mtm/mtm-{index}-{date}.log (§1.8)
│   └── reports/                 # Output markdown; visibility per §2.8
├── logs/
│   └── mtm/                     # mtm-{index}-{YYYY-MM-DD}.log — §1.7
└── data/                        # Position state, config, cached scrips
```

### Environment Variables

```env
PORT=3000
NODE_ENV=production

# Broker Credentials
API_KEY=
CLIENT_CODE=
CLIENT_PIN=
CLIENT_TOTP_PIN=

# Telegram
USE_TELEGRAM=true
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=       # also the sole authorized command sender — §2.3

# Slack
USE_SLACK=false
SLACK_WEBHOOK_URL=
SLACK_SIGNING_SECRET=

# Strategy-specific toggles (Nifty Weekly Calendar Ratio Strangle — §1)
EXIT_THRESHOLD_PCT=2          # §1.3: profit target and stop-loss as % of entryMargin (symmetric)
WORTHLESS_LTP_THRESHOLD=5     # §1.3.2: legs below this LTP are not booked on exit (brokerage savings)
TRADE_CLOSE_HOUR=15           # §1.3.3: IST time for expiry-day complete-trade close
TRADE_CLOSE_MINUTE=20
REPORT_HOUR=15                # §1.3.3: IST time for post-close markdown report
REPORT_MINUTE=40
# ENABLE_SENSEX=false           # future — do not implement until §1.4 expanded
```

---

## 4. Pre-Launch Checklist (for any new strategy built from this blueprint)

- [ ] Every broker endpoint hit at least once in paper mode (§2.7)
- [ ] Every fallback value feeding risk math sends an explicit alert and is labeled as fallback in all output (§2.2)
- [ ] Order placement calls are excluded from generic retry (§2.4)
- [ ] Soft pause and hard stop are separate switches with separate names (§2.3)
- [ ] All date/day-of-week logic uses `Intl.DateTimeFormat`, and `TZ=UTC` is pinned in the process manager config (§2.5)
- [ ] Reports/audit trails read MTM time-series from `logs/mtm/` append-only files (§1.8), not live mutable state (§2.1, §2.6)
- [ ] A CI smoke test parses a fixture MTM log and renders a report (§2.9, §1.8)
- [ ] Visibility of any auto-committed trade data (public/private repo) has been explicitly decided, not defaulted (§2.8)
- [ ] Lot size per instrument is verified against the scrip master by majority vote across all matching contract rows, not hardcoded and never taken from a single/last row — entry blocks and alerts on mismatch (§2.10)
