import { defaultConfig, BacktestConfig } from './config.js';
import { runBacktestForMode, CycleResult } from './engine.js';
import { computeMetrics, PerformanceMetrics } from './metrics.js';
import {
  exportCyclesCsv,
  generateMarkdownReport,
  generateCharts,
  ensureReportsDirectory,
} from './report.js';

function parseArgs(): {
  mode: '1' | '2' | 'both';
  fromDate?: string;
  toDate?: string;
  margin?: number;
} {
  const args = process.argv.slice(2);
  let mode: '1' | '2' | 'both' = 'both';
  let fromDate: string | undefined;
  let toDate: string | undefined;
  let margin: number | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode' && i + 1 < args.length) {
      const val = args[i + 1];
      if (val === '1' || val === '2' || val === 'both') {
        mode = val;
      }
      i++;
    } else if (args[i] === '--from' && i + 1 < args.length) {
      fromDate = args[i + 1];
      i++;
    } else if (args[i] === '--to' && i + 1 < args.length) {
      toDate = args[i + 1];
      i++;
    } else if (args[i] === '--margin' && i + 1 < args.length) {
      const m = parseFloat(args[i + 1]);
      if (!isNaN(m) && m > 0) {
        margin = m;
      }
      i++;
    }
  }

  return { mode, fromDate, toDate, margin };
}

async function main() {
  const { mode, fromDate, toDate, margin } = parseArgs();

  const config: BacktestConfig = {
    ...defaultConfig,
    ...(margin ? { fixedMarginPerStrangle: margin } : {}),
  };

  console.log('====================================================');
  console.log('🚀 Starting Nifty Weekly Calendar Ratio Strangle Backtest');
  console.log(`- Data Root: ${config.dataRoot}`);
  console.log(`- Mode requested: ${mode}`);
  console.log(`- Date range: ${fromDate || 'earliest'} to ${toDate || 'latest'}`);
  console.log(
    `- Margin model: ${config.marginMode} (₹${config.fixedMarginPerStrangle.toLocaleString()})`
  );
  console.log('====================================================\n');

  ensureReportsDirectory();

  let m1Results: CycleResult[] = [];
  let m2Results: CycleResult[] = [];
  let m1Metrics: PerformanceMetrics | undefined;
  let m2Metrics: PerformanceMetrics | undefined;

  if (mode === '1' || mode === 'both') {
    console.log('🔄 Running Backtest for Mode 1 (½-Premium Ratio)...');
    m1Results = runBacktestForMode(1, config, fromDate, toDate);
    m1Metrics = computeMetrics(m1Results);
    const csvPath = exportCyclesCsv(1, m1Results);
    console.log(`✓ Mode 1 complete. Exported ${m1Results.length} cycle records to ${csvPath}`);
  }

  if (mode === '2' || mode === 'both') {
    console.log('🔄 Running Backtest for Mode 2 (Same-Strike Calendar)...');
    m2Results = runBacktestForMode(2, config, fromDate, toDate);
    m2Metrics = computeMetrics(m2Results);
    const csvPath = exportCyclesCsv(2, m2Results);
    console.log(`✓ Mode 2 complete. Exported ${m2Results.length} cycle records to ${csvPath}`);
  }

  // Generate charts
  await generateCharts();

  // Generate Markdown report
  const reportPath = generateMarkdownReport(m1Metrics, m2Metrics, m1Results, m2Results);
  console.log(`\n📄 Summary Markdown Report saved to: ${reportPath}`);

  // Console Summary Output
  console.log('\n====================================================');
  console.log('📊 BACKTEST PERFORMANCE SUMMARY');
  console.log('====================================================');

  if (m1Metrics) {
    console.log('\n--- MODE 1 (½-PREMIUM RATIO) ---');
    console.log(
      `Evaluated / Completed Cycles: ${m1Metrics.totalCyclesEvaluated} / ${m1Metrics.completedCycles}`
    );
    console.log(`Skipped Cycles (Incomplete Data): ${m1Metrics.skippedCycles}`);
    console.log(`Total Net P&L: ₹${m1Metrics.totalNetPnl.toFixed(2)}`);
    console.log(`Win Rate: ${m1Metrics.winRatePct.toFixed(1)}%`);
    console.log(`Profit Factor: ${m1Metrics.profitFactor.toFixed(2)}`);
    console.log(`Expectancy / Cycle: ₹${m1Metrics.expectancyPerCycle.toFixed(2)}`);
    console.log(
      `Max Drawdown: ₹${m1Metrics.maxDrawdownAmount.toFixed(2)} (${m1Metrics.maxDrawdownPct.toFixed(2)}%)`
    );
    console.log(
      `P(Breach Loss): ${m1Metrics.probBreachLossPct.toFixed(1)}% | Whipsaw Rate: ${m1Metrics.whipsawRatePct.toFixed(1)}% | Expiry Bleed Rate: ${m1Metrics.expiryBleedRatePct.toFixed(1)}%`
    );
  }

  if (m2Metrics) {
    console.log('\n--- MODE 2 (SAME-STRIKE CALENDAR) ---');
    console.log(
      `Evaluated / Completed Cycles: ${m2Metrics.totalCyclesEvaluated} / ${m2Metrics.completedCycles}`
    );
    console.log(`Skipped Cycles (Incomplete Data): ${m2Metrics.skippedCycles}`);
    console.log(`Total Net P&L: ₹${m2Metrics.totalNetPnl.toFixed(2)}`);
    console.log(`Win Rate: ${m2Metrics.winRatePct.toFixed(1)}%`);
    console.log(`Profit Factor: ${m2Metrics.profitFactor.toFixed(2)}`);
    console.log(`Expectancy / Cycle: ₹${m2Metrics.expectancyPerCycle.toFixed(2)}`);
    console.log(
      `Max Drawdown: ₹${m2Metrics.maxDrawdownAmount.toFixed(2)} (${m2Metrics.maxDrawdownPct.toFixed(2)}%)`
    );
    console.log(
      `P(Breach Loss): ${m2Metrics.probBreachLossPct.toFixed(1)}% | Whipsaw Rate: ${m2Metrics.whipsawRatePct.toFixed(1)}% | Expiry Bleed Rate: ${m2Metrics.expiryBleedRatePct.toFixed(1)}%`
    );
  }

  console.log('====================================================\n');
}

main().catch((err) => {
  console.error('Fatal backtest error:', err);
  process.exit(1);
});
