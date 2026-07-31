import fs from 'fs';
import path from 'path';
import { getNiftySpotLTP, getBulkLTP } from '../helpers/api.js';
import {
  loadCachedScrips,
  verifyAndGetLotSize,
  resolveT0AndT1,
  ScripItem,
} from '../helpers/scripMaster.js';
import { getISTDateString } from '../helpers/holidayCheck.js';
import { roundStrikeToNearest100 } from './entry.js';
import { loginToBroker } from '../helpers/login.js';

export async function generateBasketOrder(): Promise<void> {
  console.log('[BASKET] Generating basket...');

  const loggedIn = await loginToBroker();
  if (!loggedIn) {
    console.error('[BASKET] Failed to login to broker.');
    return;
  }

  const scrips = loadCachedScrips();
  if (scrips.length === 0) {
    console.error('[BASKET] Scrip master cache is empty. Run downloadScripMaster first.');
    return;
  }

  let lotSize: number;
  try {
    lotSize = verifyAndGetLotSize('NIFTY', scrips);
  } catch (err: any) {
    console.error('[BASKET] Lot size verification failed:', err.message);
    return;
  }

  let spotLTP = 0;
  try {
    spotLTP = await getNiftySpotLTP();
    console.log(`[BASKET] Nifty Spot LTP: ${spotLTP}`);
  } catch (err) {
    console.error('[BASKET] Failed to fetch Nifty spot LTP.');
    return;
  }

  const today = new Date();
  let T0: Date, T1: Date;
  try {
    const resolved = resolveT0AndT1('NIFTY', scrips, today);
    T0 = resolved.T0;
    T1 = resolved.T1;
  } catch (err: any) {
    console.error('[BASKET] Expiries resolution failed:', err.message);
    return;
  }

  const longCEStrike = roundStrikeToNearest100(spotLTP + 500);
  const longPEStrike = roundStrikeToNearest100(spotLTP - 500);

  const months = [
    'JAN',
    'FEB',
    'MAR',
    'APR',
    'MAY',
    'JUN',
    'JUL',
    'AUG',
    'SEP',
    'OCT',
    'NOV',
    'DEC',
  ];
  const formatScripExpiry = (date: Date): string => {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata' });
    const parts = formatter.formatToParts(date);
    const day = parts.find((p) => p.type === 'day')?.value || '';
    const monthIndex = parseInt(parts.find((p) => p.type === 'month')?.value || '1', 10) - 1;
    const year = parts.find((p) => p.type === 'year')?.value || '';
    return `${day}${months[monthIndex]}${year}`;
  };

  const T1ScripStr = formatScripExpiry(T1);
  const T0ScripStr = formatScripExpiry(T0);

  const findOptionContract = (
    strike: number,
    optionType: 'CE' | 'PE',
    expiryStr: string
  ): ScripItem | undefined => {
    return scrips.find(
      (item) =>
        item.name === 'NIFTY' &&
        item.exch_seg === 'NFO' &&
        item.instrumenttype === 'OPTIDX' &&
        item.expiry === expiryStr &&
        Math.round(parseFloat(item.strike) / 100) === strike &&
        item.symbol.endsWith(optionType)
    );
  };

  const longCEContract = findOptionContract(longCEStrike, 'CE', T1ScripStr);
  const longPEContract = findOptionContract(longPEStrike, 'PE', T1ScripStr);

  if (!longCEContract || !longPEContract) {
    console.error('[BASKET] Long T1 contracts not found.');
    return;
  }

  // Estimate LTPs for short strike selection
  const targetCEPremium = 80; // approximate default target CE premium if not fetched
  const targetPEPremium = 80;

  const t0CEContracts = scrips.filter(
    (item) =>
      item.name === 'NIFTY' &&
      item.exch_seg === 'NFO' &&
      item.instrumenttype === 'OPTIDX' &&
      item.expiry === T0ScripStr &&
      item.symbol.endsWith('CE')
  );

  const t0PEContracts = scrips.filter(
    (item) =>
      item.name === 'NIFTY' &&
      item.exch_seg === 'NFO' &&
      item.instrumenttype === 'OPTIDX' &&
      item.expiry === T0ScripStr &&
      item.symbol.endsWith('PE')
  );

  const selectBestShortStrike = async (
    contracts: ScripItem[],
    target: number,
    optionType: 'CE' | 'PE'
  ): Promise<ScripItem> => {
    const candidateContracts = contracts.filter((item) => {
      const strike = Math.round(parseFloat(item.strike) / 100);
      return Math.abs(strike - spotLTP) <= 1500;
    });

    const tokens = candidateContracts.map((c) => c.token);
    const ltpMap = await getBulkLTP('NFO', tokens);

    let bestContract: ScripItem | null = null;
    let bestDiff = Infinity;

    for (const contract of candidateContracts) {
      const ltp = ltpMap[contract.token] || 0;
      if (ltp <= 0) continue;

      const diff = Math.abs(ltp - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestContract = contract;
      }
    }

    if (!bestContract) {
      throw new Error(`No short strike found for ${optionType}`);
    }
    return bestContract;
  };

  let shortCEContract: ScripItem;
  let shortPEContract: ScripItem;

  try {
    shortCEContract = await selectBestShortStrike(t0CEContracts, targetCEPremium, 'CE');
    shortPEContract = await selectBestShortStrike(t0PEContracts, targetPEPremium, 'PE');
  } catch (err: any) {
    console.error('[BASKET] Short strike selection failed:', err.message);
    return;
  }

  const basketOrders = [
    {
      variety: 'NORMAL',
      tradingsymbol: longCEContract.symbol,
      symboltoken: longCEContract.token,
      transactiontype: 'BUY',
      exchange: 'NFO',
      ordertype: 'MARKET',
      producttype: 'CARRYFORWARD',
      duration: 'DAY',
      quantity: String(lotSize),
      price: '0',
    },
    {
      variety: 'NORMAL',
      tradingsymbol: longPEContract.symbol,
      symboltoken: longPEContract.token,
      transactiontype: 'BUY',
      exchange: 'NFO',
      ordertype: 'MARKET',
      producttype: 'CARRYFORWARD',
      duration: 'DAY',
      quantity: String(lotSize),
      price: '0',
    },
    {
      variety: 'NORMAL',
      tradingsymbol: shortCEContract.symbol,
      symboltoken: shortCEContract.token,
      transactiontype: 'SELL',
      exchange: 'NFO',
      ordertype: 'MARKET',
      producttype: 'CARRYFORWARD',
      duration: 'DAY',
      quantity: String(lotSize * 2),
      price: '0',
    },
    {
      variety: 'NORMAL',
      tradingsymbol: shortPEContract.symbol,
      symboltoken: shortPEContract.token,
      transactiontype: 'SELL',
      exchange: 'NFO',
      ordertype: 'MARKET',
      producttype: 'CARRYFORWARD',
      duration: 'DAY',
      quantity: String(lotSize * 2),
      price: '0',
    },
  ];

  const basketPath = path.join(process.cwd(), 'data', 'basket.json');
  fs.writeFileSync(basketPath, JSON.stringify(basketOrders, null, 2), 'utf8');

  console.log(`✓ Basket generated successfully at ${basketPath}`);
  console.log(JSON.stringify(basketOrders, null, 2));
}

// If run directly
if (process.argv[1] && process.argv[1].endsWith('generateBasket.ts')) {
  generateBasketOrder();
}
