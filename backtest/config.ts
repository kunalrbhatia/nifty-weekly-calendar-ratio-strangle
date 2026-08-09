import path from 'path';

export interface BacktestConfig {
  dataRoot: string;
  marginMode: 'fixed' | 'estimate';
  fixedMarginPerStrangle: number;
  exitThresholdPct: number;
  lotSize: number;
  worthlessLtpThreshold: number;
  chargesPerOrder: number; // Brokerage per order (e.g. ₹20)
  sttRateOnSellPremium: number; // STT on sell turnover (0.00125 = 0.125%)
  exchangeTxnRate: number; // Exchange transaction charge on total turnover (0.0005 = 0.05%)
  gstRate: number; // GST on brokerage + exchange charges (0.18 = 18%)
  sebiRate: number; // SEBI fee on total turnover (0.000001 = ₹10/crore = 0.0001%)
}

export const defaultConfig: BacktestConfig = {
  dataRoot: path.resolve(process.cwd(), '../nifty-optionchain-data'),
  marginMode: 'fixed',
  fixedMarginPerStrangle: 337134, // Measured real value for 4-leg position as of live entry
  exitThresholdPct: 2.0, // 2%
  lotSize: 65,
  worthlessLtpThreshold: 5.0, // ₹5
  chargesPerOrder: 20, // ₹20 flat brokerage per executed leg order
  sttRateOnSellPremium: 0.00125, // 0.125% STT on sell option premium turnover
  exchangeTxnRate: 0.0005, // ~0.05% exchange transaction charge on total premium turnover
  gstRate: 0.18, // 18% GST on (brokerage + exchange transaction charges)
  sebiRate: 0.000001, // ₹10 per crore (0.0001%) of total premium turnover
};
