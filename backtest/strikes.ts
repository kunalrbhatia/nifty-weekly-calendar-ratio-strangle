import { ChainSnapshot, OptionRow } from './dataLoader.js';

export interface StrikeSelectionResult {
  spotLtp: number;
  longCEStrike: number;
  longCELtp: number;
  longPEStrike: number;
  longPELtp: number;
  shortCEStrike: number;
  shortCELtp: number;
  shortPEStrike: number;
  shortPELtp: number;
}

export function roundStrikeToNearest100(spotDerivedStrike: number): number {
  return Math.round(spotDerivedStrike / 100) * 100;
}

export function getLtpForStrike(
  snapshot: ChainSnapshot,
  strike: number,
  type: 'CE' | 'PE'
): number | null {
  const row = snapshot.rows.find((r) => Math.round(r.strike_price) === strike);
  if (!row) return null;
  return type === 'CE' ? row.calls_ltp : row.puts_ltp;
}

export function selectStrikes(
  mode: 1 | 2,
  t0EntrySnapshot: ChainSnapshot,
  t1EntrySnapshot: ChainSnapshot
): StrikeSelectionResult {
  const spotLtp = t1EntrySnapshot.index_close || t0EntrySnapshot.index_close;
  if (!spotLtp || spotLtp <= 0) {
    throw new Error(`Invalid spot LTP: ${spotLtp}`);
  }

  // 1. Long legs on T1
  const longCEStrike = roundStrikeToNearest100(spotLtp + 500);
  const longPEStrike = roundStrikeToNearest100(spotLtp - 500);

  const longCELtp = getLtpForStrike(t1EntrySnapshot, longCEStrike, 'CE');
  const longPELtp = getLtpForStrike(t1EntrySnapshot, longPEStrike, 'PE');

  if (longCELtp === null || longPELtp === null) {
    throw new Error(
      `Long strike contract not found in T1 entry snapshot for CE ${longCEStrike} or PE ${longPEStrike}`
    );
  }

  let shortCEStrike: number;
  let shortPEStrike: number;
  let shortCELtp: number;
  let shortPELtp: number;

  if (mode === 2) {
    // Mode 2: Same strike calendar
    shortCEStrike = longCEStrike;
    shortPEStrike = longPEStrike;

    const ceLtp = getLtpForStrike(t0EntrySnapshot, shortCEStrike, 'CE');
    const peLtp = getLtpForStrike(t0EntrySnapshot, shortPEStrike, 'PE');

    if (ceLtp === null || peLtp === null) {
      throw new Error(
        `Mode 2 short strike contract not found in T0 entry snapshot for CE ${shortCEStrike} or PE ${shortPEStrike}`
      );
    }
    shortCELtp = ceLtp;
    shortPELtp = peLtp;
  } else {
    // Mode 1: ½-premium ratio
    const targetCE = longCELtp / 2;
    const targetPE = longPELtp / 2;

    // Filter candidate rows: 100-multiple strikes within ±1500 of spot
    const candidateRows = t0EntrySnapshot.rows.filter((row) => {
      const strike = Math.round(row.strike_price);
      if (strike % 100 !== 0) return false;
      return Math.abs(strike - spotLtp) <= 1500;
    });

    const selectShortLeg = (target: number, type: 'CE' | 'PE'): { strike: number; ltp: number } => {
      let bestRow: OptionRow | null = null;
      let bestDiff = Infinity;

      for (const row of candidateRows) {
        const ltp = type === 'CE' ? row.calls_ltp : row.puts_ltp;
        if (ltp <= 0) continue;
        if (ltp < target) continue; // Only strikes with LTP >= target

        const diff = Math.abs(ltp - target);
        const currentStrike = Math.round(row.strike_price);

        if (diff < bestDiff) {
          bestDiff = diff;
          bestRow = row;
        } else if (diff === bestDiff && bestRow) {
          const bestStrike = Math.round(bestRow.strike_price);
          // Tie-break: farther OTM (higher CE / lower PE)
          if (type === 'CE' && currentStrike > bestStrike) {
            bestRow = row;
          } else if (type === 'PE' && currentStrike < bestStrike) {
            bestRow = row;
          }
        }
      }

      if (!bestRow) {
        throw new Error(`No workable short strike found for ${type} with target ${target}`);
      }

      const strike = Math.round(bestRow.strike_price);
      const ltp = type === 'CE' ? bestRow.calls_ltp : bestRow.puts_ltp;
      return { strike, ltp };
    };

    const ceResult = selectShortLeg(targetCE, 'CE');
    const peResult = selectShortLeg(targetPE, 'PE');

    shortCEStrike = ceResult.strike;
    shortCELtp = ceResult.ltp;
    shortPEStrike = peResult.strike;
    shortPELtp = peResult.ltp;
  }

  return {
    spotLtp,
    longCEStrike,
    longCELtp,
    longPEStrike,
    longPELtp,
    shortCEStrike,
    shortCELtp,
    shortPEStrike,
    shortPELtp,
  };
}
