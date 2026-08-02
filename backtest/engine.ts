import { DataLoader } from './dataLoader.js';
import { buildWeeklyCycles, CycleDef } from './cycles.js';
import { selectStrikes } from './strikes.js';
import { LegPosition, calculateLegPnlAndCharges } from './pnl.js';
import { evaluateCycleExit, ExitResult } from './exit.js';
import { BacktestConfig, defaultConfig } from './config.js';

export interface CycleResult {
  mode: 1 | 2;
  cycleId: string;
  entryDate: string;
  entryTime: string;
  exitDate: string;
  exitTime: string;
  T0Expiry: string;
  T1Expiry: string;
  spotLtp: number;
  longCEStrike: number;
  longCEPremium: number;
  longPEStrike: number;
  longPEPremium: number;
  shortCEStrike: number;
  shortCEPremium: number;
  shortPEStrike: number;
  shortPEPremium: number;
  exitType: 'EXPIRY' | 'BREACH_LOSS' | 'BREACH_PROFIT';
  exitTimestamp: string;
  isWhipsaw: boolean;
  utilisedMargin: number;
  exitThreshold: number;
  grossPnl: number;
  totalCharges: number;
  netPnl: number;
  netReturnPct: number;
  isBleed: boolean; // Expiry exit that ended net negative
  status: 'COMPLETED' | 'SKIPPED_INCOMPLETE_DATA';
  skipReason?: string;
}

