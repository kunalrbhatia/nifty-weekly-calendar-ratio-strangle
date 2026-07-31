import {
  verifyAndGetLotSize,
  parseExpiryDate,
  getAvailableExpiries,
  resolveT0AndT1,
  ScripItem,
} from './scripMaster.js';

describe('scripMaster', () => {
  const mockScrips: ScripItem[] = [
    {
      token: '100',
      symbol: 'NIFTY28OCT2524400CE',
      name: 'NIFTY',
      expiry: '28OCT2025',
      strike: '2440000.000000',
      lotsize: '75',
      instrumenttype: 'OPTIDX',
      exch_seg: 'NFO',
    },
    {
      token: '101',
      symbol: 'NIFTY28OCT2524400PE',
      name: 'NIFTY',
      expiry: '28OCT2025',
      strike: '2440000.000000',
      lotsize: '75',
      instrumenttype: 'OPTIDX',
      exch_seg: 'NFO',
    },
    {
      token: '102',
      symbol: 'NIFTY04NOV2524400CE',
      name: 'NIFTY',
      expiry: '04NOV2025',
      strike: '2440000.000000',
      lotsize: '75',
      instrumenttype: 'OPTIDX',
      exch_seg: 'NFO',
    },
  ];

  it('should parse expiry dates correctly', () => {
    const d = parseExpiryDate('28OCT2025');
    // Verify it's October 28, 2025
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(9); // October is 9
    expect(d.getDate()).toBe(28);
  });

  it('should list available expiries', () => {
    const expiries = getAvailableExpiries('NIFTY', mockScrips);
    expect(expiries.length).toBe(2);
    expect(expiries[0].getFullYear()).toBe(2025);
  });

  it('should verify and return lot size', () => {
    const lotSize = verifyAndGetLotSize('NIFTY', mockScrips);
    expect(lotSize).toBe(75);
  });

  it('should throw on lot size mismatch', () => {
    const wrongScrips: ScripItem[] = [
      {
        token: '100',
        symbol: 'NIFTY28OCT2524400CE',
        name: 'NIFTY',
        expiry: '28OCT2025',
        strike: '2440000.000000',
        lotsize: '50', // configured is 75 in constants
        instrumenttype: 'OPTIDX',
        exch_seg: 'NFO',
      },
    ];
    expect(() => verifyAndGetLotSize('NIFTY', wrongScrips)).toThrow();
  });
});
