import { BacktestConfig } from './config.js';

export interface LegPosition {
  symbol: string;
  strike: number;
  optionType: 'CE' | 'PE';
  expiry: 'T0' | 'T1';
  side: 'BUY' | 'SELL';
  qty: number;
  fillPremium: number;
  exitPremium?: number;
  exitStatus?: 'CLOSED' | 'EXPIRED_UNBOOKED';
}

export function calculateLegMTM(
  leg: LegPosition,
  currentLtp: number,
  worthlessThreshold: number
): number {
  const markLtp = currentLtp <= worthlessThreshold ? 0 : currentLtp;
  if (leg.side === 'BUY') {
    return (markLtp - leg.fillPremium) * leg.qty;
  } else {
    return (leg.fillPremium - markLtp) * leg.qty;
  }
}

export function calculatePositionMTM(
  legs: LegPosition[],
  ltpMap: Record<string, number>,
  worthlessThreshold: number
): number {
  let totalMtm = 0;
  for (const leg of legs) {
    const ltp = ltpMap[leg.symbol] ?? leg.fillPremium;
    totalMtm += calculateLegMTM(leg, ltp, worthlessThreshold);
  }
  return totalMtm;
}

export function calculateLegPnlAndCharges(
  leg: LegPosition,
  exitLtp: number,
  config: BacktestConfig
): { legPnl: number; charges: number; exitStatus: 'CLOSED' | 'EXPIRED_UNBOOKED' } {
  let exitStatus: 'CLOSED' | 'EXPIRED_UNBOOKED' = 'CLOSED';
  let exitPrice = exitLtp;

  if (exitLtp <= config.worthlessLtpThreshold) {
    exitStatus = 'EXPIRED_UNBOOKED';
    exitPrice = 0;
  }

  let grossPnl = 0;
  if (leg.side === 'BUY') {
    grossPnl = (exitPrice - leg.fillPremium) * leg.qty;
  } else {
    grossPnl = (leg.fillPremium - exitPrice) * leg.qty;
  }

  // Calculate charges:
  // Entry order + Exit order (if CLOSED). If EXPIRED_UNBOOKED, no exit order executed.
  let orderCount = 1;
  if (exitStatus === 'CLOSED') {
    orderCount = 2;
  }
  const brokerage = orderCount * config.chargesPerOrder;

  // STT on sell side turnover
  let sellTurnover = 0;
  if (leg.side === 'SELL') {
    sellTurnover += leg.fillPremium * leg.qty;
  }
  if (leg.side === 'BUY' && exitStatus === 'CLOSED') {
    sellTurnover += exitPrice * leg.qty;
  }

  const stt = sellTurnover * config.sttRateOnSellPremium;
  const charges = brokerage + stt;

  return { legPnl: grossPnl - charges, charges, exitStatus };
}