export function runBacktestForMode(
  mode: 1 | 2,
  config: BacktestConfig = defaultConfig,
  fromDate?: string,
  toDate?: string
): CycleResult[] {
  const dataLoader = new DataLoader(config.dataRoot);
  const cycles = buildWeeklyCycles(dataLoader, fromDate, toDate);

  const results: CycleResult[] = [];

  for (const cycle of cycles) {
    if (!cycle.isValidData) {
      results.push({
        mode,
        cycleId: cycle.cycleId,
        entryDate: cycle.entryDate,
        entryTime: cycle.entryTime,
        exitDate: cycle.exitDate,
        exitTime: cycle.exitTime,
        T0Expiry: cycle.T0Expiry,
        T1Expiry: cycle.T1Expiry,
        spotLtp: 0,
        longCEStrike: 0,
        longCEPremium: 0,
        longPEStrike: 0,
        longPEPremium: 0,
        shortCEStrike: 0,
        shortCEPremium: 0,
        shortPEStrike: 0,
        shortPEPremium: 0,
        exitType: 'EXPIRY',
        exitTimestamp: '',
        isWhipsaw: false,
        utilisedMargin: config.fixedMarginPerStrangle,
        exitThreshold: config.fixedMarginPerStrangle * (config.exitThresholdPct / 100),
        grossPnl: 0,
        totalCharges: 0,
        netPnl: 0,
        netReturnPct: 0,
        isBleed: false,
        status: 'SKIPPED_INCOMPLETE_DATA',
        skipReason: cycle.skipReason,
      });
      continue;
    }

    try {
      const t0EntrySnap = dataLoader.loadSnapshot(cycle.entryDate, cycle.entryTime, cycle.T0Expiry);
      const t1EntrySnap = dataLoader.loadSnapshot(cycle.entryDate, cycle.entryTime, cycle.T1Expiry);

      if (!t0EntrySnap || !t1EntrySnap) {
        results.push({
          mode,
          cycleId: cycle.cycleId,
          entryDate: cycle.entryDate,
          entryTime: cycle.entryTime,
          exitDate: cycle.exitDate,
          exitTime: cycle.exitTime,
          T0Expiry: cycle.T0Expiry,
          T1Expiry: cycle.T1Expiry,
          spotLtp: 0,
          longCEStrike: 0,
          longCEPremium: 0,
          longPEStrike: 0,
          longPEPremium: 0,
          shortCEStrike: 0,
          shortCEPremium: 0,
          shortPEStrike: 0,
          shortPEPremium: 0,
          exitType: 'EXPIRY',
          exitTimestamp: '',
          isWhipsaw: false,
          utilisedMargin: config.fixedMarginPerStrangle,
          exitThreshold: config.fixedMarginPerStrangle * (config.exitThresholdPct / 100),
          grossPnl: 0,
          totalCharges: 0,
          netPnl: 0,
          netReturnPct: 0,
          isBleed: false,
          status: 'SKIPPED_INCOMPLETE_DATA',
          skipReason: 'ENTRY_SNAPSHOT_NULL',
        });
        continue;
      }

      const strikeSelection = selectStrikes(mode, t0EntrySnap, t1EntrySnap);

      // Margin estimation
      let margin = config.fixedMarginPerStrangle;
      if (config.marginMode === 'estimate') {
        const shortPremiumSum = (strikeSelection.shortCELtp + strikeSelection.shortPELtp) * 2;
        margin = shortPremiumSum * config.lotSize * 100 + 100000;
      }

      const exitThreshold = margin * (config.exitThresholdPct / 100);

      const legs: LegPosition[] = [
        {
          symbol: `NIFTY_${cycle.T1Expiry}_${strikeSelection.longCEStrike}CE`,
          strike: strikeSelection.longCEStrike,
          optionType: 'CE',
          expiry: 'T1',
          side: 'BUY',
          qty: config.lotSize,
          fillPremium: strikeSelection.longCELtp,
        },
        {
          symbol: `NIFTY_${cycle.T1Expiry}_${strikeSelection.longPEStrike}PE`,
          strike: strikeSelection.longPEStrike,
          optionType: 'PE',
          expiry: 'T1',
          side: 'BUY',
          qty: config.lotSize,
          fillPremium: strikeSelection.longPELtp,
        },
        {
          symbol: `NIFTY_${cycle.T0Expiry}_${strikeSelection.shortCEStrike}CE`,
          strike: strikeSelection.shortCEStrike,
          optionType: 'CE',
          expiry: 'T0',
          side: 'SELL',
          qty: config.lotSize * 2,
          fillPremium: strikeSelection.shortCELtp,
        },
        {
          symbol: `NIFTY_${cycle.T0Expiry}_${strikeSelection.shortPEStrike}PE`,
          strike: strikeSelection.shortPEStrike,
          optionType: 'PE',
          expiry: 'T0',
          side: 'SELL',
          qty: config.lotSize * 2,
          fillPremium: strikeSelection.shortPELtp,
        },
      ];

      const exitResult = evaluateCycleExit(cycle, legs, exitThreshold, dataLoader, config);

      let totalGrossPnl = 0;
      let totalCharges = 0;

      for (const leg of legs) {
        const exitLtp = exitResult.exitLtps[leg.symbol] ?? leg.fillPremium;
        const legPnlObj = calculateLegPnlAndCharges(leg, exitLtp, config);
        totalGrossPnl += legPnlObj.legPnl + legPnlObj.charges;
        totalCharges += legPnlObj.charges;
      }

      const netPnl = totalGrossPnl - totalCharges;
      const netReturnPct = (netPnl / margin) * 100;
      const isBleed = exitResult.exitType === 'EXPIRY' && netPnl < 0;

      results.push({
        mode,
        cycleId: cycle.cycleId,
        entryDate: cycle.entryDate,
        entryTime: cycle.entryTime,
        exitDate: cycle.exitDate,
        exitTime: cycle.exitTime,
        T0Expiry: cycle.T0Expiry,
        T1Expiry: cycle.T1Expiry,
        spotLtp: strikeSelection.spotLtp,
        longCEStrike: strikeSelection.longCEStrike,
        longCEPremium: strikeSelection.longCELtp,
        longPEStrike: strikeSelection.longPEStrike,
        longPEPremium: strikeSelection.longPELtp,
        shortCEStrike: strikeSelection.shortCEStrike,
        shortCEPremium: strikeSelection.shortCELtp,
        shortPEStrike: strikeSelection.shortPEStrike,
        shortPEPremium: strikeSelection.shortPELtp,
        exitType: exitResult.exitType,
        exitTimestamp: exitResult.exitTimestamp,
        isWhipsaw: exitResult.isWhipsaw,
        utilisedMargin: margin,
        exitThreshold,
        grossPnl: totalGrossPnl,
        totalCharges,
        netPnl,
        netReturnPct,
        isBleed,
        status: 'COMPLETED',
      });
    } catch (err: any) {
      results.push({
        mode,
        cycleId: cycle.cycleId,
        entryDate: cycle.entryDate,
        entryTime: cycle.entryTime,
        exitDate: cycle.exitDate,
        exitTime: cycle.exitTime,
        T0Expiry: cycle.T0Expiry,
        T1Expiry: cycle.T1Expiry,
        spotLtp: 0,
        longCEStrike: 0,
        longCEPremium: 0,
        longPEStrike: 0,
        longPEPremium: 0,
        shortCEStrike: 0,
        shortCEPremium: 0,
        shortPEStrike: 0,
        shortPEPremium: 0,
        exitType: 'EXPIRY',
        exitTimestamp: '',
        isWhipsaw: false,
        utilisedMargin: config.fixedMarginPerStrangle,
        exitThreshold: config.fixedMarginPerStrangle * (config.exitThresholdPct / 100),
        grossPnl: 0,
        totalCharges: 0,
        netPnl: 0,
        netReturnPct: 0,
        isBleed: false,
        status: 'SKIPPED_INCOMPLETE_DATA',
        skipReason: err.message,
      });
    }
  }

  return results;
}
