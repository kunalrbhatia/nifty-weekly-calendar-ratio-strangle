# Backtest Comparison Report: Nifty Weekly Calendar Ratio Strangle

**Generated At**: 2026-08-02T14:19:21.339Z

---

## 1. Executive Strategy Summary Table

| Metric                        | Mode 1 (½-Premium Ratio) | Mode 2 (Same-Strike Calendar) |
| :---------------------------- | :----------------------: | :---------------------------: |
| **Total Cycles Evaluated**    |            1             |               1               |
| **Completed Cycles**          |            0             |               0               |
| **Skipped Cycles**            |            1             |               1               |
| **Total Net P&L (₹)**         |        **₹0.00**         |           **₹0.00**           |
| **Total Gross P&L (₹)**       |          ₹0.00           |             ₹0.00             |
| **Total Charges (₹)**         |          ₹0.00           |             ₹0.00             |
| **Win Rate (%)**              |          0.00%           |             0.00%             |
| **Average Win (₹)**           |          ₹0.00           |             ₹0.00             |
| **Average Loss (₹)**          |          ₹0.00           |             ₹0.00             |
| **Profit Factor**             |           0.00           |             0.00              |
| **Expectancy / Cycle (₹)**    |          ₹0.00           |             ₹0.00             |
| **Max Drawdown (₹)**          |          ₹0.00           |             ₹0.00             |
| **Max Drawdown (%)**          |          0.00%           |             0.00%             |
| **Sharpe Ratio (Annualized)** |           0.00           |             0.00              |

---

## 2. Exit Behaviour & Risk Breakdown

| Exit Event Metric              | Mode 1 (½-Premium Ratio) | Mode 2 (Same-Strike Calendar) |
| :----------------------------- | :----------------------: | :---------------------------: |
| **P(Breach Loss)**             |          0.00%           |             0.00%             |
| **P(Breach Profit)**           |          0.00%           |             0.00%             |
| **P(Normal Expiry)**           |          0.00%           |             0.00%             |
| **Avg Loss When Breached (₹)** |          ₹0.00           |             ₹0.00             |
| **Whipsaw Rate (%)**           |          0.00%           |             0.00%             |
| **Expiry Bleed Rate (%)**      |          0.00%           |             0.00%             |

---

## 3. Performance Charts

![Equity Curves](file:///C:/Users/Kunal/Desktop/hobby-projects/nifty-weekly-calendar-ratio-strangle/backtest/reports/equity_curves.png)
![P&L Distribution](file:///C:/Users/Kunal/Desktop/hobby-projects/nifty-weekly-calendar-ratio-strangle/backtest/reports/pnl_distribution.png)

---

## 4. Per-Cycle Detail Breakdown

### Mode 1 Cycles

| Cycle ID                 | Spot | Short CE | Short PE | Exit Type | Net P&L (₹) | Whipsaw |                     Status                      |
| :----------------------- | :--: | :------: | :------: | :-------: | :---------: | :-----: | :---------------------------------------------: |
| 2026-05-04_to_2026-05-05 |  0   |    0     |    0     |  EXPIRY   |    ₹0.00    |   NO    | SKIPPED_INCOMPLETE_DATA (MISSING_EXIT_SNAPSHOT) |

### Mode 2 Cycles

| Cycle ID                 | Spot | Short CE | Short PE | Exit Type | Net P&L (₹) | Whipsaw |                     Status                      |
| :----------------------- | :--: | :------: | :------: | :-------: | :---------: | :-----: | :---------------------------------------------: |
| 2026-05-04_to_2026-05-05 |  0   |    0     |    0     |  EXPIRY   |    ₹0.00    |   NO    | SKIPPED_INCOMPLETE_DATA (MISSING_EXIT_SNAPSHOT) |

---

## 5. Summary Analysis & Commentary

- **Mode 1 (½-Premium Ratio)** sells 2 lots of T0 short contracts targeted at half the long premium. This collects higher initial net credit but carries unhedged tail risk on large directional moves.
- **Mode 2 (Same-Strike Calendar)** sells 2 lots at the exact same strike as the T1 long legs. This creates a delta-neutral calendar strangle with narrower short legs and different theta decay dynamics.
- **Data Gap Safeguard**: Any cycles with missing snapshots or gaps listed in `data/manifest.json` are automatically categorized as `SKIPPED_INCOMPLETE_DATA` to guarantee absolute historical data integrity without interpolation.
