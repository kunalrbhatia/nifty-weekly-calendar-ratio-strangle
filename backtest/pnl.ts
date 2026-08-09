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
  // 1. Brokerage: ₹20 per executed order (entry order always; exit order only if CLOSED)
  const orderCount = exitStatus === 'CLOSED' ? 2 : 1;
  const brokerage = orderCount * config.chargesPerOrder;

  // 2. STT: 0.125% of sell-side premium turnover only
  let sellTurnover = 0;
  if (leg.side === 'SELL') {
    sellTurnover += leg.fillPremium * leg.qty;
  }
  if (leg.side === 'BUY' && exitStatus === 'CLOSED') {
    sellTurnover += exitPrice * leg.qty;
  }
  const stt = sellTurnover * config.sttRateOnSellPremium;

  // 3. Exchange transaction charge: applied to total premium turnover (buy + sell, entry and exit if executed)
  let totalTurnover = leg.fillPremium * leg.qty;
  if (exitStatus === 'CLOSED') {
    totalTurnover += exitPrice * leg.qty;
  }
  const exchangeTxnCharge = totalTurnover * config.exchangeTxnRate;

  // 4. GST: 18% applied to (brokerage + exchange transaction charge)
  const gst = (brokerage + exchangeTxnCharge) * config.gstRate;

  // 5. SEBI fee: 0.0001% (₹10/crore) applied to total premium turnover
  const sebiFee = totalTurnover * config.sebiRate;

  const charges = brokerage + stt + exchangeTxnCharge + gst + sebiFee;

  return { legPnl: grossPnl - charges, charges, exitStatus };
}
