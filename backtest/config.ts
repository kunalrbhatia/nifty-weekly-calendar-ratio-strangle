import path from 'path';

export interface BacktestConfig {
  dataRoot: string;
  marginMode: 'fixed' | 'estimate';
  fixedMarginPerStrangle: number;
  exitThresholdPct: number;
  lotSize: number;
  worthlessLtpThreshold: number;
  chargesPerOrder: number; // Brokerage per order (e.g. ₹20)
  sttRateOnSellPremium: number; // STT on sell turnover (e.g. 0.00125 = 0.125%)
}

export const defaultConfig: BacktestConfig = {
  dataRoot: path.resolve(process.cwd(), '../nifty-optionchain-data'),
  marginMode: 'fixed',
  fixedMarginPerStrangle: 180000,
  exitThresholdPct: 2.0, // 2%
  lotSize: 65,
  worthlessLtpThreshold: 5.0, // ₹5
  chargesPerOrder: 20, // ₹20 flat brokerage per executed leg order
  sttRateOnSellPremium: 0.00125, // 0.125% STT on sell option premium turnover
};
