# Strike Selection Parity Verification

## Overview

This document records the strike selection parity comparison between the backtest engine (`backtest/strikes.ts`) and the production logic (`src/jobs/entry.ts`).

## Verification Methodology

1. **Long Legs (T1 Expiry)**: Computed as `round((spot ± 500) / 100) * 100`.
2. **Mode 1 Short Legs (T0 Expiry)**: Target premium = T1 long fill premium / 2. Filter 100-multiple strikes within ±1500 of spot. Pick strike with LTP ≥ target closest to target. Tie-break: farther OTM (higher CE / lower PE).
3. **Mode 2 Short Legs (T0 Expiry)**: Exact same strikes as long legs (CE/PE).

## Spot-Check Cycle Results

### Cycle 1: 2026-05-04 (Spot = 24282.10)

- **T1 Expiry**: 2026-05-12 | **T0 Expiry**: 2026-05-05
- **Long CE Strike**: 24800 (Spot + 500 = 24782.10 -> rounded = 24800)
- **Long PE Strike**: 23800 (Spot - 500 = 23782.10 -> rounded = 23800)
- **Mode 1 Short CE**: 24800 (Target LTP = 40.0, selected 24800 CE @ 40.0)
- **Mode 1 Short PE**: 23800 (Target LTP = 40.0, selected 23800 PE @ 40.0)
- **Mode 2 Short CE / PE**: 24800 CE / 23800 PE
- **Parity Status**: ✅ MATCH (Production `generateBasket` produces identical strike selections for spot 24282.10).

### Cycle 2: 2026-07-01 (Spot = 23946.05)

- **T1 Expiry**: 2026-07-14 | **T0 Expiry**: 2026-07-07
- **Long CE Strike**: 24400 | **Long PE Strike**: 23400
- **Mode 1 Short CE / PE**: 24400 CE / 23400 PE
- **Mode 2 Short CE / PE**: 24400 CE / 23400 PE
- **Parity Status**: ✅ MATCH

### Manual P&L Calculation Verification (Sanity Spot-Check)

- **Long Leg Fill**: CE 24800 @ ₹80, PE 23800 @ ₹80 (Lot size = 65)
- **Short Leg Fill (2 lots each)**: CE 24800 @ ₹40, PE 23800 @ ₹40 (Qty = 130)
- **Exit Prices**: Long CE @ ₹100, Long PE @ ₹10, Short CE @ ₹20, Short PE @ ₹2 (Worthless <= ₹5 -> marked 0)
- **Long CE Gross P&L**: (100 - 80) * 65 = +₹1,300
- **Long PE Gross P&L**: (10 - 80) * 65 = -₹4,550
- **Short CE Gross P&L**: (40 - 20) * 130 = +₹2,600
- **Short PE Gross P&L**: (40 - 0) * 130 = +₹5,200 (Worthless option expired unbooked)
- **Combined Gross P&L**: ₹4,550
- **Engine Calculation**: ✅ Matches manual P&L arithmetic exactly.
