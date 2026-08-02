import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { CycleResult } from './engine.js';
import { PerformanceMetrics } from './metrics.js';

export function ensureReportsDirectory(): string {
  const dir = path.join(process.cwd(), 'backtest', 'reports');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function exportCyclesCsv(mode: 1 | 2, results: CycleResult[]): string {
  const dir = ensureReportsDirectory();
  const filePath = path.join(dir, `mode${mode}_cycles.csv`);

  const headers = [
    'cycleId',
    'status',
    'skipReason',
    'entryDate',
    'entryTime',
    'exitDate',
    'exitTime',
    'T0Expiry',
    'T1Expiry',
    'spotLtp',
    'longCEStrike',
    'longCEPremium',
    'longPEStrike',
    'longPEPremium',
    'shortCEStrike',
    'shortCEPremium',
    'shortPEStrike',
    'shortPEPremium',
    'exitType',
    'exitTimestamp',
    'isWhipsaw',
    'utilisedMargin',
    'exitThreshold',
    'grossPnl',
    'totalCharges',
    'netPnl',
    'netReturnPct',
    'isBleed',
  ];

  const rows = results.map((r) => [
    r.cycleId,
    r.status,
    r.skipReason || '',
    r.entryDate,
    r.entryTime,
    r.exitDate,
    r.exitTime,
    r.T0Expiry,
    r.T1Expiry,
    r.spotLtp,
    r.longCEStrike,
    r.longCEPremium.toFixed(2),
    r.longPEStrike,
    r.longPEPremium.toFixed(2),
    r.shortCEStrike,
    r.shortCEPremium.toFixed(2),
    r.shortPEStrike,
    r.shortPEPremium.toFixed(2),
    r.exitType,
    r.exitTimestamp,
    r.isWhipsaw ? 'TRUE' : 'FALSE',
    r.utilisedMargin,
    r.exitThreshold.toFixed(2),
    r.grossPnl.toFixed(2),
    r.totalCharges.toFixed(2),
    r.netPnl.toFixed(2),
    r.netReturnPct.toFixed(2),
    r.isBleed ? 'TRUE' : 'FALSE',
  ]);

  const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
  fs.writeFileSync(filePath, csvContent, 'utf8');
  return filePath;
}

export function generateMarkdownReport(
  m1Metrics?: PerformanceMetrics,
  m2Metrics?: PerformanceMetrics,
  m1Results: CycleResult[] = [],
  m2Results: CycleResult[] = []
): string {
  const dir = ensureReportsDirectory();
  const filePath = path.join(dir, 'comparison_report.md');

  const fmt = (num?: number, decimals = 2) =>
    num !== undefined && !isNaN(num) ? num.toFixed(decimals) : 'N/A';

  let md = `# Backtest Comparison Report: Nifty Weekly Calendar Ratio Strangle

**Generated At**: ${new Date().toISOString()}

---

## 1. Executive Strategy Summary Table

| Metric | Mode 1 (½-Premium Ratio) | Mode 2 (Same-Strike Calendar) |
| :--- | :---: | :---: |
| **Total Cycles Evaluated** | ${m1Metrics?.totalCyclesEvaluated ?? 'N/A'} | ${m2Metrics?.totalCyclesEvaluated ?? 'N/A'} |
| **Completed Cycles** | ${m1Metrics?.completedCycles ?? 'N/A'} | ${m2Metrics?.completedCycles ?? 'N/A'} |
| **Skipped Cycles** | ${m1Metrics?.skippedCycles ?? 'N/A'} | ${m2Metrics?.skippedCycles ?? 'N/A'} |
| **Total Net P&L (₹)** | **₹${fmt(m1Metrics?.totalNetPnl)}** | **₹${fmt(m2Metrics?.totalNetPnl)}** |
| **Total Gross P&L (₹)** | ₹${fmt(m1Metrics?.totalGrossPnl)} | ₹${fmt(m2Metrics?.totalGrossPnl)} |
| **Total Charges (₹)** | ₹${fmt(m1Metrics?.totalCharges)} | ₹${fmt(m2Metrics?.totalCharges)} |
| **Win Rate (%)** | ${fmt(m1Metrics?.winRatePct)}% | ${fmt(m2Metrics?.winRatePct)}% |
| **Average Win (₹)** | ₹${fmt(m1Metrics?.avgWinPnl)} | ₹${fmt(m2Metrics?.avgWinPnl)} |
| **Average Loss (₹)** | ₹${fmt(m1Metrics?.avgLossPnl)} | ₹${fmt(m2Metrics?.avgLossPnl)} |
| **Profit Factor** | ${fmt(m1Metrics?.profitFactor)} | ${fmt(m2Metrics?.profitFactor)} |
| **Expectancy / Cycle (₹)** | ₹${fmt(m1Metrics?.expectancyPerCycle)} | ₹${fmt(m2Metrics?.expectancyPerCycle)} |
| **Max Drawdown (₹)** | ₹${fmt(m1Metrics?.maxDrawdownAmount)} | ₹${fmt(m2Metrics?.maxDrawdownAmount)} |
| **Max Drawdown (%)** | ${fmt(m1Metrics?.maxDrawdownPct)}% | ${fmt(m2Metrics?.maxDrawdownPct)}% |
| **Sharpe Ratio (Annualized)** | ${fmt(m1Metrics?.sharpeRatio)} | ${fmt(m2Metrics?.sharpeRatio)} |

---

## 2. Exit Behaviour & Risk Breakdown

| Exit Event Metric | Mode 1 (½-Premium Ratio) | Mode 2 (Same-Strike Calendar) |
| :--- | :---: | :---: |
| **P(Breach Loss)** | ${fmt(m1Metrics?.probBreachLossPct)}% | ${fmt(m2Metrics?.probBreachLossPct)}% |
| **P(Breach Profit)** | ${fmt(m1Metrics?.probBreachProfitPct)}% | ${fmt(m2Metrics?.probBreachProfitPct)}% |
| **P(Normal Expiry)** | ${fmt(m1Metrics?.probExpiryPct)}% | ${fmt(m2Metrics?.probExpiryPct)}% |
| **Avg Loss When Breached (₹)** | ₹${fmt(m1Metrics?.avgLossWhenBreached)} | ₹${fmt(m2Metrics?.avgLossWhenBreached)} |
| **Whipsaw Rate (%)** | ${fmt(m1Metrics?.whipsawRatePct)}% | ${fmt(m2Metrics?.whipsawRatePct)}% |
| **Expiry Bleed Rate (%)** | ${fmt(m1Metrics?.expiryBleedRatePct)}% | ${fmt(m2Metrics?.expiryBleedRatePct)}% |

---

## 3. Performance Charts

![Equity Curves](file:///${path.join(dir, 'equity_curves.png').replace(/\\/g, '/')})
![P&L Distribution](file:///${path.join(dir, 'pnl_distribution.png').replace(/\\/g, '/')})

---

## 4. Per-Cycle Detail Breakdown

### Mode 1 Cycles
| Cycle ID | Spot | Short CE | Short PE | Exit Type | Net P&L (₹) | Whipsaw | Status |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
${m1Results
  .map(
    (r) =>
      `| ${r.cycleId} | ${r.spotLtp} | ${r.shortCEStrike} | ${r.shortPEStrike} | ${r.exitType} | ₹${r.netPnl.toFixed(2)} | ${r.isWhipsaw ? 'YES' : 'NO'} | ${r.status}${r.skipReason ? ` (${r.skipReason})` : ''} |`
  )
  .join('\n')}

### Mode 2 Cycles
| Cycle ID | Spot | Short CE | Short PE | Exit Type | Net P&L (₹) | Whipsaw | Status |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
${m2Results
  .map(
    (r) =>
      `| ${r.cycleId} | ${r.spotLtp} | ${r.shortCEStrike} | ${r.shortPEStrike} | ${r.exitType} | ₹${r.netPnl.toFixed(2)} | ${r.isWhipsaw ? 'YES' : 'NO'} | ${r.status}${r.skipReason ? ` (${r.skipReason})` : ''} |`
  )
  .join('\n')}

---

## 5. Summary Analysis & Commentary

- **Mode 1 (½-Premium Ratio)** sells 2 lots of T0 short contracts targeted at half the long premium. This collects higher initial net credit but carries unhedged tail risk on large directional moves.
- **Mode 2 (Same-Strike Calendar)** sells 2 lots at the exact same strike as the T1 long legs. This creates a delta-neutral calendar strangle with narrower short legs and different theta decay dynamics.
- **Data Gap Safeguard**: Any cycles with missing snapshots or gaps listed in \`data/manifest.json\` are automatically categorized as \`SKIPPED_INCOMPLETE_DATA\` to guarantee absolute historical data integrity without interpolation.
`;

  fs.writeFileSync(filePath, md, 'utf8');
  return filePath;
}

export async function generateCharts(): Promise<void> {
  return new Promise((resolve, reject) => {
    const pythonScript = path.join(process.cwd(), 'backtest', 'scripts', 'plot.py');
    if (!fs.existsSync(pythonScript)) {
      console.warn(`[REPORT] Plot script not found at ${pythonScript}`);
      resolve();
      return;
    }

    const py = spawn('python3', [pythonScript], { stdio: 'inherit' });

    py.on('close', (code) => {
      if (code === 0) {
        console.log('[REPORT] Charts generated successfully via Python script.');
      } else {
        console.warn(
          `[REPORT] Python plotting exited with code ${code}. Continuing without blocking.`
        );
      }
      resolve();
    });

    py.on('error', (err) => {
      console.warn(
        `[REPORT] Could not launch python3 for charts: ${err.message}. Skipping chart plotting.`
      );
      resolve();
    });
  });
}
