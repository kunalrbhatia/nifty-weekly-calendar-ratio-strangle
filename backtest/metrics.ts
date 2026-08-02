import { CycleResult } from './engine.js';

export interface PerformanceMetrics {
  mode: 1 | 2;
  totalCyclesEvaluated: number;
  completedCycles: number;
  skippedCycles: number;
  totalNetPnl: number;
  totalGrossPnl: number;
  totalCharges: number;
  winRatePct: number;
  avgWinPnl: number;
  avgLossPnl: number;
  profitFactor: number;
  maxDrawdownAmount: number;
  maxDrawdownPct: number;
  expectancyPerCycle: number;
  sharpeRatio: number;
  // Exit behaviour breakdown
  probBreachLossPct: number;
  probBreachProfitPct: number;
  probExpiryPct: number;
  avgLossWhenBreached: number;
  whipsawRatePct: number;
  expiryBleedRatePct: number;
}

export function computeMetrics(results: CycleResult[]): PerformanceMetrics {
  const mode = results[0]?.mode ?? 1;
  const completed = results.filter((r) => r.status === 'COMPLETED');
  const skipped = results.filter((r) => r.status === 'SKIPPED_INCOMPLETE_DATA');

  const totalCyclesEvaluated = results.length;
  const completedCycles = completed.length;
  const skippedCycles = skipped.length;

  if (completedCycles === 0) {
    return {
      mode,
      totalCyclesEvaluated,
      completedCycles: 0,
      skippedCycles,
      totalNetPnl: 0,
      totalGrossPnl: 0,
      totalCharges: 0,
      winRatePct: 0,
      avgWinPnl: 0,
      avgLossPnl: 0,
      profitFactor: 0,
      maxDrawdownAmount: 0,
      maxDrawdownPct: 0,
      expectancyPerCycle: 0,
      sharpeRatio: 0,
      probBreachLossPct: 0,
      probBreachProfitPct: 0,
      probExpiryPct: 0,
      avgLossWhenBreached: 0,
      whipsawRatePct: 0,
      expiryBleedRatePct: 0,
    };
  }

  const wins = completed.filter((r) => r.netPnl > 0);
  const losses = completed.filter((r) => r.netPnl <= 0);

  const winRatePct = (wins.length / completedCycles) * 100;

  const totalWinPnl = wins.reduce((sum, r) => sum + r.netPnl, 0);
  const totalLossPnl = Math.abs(losses.reduce((sum, r) => sum + r.netPnl, 0));

  const avgWinPnl = wins.length > 0 ? totalWinPnl / wins.length : 0;
  const avgLossPnl = losses.length > 0 ? totalLossPnl / losses.length : 0;

  const profitFactor =
    totalLossPnl > 0 ? totalWinPnl / totalLossPnl : totalWinPnl > 0 ? Infinity : 0;

  const totalNetPnl = completed.reduce((sum, r) => sum + r.netPnl, 0);
  const totalGrossPnl = completed.reduce((sum, r) => sum + r.grossPnl, 0);
  const totalCharges = completed.reduce((sum, r) => sum + r.totalCharges, 0);

  // Expectancy per cycle
  const expectancyPerCycle = totalNetPnl / completedCycles;

  // Max Drawdown calculation over equity curve
  let peak = 0;
  let cumulative = 0;
  let maxDrawdownAmount = 0;
  let maxDrawdownPct = 0;

  for (const r of completed) {
    cumulative += r.netPnl;
    if (cumulative > peak) {
      peak = cumulative;
    }
    const dd = peak - cumulative;
    if (dd > maxDrawdownAmount) {
      maxDrawdownAmount = dd;
      maxDrawdownPct = r.utilisedMargin > 0 ? (maxDrawdownAmount / r.utilisedMargin) * 100 : 0;
    }
  }

  // Sharpe Ratio (assuming risk-free rate = 0)
  const returns = completed.map((r) => r.netPnl);
  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((a, b) => a + Math.pow(b - meanReturn, 2), 0) /
    (returns.length > 1 ? returns.length - 1 : 1);
  const stdDev = Math.sqrt(variance);
  // Annualize assuming 52 weekly cycles per year
  const sharpeRatio = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(52) : 0;

  // Exit behavior breakdown
  const breachLosses = completed.filter((r) => r.exitType === 'BREACH_LOSS');
  const breachProfits = completed.filter((r) => r.exitType === 'BREACH_PROFIT');
  const expiryExits = completed.filter((r) => r.exitType === 'EXPIRY');

  const probBreachLossPct = (breachLosses.length / completedCycles) * 100;
  const probBreachProfitPct = (breachProfits.length / completedCycles) * 100;
  const probExpiryPct = (expiryExits.length / completedCycles) * 100;

  const totalBreachLossPnl = breachLosses.reduce((sum, r) => sum + r.netPnl, 0);
  const avgLossWhenBreached =
    breachLosses.length > 0 ? Math.abs(totalBreachLossPnl / breachLosses.length) : 0;

  const whipsaws = completed.filter((r) => r.isWhipsaw);
  const whipsawRatePct = (whipsaws.length / completedCycles) * 100;

  const bleeds = expiryExits.filter((r) => r.isBleed);
  const expiryBleedRatePct =
    expiryExits.length > 0 ? (bleeds.length / expiryExits.length) * 100 : 0;

  return {
    mode,
    totalCyclesEvaluated,
    completedCycles,
    skippedCycles,
    totalNetPnl,
    totalGrossPnl,
    totalCharges,
    winRatePct,
    avgWinPnl,
    avgLossPnl,
    profitFactor,
    maxDrawdownAmount,
    maxDrawdownPct,
    expectancyPerCycle,
    sharpeRatio,
    probBreachLossPct,
    probBreachProfitPct,
    probExpiryPct,
    avgLossWhenBreached,
    whipsawRatePct,
    expiryBleedRatePct,
  };
}
