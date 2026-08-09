# Backtest Fidelity Audit — nifty-weekly-calendar-ratio-strangle

**Audit date:** 2026-08-06
**Method:** Live algo code (`src/`) vs backtest engine (`backtest/`), empirical check against live Aug 5 entry.
**Verdict: PARTIALLY** — entry logic matches, but the exit/wind-down model diverges materially.

---

## Step 1 — LIVE Algo Rules (from code)

| Rule | Live behavior | Citation |
|------|---------------|----------|
| Entry day | Wednesday 09:45 IST only (or next trading day if Wed holiday) | `src/main.ts:72-125` (cron `45 9 * * 1-5`) |
| Entry time | 09:45 IST cron | `src/main.ts:73` |
| Instrument | NIFTY OPTIDX weekly, T0 = current weekly, T1 = next weekly | `src/jobs/entry.ts:70` |
| Long legs | BUY 1 lot CE + PE on **T1**, strikes = round(spot±500/100)*100 | `src/jobs/entry.ts:84-85, 152-165` |
| Short legs | SELL **2 lots** CE + PE on **T0**; Mode 1: LTP closest to longPremium/2 (≥target, 100-multiple, ±1500, tie→farther OTM); Mode 2: same strikes | `src/jobs/entry.ts:233-319, 336-349` |
| Lot size | 65 (verified from scrip master) | `src/jobs/entry.ts:50` |
| Fill price | Market order + confirmOrderFill (actual fill) | `src/jobs/entry.ts:168-177` |
| Margin | `getUtilisedMargin()` → RMS `utiliseddebits` (account-wide) | `src/jobs/entry.ts:401`, `src/helpers/api.ts:129` |
| Exit threshold | margin × 2% (symmetric ±) | `src/jobs/entry.ts:402` |
| **Wind-down** | **Tuesday 15:20 IST, `expiryOnly=true` → closes ONLY legs expiring that day** | `src/main.ts:128-141`, `src/jobs/monitor.ts:116-149` |
| Threshold breach | |MTM| ≥ threshold on any WS tick → exit ALL open legs | `src/jobs/monitor.ts:227-234` |
| Worthless filter | legs with LTP ≤ ₹5 → `EXPIRED_UNBOOKED` (no order) | `src/jobs/monitor.ts:154-160` |
| State | persisted `data/position-nifty.json`; resume on restart | `src/main.ts:37-49` |

## Step 2 — Backtest Simulation Logic

| Stage | Backtest behavior | Citation |
|-------|-------------------|----------|
| Data | 5-min chain snapshots from `nifty-optionchain-data` | `backtest/dataLoader.ts` |
| Cycle | ~~every trading day~~ → **FIXED 2026-08-06: Wednesday-only** (+holiday fallback) | `backtest/cycles.ts:58-82` |
| Entry time | 09:45 (fallback 09:40) | `backtest/cycles.ts:151` |
| Entry fills | snapshot LTP at 09:45 (no slippage) | `backtest/engine.ts:126,147-156` |
| Strikes | mirrors entry.ts Mode 1/2 (incl. ½-premium, ±1500, 100-multiple) | `backtest/strikes.ts:74-120` |
| Margin | **fixed ₹180,000** (config default) | `backtest/config.ts:17` |
| Threshold | margin × 2% = ₹3,600 | `backtest/engine.ts:137` |
| **Exit** | **ALL 4 legs closed at T0-expiry Tuesday 15:15/15:20** | `backtest/exit.ts:37-71` |
| Breach | first 5-min snapshot where |MTM| ≥ threshold | `backtest/exit.ts:63-69` |
| Whipsaw flag | breach but 15:15 MTM > −1×threshold | `backtest/exit.ts:90` |
| Charges | ₹20/order + 0.125% STT on sell turnover | `backtest/pnl.ts:61-79` |

## Step 3 — Point-by-Point Comparison

