import { DataLoader } from './dataLoader.js';
import { CycleDef, generateDayTimeStamps } from './cycles.js';
import { LegPosition, calculateLegPnlAndCharges, calculateLegMTM } from './pnl.js';
import { BacktestConfig } from './config.js';
import { getLtpForStrike } from './strikes.js';

export interface ExitResult {
  exitType: 'EXPIRY' | 'BREACH_LOSS' | 'BREACH_PROFIT';
  exitTimestamp: string;
  exitDay: string;
  exitTime: string;
  breachMtm?: number;
  isWhipsaw: boolean; // Flagged if breach occurred but exit MTM at 15:15 would have been > -1 * exitThreshold
  exitLtps: Record<string, number>; // leg symbol -> exit LTP
  finalCombinedMtmAt1515: number;
}

export function evaluateCycleExit(
  cycle: CycleDef,
  legs: LegPosition[],
  exitThreshold: number,
  dataLoader: DataLoader,
  config: BacktestConfig
): ExitResult {
  const dayTimes = generateDayTimeStamps();

  let breachTimestamp: string | null = null;
  let breachDay: string | null = null;
  let breachTime: string | null = null;
  let breachMtm = 0;
  let breachLtps: Record<string, number> = {};

  // Track final 15:15 exit LTPs
  let final1515Ltps: Record<string, number> = {};
  let final1515Mtm = 0;

  for (const day of cycle.tradingDays) {
    for (const time of dayTimes) {
      if (day === cycle.entryDate && time < cycle.entryTime) continue;
      if (day === cycle.exitDate && time > cycle.exitTime) continue;

      const t0Snap = dataLoader.loadSnapshot(day, time, cycle.T0Expiry);
      const t1Snap = dataLoader.loadSnapshot(day, time, cycle.T1Expiry);

      if (!t0Snap || !t1Snap) continue;

      const snapshotLtps: Record<string, number> = {};
      let currentMtm = 0;

      for (const leg of legs) {
        const snap = leg.expiry === 'T0' ? t0Snap : t1Snap;
        const ltp = getLtpForStrike(snap, leg.strike, leg.optionType) ?? leg.fillPremium;
        snapshotLtps[leg.symbol] = ltp;
        currentMtm += calculateLegMTM(leg, ltp, config.worthlessLtpThreshold);
      }

      if (day === cycle.exitDate && time === cycle.exitTime) {
        final1515Ltps = { ...snapshotLtps };
        final1515Mtm = currentMtm;
      }

      // Check threshold breach (first occurrence)
      if (!breachTimestamp && Math.abs(currentMtm) >= exitThreshold) {
        breachTimestamp = `${day}T${time.substring(0, 2)}:${time.substring(2, 4)}:00+05:30`;
        breachDay = day;
        breachTime = time;
        breachMtm = currentMtm;
        breachLtps = { ...snapshotLtps };
      }
    }
  }

  // Ensure final1515Ltps is populated
  if (Object.keys(final1515Ltps).length === 0) {
    const exitT0Snap = dataLoader.loadSnapshot(cycle.exitDate, cycle.exitTime, cycle.T0Expiry);
    const exitT1Snap = dataLoader.loadSnapshot(cycle.exitDate, cycle.exitTime, cycle.T1Expiry);
    for (const leg of legs) {
      const snap = leg.expiry === 'T0' ? exitT0Snap : exitT1Snap;
      const ltp = snap
        ? (getLtpForStrike(snap, leg.strike, leg.optionType) ?? leg.fillPremium)
        : leg.fillPremium;
      final1515Ltps[leg.symbol] = ltp;
      final1515Mtm += calculateLegMTM(leg, ltp, config.worthlessLtpThreshold);
    }
  }

  if (breachTimestamp && breachDay && breachTime) {
    const exitType = breachMtm < 0 ? 'BREACH_LOSS' : 'BREACH_PROFIT';
    // Whipsaw detection: breach occurred, but final MTM at 15:15 exit would have been > -1 * threshold (i.e. loss < 2%)
    const isWhipsaw = final1515Mtm > -1 * exitThreshold;

    return {
      exitType,
      exitTimestamp: breachTimestamp,
      exitDay: breachDay,
      exitTime: breachTime,
      breachMtm,
      isWhipsaw,
      exitLtps: breachLtps,
      finalCombinedMtmAt1515: final1515Mtm,
    };
  }

  // Normal Expiry Exit
  return {
    exitType: 'EXPIRY',
    exitTimestamp: `${cycle.exitDate}T${cycle.exitTime.substring(0, 2)}:${cycle.exitTime.substring(2, 4)}:00+05:30`,
    exitDay: cycle.exitDate,
    exitTime: cycle.exitTime,
    isWhipsaw: false,
    exitLtps: final1515Ltps,
    finalCombinedMtmAt1515: final1515Mtm,
  };
}
