## Summary

This PR implements three fidelity fixes to the backtest engine in `backtest/` to align backtest margin, exit timing, and transaction charges with production behavior without touching live code in `src/`.

### Key Changes

- **Fix 1 — Margin Model**:
  - Updated `fixedMarginPerStrangle` default in `backtest/config.ts` from `180000` to `337134` (measured live 4-leg margin).
  - Calculated 2% threshold is now ₹6,742.68 (~₹6,743), matching live risk management.
- **Fix 2 — Exit Time**:
  - Reordered exit-time snapshot resolution in `backtest/cycles.ts` to prefer `1520` (live wind-down cron time) -> `1525` -> `1515`.
  - Added documentation comments in `backtest/cycles.ts` reflecting `.env` `TRADE_CLOSE_HOUR=15` and `TRADE_CLOSE_MINUTE=20`.
- **Fix 3 — Complete Charges Model**:
  - Enhanced `calculateLegPnlAndCharges()` in `backtest/pnl.ts` and `BacktestConfig` in `backtest/config.ts` to compute:
    - Brokerage: ₹20 per executed order (entry always; exit only if `CLOSED`).
    - STT: 0.125% on sell-side premium turnover only.
    - Exchange transaction charge: 0.05% (`exchangeTxnRate = 0.0005`) on total premium turnover (buy + sell).
    - GST: 18% (`gstRate = 0.18`) on (brokerage + exchange transaction charge).
    - SEBI fee: ₹10 per crore / 0.0001% (`sebiRate = 0.000001`) on total premium turnover.
  - Added thorough unit tests in `backtest/backtest.spec.ts` asserting exact hand-computed values across 4 leg scenarios.

### Verification

- `pnpm verify` passed with 100% backtest P&L coverage and 0 lint errors.
- `pnpm backtest --mode both` ran cleanly.
- Updated `README.md` to document the new margin, exit time, and charge defaults.