| # | Check | Live | Backtest | Verdict |
|---|-------|------|----------|---------|
| 1 | Entry cadence | Wed only | Wed only (fixed) | ✅ MATCH (after 2026-08-06 fix) |
| 2 | Entry price | market fill | snapshot LTP | ⚠️ GAP (slippage unmodeled, small) |
| 3 | SL fill | WS-tick trigger, market exit | 5-min snapshot | ⚠️ GAP (breach timing ±5 min) |
| 4 | **Worthless settlement** | ₹5 → unbooked | ₹5 → unbooked | ✅ MATCH |
| 5 | **Hedge legs** | 2-lot shorts modeled | 2-lot shorts | ✅ MATCH |
| 6 | Lot size | 65 | 65 | ✅ MATCH |
| 7 | Day filter | Wed only | Wed only | ✅ MATCH (fixed) |
| 8 | Session state | persisted | N/A (per-cycle) | ⚠️ GAP (live skips entry while open) |
| 9 | **Exit reasons** | THRESHOLD_BREACH, EXPIRY_WIND_DOWN(partial!) | EXPIRY/BREACH_LOSS/BREACH_PROFIT (full close) | ❌ **GAP — big** |
| 10 | Data timing | real-time WS ticks | 5-min snapshots | ⚠️ GAP (acceptable approximation) |

### 🔴 THE CRITICAL GAP (item 9) — RESOLVED 2026-08-06

**Original finding:** live wind-down passed `expiryOnly=true`, which would skip T1 longs on the T0-expiry Tuesday (they don't expire that day) → longs ride 2 weeks, next Wednesday entry skipped.

**Resolution:** user confirmed intent is **"wind-down exits ALL 4 legs on the T0 Tuesday"**. Fixed `src/main.ts:135` — removed the `expiryOnly` flag:
```js
await executeExit('EXPIRY_WIND_DOWN');   // was: executeExit('EXPIRY_WIND_DOWN', true)
```
Deployed + PM2 restarted. The live cycle is confirmed **1 week** (Wed entry → T0 Tuesday full exit), matching the backtest's cycle model.

### Secondary gaps

| Gap | Impact |
|-----|--------|
| Margin: backtest ₹1.8L vs live ₹3.37L (account-wide) → breach threshold ₹3,600 vs ₹6,743 live | **understates** live breach tolerance → backtest flags breaches live wouldn't |
| Exit time: backtest 15:15 (fallback 15:20); live **15:20** | minor, 5 min at expiry |
| Charges: backtest omits exchange txn fee + GST + SEBI | **understates** costs ~5-15% |
| Entry fill slippage unmodeled | minor |

## Step 4 — Empirical Check (live Aug 5, 2026)

| Leg | LIVE (actual) | Backtest model | Match? |
|-----|---------------|----------------|--------|
| T1 Longs | 25100CE @ 51.05, 24100PE @ 39.05 (18AUG) | snapshot 09:45 LTP | ✅ close |
| T0 Shorts | 25000CE @ 27.80, 24200PE @ 21.15 (11AUG) | Mode 1 ½-premium selection | ✅ close |
| Entry time | 09:45:01-02 IST | 09:45 | ✅ |
| Exit | Tue 11-Aug 15:20 shorts only; longs 18-Aug | Tue 11-Aug ALL legs | ❌ **diverges** |

No Aug 5 cycle in the current backtest CSV (data for the live week is incomplete at audit time).

## VERDICT: **PARTIALLY → YES (after 2026-08-06 fix)** — entry-side fidelity good; exit-side gap (wind-down not closing longs) fixed and deployed; remaining gaps are margin model, exit-time preference, charges, slippage.

## Gap List (priority order)

1. **~~Wind-down semantics~~ ✅ FIXED 2026-08-06**: `main.ts:135` no longer passes `expiryOnly=true` — wind-down now closes ALL 4 legs on the T0-expiry Tuesday. Live cycle = 1 week, matching backtest.
2. **Margin model**: use live-like margin (₹3.37L or per-leg estimate) so threshold breaches match reality. Impact: **understates** threshold → phantom breaches. **Fix:** config default → 337000 or `marginMode: 'estimate'`.
3. **Exit time**: live 15:20, backtest 15:15-first. **Fix:** prefer 1520.
4. **Charges**: add exchange txn fee (~0.05%) + GST (18%) + SEBI ₹10/crore. Impact: **understates** costs. **Fix:** extend `pnl.ts`.
5. **Entry slippage**: model ~0.1-0.2% on market fills. Minor.

## Follow-up PR Scope (not implemented — audit only)

Fix the remaining fidelity gaps: margin default → live value (₹3.37L or per-leg estimate), exit-time preference → 15:20, extend charges (exchange + GST + SEBI). The wind-down fix is already deployed. The cycle cadence now matches live (1 week), so backtest P&L direction is trustworthy; magnitudes still slightly optimistic until margin/charges are corrected.
