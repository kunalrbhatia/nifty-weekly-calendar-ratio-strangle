import { selectStrikes } from './strikes.js';
import { calculateLegPnlAndCharges, calculateLegMTM, calculatePositionMTM } from './pnl.js';
import { defaultConfig } from './config.js';
import { ChainSnapshot } from './dataLoader.js';

describe('Backtest Unit Tests: strikes & pnl', () => {
  const dummyT0Snapshot: ChainSnapshot = {
    source: 'optionperks',
    symbol_name: 'NIFTY',
    expiry_date: '2026-05-05',
    snapshot_time: '2026-05-04T09:45:00+05:30',
    index_close: 24200,
    greeks_available: true,
    rows: [
      {
        strike_price: 24700,
        call_inst_type: 'NFO:NIFTY2650524700CE',
        calls_ltp: 40.0,
        calls_iv: 14,
        calls_oi: 100,
        calls_volume: 10,
        calls_delta: 0.2,
        calls_gamma: 0,
        calls_theta: -5,
        calls_vega: 0,
        put_inst_type: 'NFO:NIFTY2650524700PE',
        puts_ltp: 500.0,
        puts_iv: 14,
        puts_oi: 100,
        puts_volume: 10,
        puts_delta: -0.8,
        puts_gamma: 0,
        puts_theta: -5,
        puts_vega: 0,
      },
      {
        strike_price: 23700,
        call_inst_type: 'NFO:NIFTY2650523700CE',
        calls_ltp: 500.0,
        calls_iv: 14,
        calls_oi: 100,
        calls_volume: 10,
        calls_delta: 0.8,
        calls_gamma: 0,
        calls_theta: -5,
        calls_vega: 0,
        put_inst_type: 'NFO:NIFTY2650523700PE',
        puts_ltp: 40.0,
        puts_iv: 14,
        puts_oi: 100,
        puts_volume: 10,
        puts_delta: -0.2,
        puts_gamma: 0,
        puts_theta: -5,
        puts_vega: 0,
      },
      {
        strike_price: 24600,
        call_inst_type: 'NFO:NIFTY2650524600CE',
        calls_ltp: 45.0,
        calls_iv: 14,
        calls_oi: 100,
        calls_volume: 10,
        calls_delta: 0.25,
        calls_gamma: 0,
        calls_theta: -5,
        calls_vega: 0,
        put_inst_type: 'NFO:NIFTY2650524600PE',
        puts_ltp: 450.0,
        puts_iv: 14,
        puts_oi: 100,
        puts_volume: 10,
        puts_delta: -0.75,
        puts_gamma: 0,
        puts_theta: -5,
        puts_vega: 0,
      },
      {
        strike_price: 23800,
        call_inst_type: 'NFO:NIFTY2650523800CE',
        calls_ltp: 450.0,
        calls_iv: 14,
        calls_oi: 100,
        calls_volume: 10,
        calls_delta: 0.75,
        calls_gamma: 0,
        calls_theta: -5,
        calls_vega: 0,
        put_inst_type: 'NFO:NIFTY2650523800PE',
        puts_ltp: 45.0,
        puts_iv: 14,
        puts_oi: 100,
        puts_volume: 10,
        puts_delta: -0.25,
        puts_gamma: 0,
        puts_theta: -5,
        puts_vega: 0,
      },
    ],
  };

  const dummyT1Snapshot: ChainSnapshot = {
    source: 'optionperks',
    symbol_name: 'NIFTY',
    expiry_date: '2026-05-12',
    snapshot_time: '2026-05-04T09:45:00+05:30',
    index_close: 24200,
    greeks_available: true,
    rows: [
      {
        strike_price: 24700,
        call_inst_type: 'NFO:NIFTY2651224700CE',
        calls_ltp: 80.0,
        calls_iv: 14,
        calls_oi: 100,
        calls_volume: 10,
        calls_delta: 0.3,
        calls_gamma: 0,
        calls_theta: -5,
        calls_vega: 0,
        put_inst_type: 'NFO:NIFTY2651224700PE',
        puts_ltp: 550.0,
        puts_iv: 14,
        puts_oi: 100,
        puts_volume: 10,
        puts_delta: -0.7,
        puts_gamma: 0,
        puts_theta: -5,
        puts_vega: 0,
      },
      {
        strike_price: 23700,
        call_inst_type: 'NFO:NIFTY2651223700CE',
        calls_ltp: 550.0,
        calls_iv: 14,
        calls_oi: 100,
        calls_volume: 10,
        calls_delta: 0.7,
        calls_gamma: 0,
        calls_theta: -5,
        calls_vega: 0,
        put_inst_type: 'NFO:NIFTY2651223700PE',
        puts_ltp: 80.0,
        puts_iv: 14,
        puts_oi: 100,
        puts_volume: 10,
        puts_delta: -0.3,
        puts_gamma: 0,
        puts_theta: -5,
        puts_vega: 0,
      },
    ],
  };

  test('Strike Selection Mode 2 (Same-Strike Calendar)', () => {
    const selection = selectStrikes(2, dummyT0Snapshot, dummyT1Snapshot);
    expect(selection.spotLtp).toBe(24200);
    expect(selection.longCEStrike).toBe(24700);
    expect(selection.longPEStrike).toBe(23700);
    expect(selection.shortCEStrike).toBe(24700);
    expect(selection.shortPEStrike).toBe(23700);
    expect(selection.longCELtp).toBe(80);
    expect(selection.shortCELtp).toBe(40);
  });

  test('Strike Selection Mode 1 (½-Premium Ratio) with Tie-Break', () => {
    // Modify dummyT0Snapshot to have tie-break rows with same diff but farther OTM strike
    const tieBreakT0Snap: ChainSnapshot = {
      ...dummyT0Snapshot,
      rows: [
        ...dummyT0Snapshot.rows,
        {
          strike_price: 24800, // farther OTM CE strike with same LTP 40
          call_inst_type: 'NFO:NIFTY2650524800CE',
          calls_ltp: 40.0,
          calls_iv: 14,
          calls_oi: 100,
          calls_volume: 10,
          calls_delta: 0.15,
          calls_gamma: 0,
          calls_theta: -5,
          calls_vega: 0,
          put_inst_type: 'NFO:NIFTY2650524800PE',
          puts_ltp: 600.0,
          puts_iv: 14,
          puts_oi: 100,
          puts_volume: 10,
          puts_delta: -0.85,
          puts_gamma: 0,
          puts_theta: -5,
          puts_vega: 0,
        },
        {
          strike_price: 23600, // farther OTM PE strike with same LTP 40
          call_inst_type: 'NFO:NIFTY2650523600CE',
          calls_ltp: 600.0,
          calls_iv: 14,
          calls_oi: 100,
          calls_volume: 10,
          calls_delta: 0.85,
          calls_gamma: 0,
          calls_theta: -5,
          calls_vega: 0,
          put_inst_type: 'NFO:NIFTY2650523600PE',
          puts_ltp: 40.0,
          puts_iv: 14,
          puts_oi: 100,
          puts_volume: 10,
          puts_delta: -0.15,
          puts_gamma: 0,
          puts_theta: -5,
          puts_vega: 0,
        },
      ],
    };

    const selection = selectStrikes(1, tieBreakT0Snap, dummyT1Snapshot);
    expect(selection.shortCEStrike).toBe(24800); // Picked farther OTM CE
    expect(selection.shortPEStrike).toBe(23600); // Picked farther OTM PE
  });

  test('Strike Selection Error Branches', () => {
    const invalidT0 = { ...dummyT0Snapshot, index_close: 0 };
    const invalidT1 = { ...dummyT1Snapshot, index_close: 0 };
    expect(() => selectStrikes(1, invalidT0, invalidT1)).toThrow('Invalid spot LTP');

    const emptyT1Snap = { ...dummyT1Snapshot, rows: [] };
    expect(() => selectStrikes(1, dummyT0Snapshot, emptyT1Snap)).toThrow(
      'Long strike contract not found'
    );

    const emptyT0Snap = { ...dummyT0Snapshot, rows: [] };
    expect(() => selectStrikes(2, emptyT0Snap, dummyT1Snapshot)).toThrow(
      'Mode 2 short strike contract not found'
    );

    const noOptionT0Snap = {
      ...dummyT0Snapshot,
      rows: dummyT0Snapshot.rows.map((r) => ({ ...r, calls_ltp: 5, puts_ltp: 5 })),
    };
    expect(() => selectStrikes(1, noOptionT0Snap, dummyT1Snapshot)).toThrow(
      'No workable short strike found'
    );
  });

  test('P&L Leg Calculations and MTM with Complete Charges Model', () => {
    // Config: brokerage = ₹20, STT = 0.125%, Exchange = 0.05%, GST = 18%, SEBI = 0.0001%
    // 1. Long CLOSED leg: BUY qty 65, fillPremium 80, exit 100
    // Gross PnL = (100 - 80) * 65 = 1300
    // Brokerage = 2 * 20 = 40
    // STT (sell exit turnover = 100 * 65 = 6500): 6500 * 0.00125 = 8.125
    // Total turnover = (80 + 100) * 65 = 11700
    // Exchange = 11700 * 0.0005 = 5.85
    // GST = (40 + 5.85) * 0.18 = 8.253
    // SEBI = 11700 * 0.000001 = 0.0117
    // Total Charges = 40 + 8.125 + 5.85 + 8.253 + 0.0117 = 62.2397
    const legBuy = {
      symbol: 'TEST_BUY',
      strike: 24700,
      optionType: 'CE' as const,
      expiry: 'T1' as const,
      side: 'BUY' as const,
      qty: 65,
      fillPremium: 80,
    };

    const pnlBuy = calculateLegPnlAndCharges(legBuy, 100, defaultConfig);
    expect(pnlBuy.exitStatus).toBe('CLOSED');
    expect(pnlBuy.charges).toBeCloseTo(62.2397, 4);
    expect(pnlBuy.legPnl).toBeCloseTo(1300 - 62.2397, 4);

    // 2. Long EXPIRED_UNBOOKED leg: BUY qty 65, fillPremium 80, exit 2 (<= 5)
    // Gross PnL = (0 - 80) * 65 = -5200
    // Brokerage = 1 * 20 = 20 (entry only)
    // STT = 0 (no sell turnover)
    // Total turnover = 80 * 65 = 5200
    // Exchange = 5200 * 0.0005 = 2.60
    // GST = (20 + 2.60) * 0.18 = 4.068
    // SEBI = 5200 * 0.000001 = 0.0052
    // Total Charges = 20 + 0 + 2.60 + 4.068 + 0.0052 = 26.6732
    const pnlWorthless = calculateLegPnlAndCharges(legBuy, 2, defaultConfig);
    expect(pnlWorthless.exitStatus).toBe('EXPIRED_UNBOOKED');
    expect(pnlWorthless.charges).toBeCloseTo(26.6732, 4);
    expect(pnlWorthless.legPnl).toBeCloseTo(-5200 - 26.6732, 4);

    // 3. Short CLOSED leg: SELL qty 130, fillPremium 40, exit 20
    // Gross PnL = (40 - 20) * 130 = 2600
    // Brokerage = 2 * 20 = 40
    // STT (sell entry turnover = 40 * 130 = 5200): 5200 * 0.00125 = 6.50
    // Total turnover = (40 + 20) * 130 = 7800
    // Exchange = 7800 * 0.0005 = 3.90
    // GST = (40 + 3.90) * 0.18 = 7.902
    // SEBI = 7800 * 0.000001 = 0.0078
    // Total Charges = 40 + 6.50 + 3.90 + 7.902 + 0.0078 = 58.3098
    const legSell = {
      symbol: 'TEST_SELL',
      strike: 24700,
      optionType: 'CE' as const,
      expiry: 'T0' as const,
      side: 'SELL' as const,
      qty: 130,
      fillPremium: 40,
    };

    const pnlSellClosed = calculateLegPnlAndCharges(legSell, 20, defaultConfig);
    expect(pnlSellClosed.exitStatus).toBe('CLOSED');
    expect(pnlSellClosed.charges).toBeCloseTo(58.3098, 4);
    expect(pnlSellClosed.legPnl).toBeCloseTo(2600 - 58.3098, 4);

    // 4. Short EXPIRED_UNBOOKED leg: SELL qty 130, fillPremium 40, exit 2 (<= 5)
    // Gross PnL = (40 - 0) * 130 = 5200
    // Brokerage = 1 * 20 = 20
    // STT (sell entry turnover = 5200): 5200 * 0.00125 = 6.50
    // Total turnover = 40 * 130 = 5200
    // Exchange = 5200 * 0.0005 = 2.60
    // GST = (20 + 2.60) * 0.18 = 4.068
    // SEBI = 5200 * 0.000001 = 0.0052
    // Total Charges = 20 + 6.50 + 2.60 + 4.068 + 0.0052 = 33.1732
    const pnlSellWorthless = calculateLegPnlAndCharges(legSell, 2, defaultConfig);
    expect(pnlSellWorthless.exitStatus).toBe('EXPIRED_UNBOOKED');
    expect(pnlSellWorthless.charges).toBeCloseTo(33.1732, 4);
    expect(pnlSellWorthless.legPnl).toBeCloseTo(5200 - 33.1732, 4);

    const mtmNormal = calculateLegMTM(legSell, 30, defaultConfig.worthlessLtpThreshold);
    expect(mtmNormal).toBe(1300);

    const mtmWorthless = calculateLegMTM(legSell, 3, defaultConfig.worthlessLtpThreshold);
    expect(mtmWorthless).toBe(5200);

    const legBuyMtm = calculateLegMTM(legBuy, 90, defaultConfig.worthlessLtpThreshold);
    expect(legBuyMtm).toBe(650);

    const totalPosMtm = calculatePositionMTM(
      [legSell],
      { TEST_SELL: 30 },
      defaultConfig.worthlessLtpThreshold
    );
    expect(totalPosMtm).toBe(1300);
  });
});
