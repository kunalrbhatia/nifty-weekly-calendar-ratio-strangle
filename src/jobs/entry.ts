import { isKillSwitchActive, isPanicSwitchActive } from '../helpers/modeManager.js';
import { getNiftySpotLTP, getBulkLTP, getUtilisedMargin } from '../helpers/api.js';
import {
  loadCachedScrips,
  verifyAndGetLotSize,
  resolveT0AndT1,
  ScripItem,
} from '../helpers/scripMaster.js';
import { getISTDateString } from '../helpers/holidayCheck.js';
import { placeMarketOrder, confirmOrderFill } from '../helpers/orders.js';
import { saveStore, loadStore, LegState, PositionState } from '../store/index.js';
import { sendAlert } from '../notifier.js';
import { connectWebSocket } from '../helpers/websocket.js';
import { env } from '../config/env.js';

export function roundStrikeToNearest100(spotDerivedStrike: number): number {
  return Math.round(spotDerivedStrike / 100) * 100;
}

export async function runEntrySequence(): Promise<void> {
  console.log('[ENTRY] Starting entry sequence...');

  // 1. Confirm today is a valid trading day and not blocked by .kill / .panic
  if (isKillSwitchActive()) {
    console.log('[ENTRY] Soft pause active (.kill). Skipping entry.');
    return;
  }
  if (isPanicSwitchActive()) {
    console.log('[ENTRY] Panic switch active (.panic). Skipping entry.');
    return;
  }

  const store = loadStore();
  if (store.status === 'FULL_ENTRY' || store.status === 'PARTIAL_ENTRY') {
    console.log('[ENTRY] Position already open. Skipping entry.');
    return;
  }

  // Load scrip master
  const scrips = loadCachedScrips();
  if (scrips.length === 0) {
    const msg = '🚨 Scrip master cache is empty. Run downloadScripMaster first.';
    await sendAlert(msg);
    return;
  }

  // Reconcile and verify NIFTY lot size dynamically
  let lotSize: number;
  try {
    lotSize = verifyAndGetLotSize('NIFTY', scrips);
  } catch (err: any) {
    console.error('[ENTRY] Lot size verification failed:', err.message);
    return;
  }

  // 2. Fetch Nifty 50 index LTP (spot)
  let spotLTP = 0;
  try {
    spotLTP = await getNiftySpotLTP();
    console.log(`[ENTRY] Nifty spot LTP: ${spotLTP}`);
  } catch (err) {
    await sendAlert('🚨 Aborting entry: Nifty Spot LTP could not be confirmed.');
    return;
  }

  // 3. Resolve T0 and T1
  const today = new Date();
  let T0: Date, T1: Date;
  try {
    const resolved = resolveT0AndT1('NIFTY', scrips, today);
    T0 = resolved.T0;
    T1 = resolved.T1;
    console.log(
      `[ENTRY] Resolved Expiries -> T0 (Current): ${getISTDateString(T0)}, T1 (Next): ${getISTDateString(T1)}`
    );
  } catch (err: any) {
    await sendAlert(
      `🚨 Aborting entry: Failed to resolve T0 and T1 expiries. Error: ${err.message}`
    );
    return;
  }

  // 4. Compute long-leg strikes from spot
  const longCEStrike = roundStrikeToNearest100(spotLTP + 500);
  const longPEStrike = roundStrikeToNearest100(spotLTP - 500);
  console.log(`[ENTRY] Computed long strikes -> CE: ${longCEStrike}, PE: ${longPEStrike}`);

  // Find long tokens in scrip master for T1
  // Expiry string format in scrip master is like "28OCT2025" or "04AUG2026"
  // Let's format T1 to match scrip master format (e.g. DDMMMYYYY)
  const formatScripExpiry = (date: Date): string => {
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
    // Use IST timezone parts
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
    await sendAlert(
      `🚨 Aborting entry: Long T1 option contracts not found in scrip master for strikes CE ${longCEStrike}, PE ${longPEStrike} on ${T1ScripStr}`
    );
    return;
  }

  // Phase B - Buy long strangle on T1
  let longCEOrderId: string;
  let longPEOrderId: string;
  let longCEPremium: number;
  let longPEPremium: number;

  try {
    console.log('[ENTRY] Placing BUY order for T1 CE...');
    longCEOrderId = await placeMarketOrder({
      symbol: longCEContract.symbol,
      token: longCEContract.token,
      side: 'BUY',
      qty: lotSize,
    });

    console.log('[ENTRY] Placing BUY order for T1 PE...');
    longPEOrderId = await placeMarketOrder({
      symbol: longPEContract.symbol,
      token: longPEContract.token,
      side: 'BUY',
      qty: lotSize,
    });

    console.log('[ENTRY] Confirming long order fills...');
    longCEPremium = await confirmOrderFill(
      longCEOrderId,
      longCEContract.symbol,
      longCEContract.token
    );
    longPEPremium = await confirmOrderFill(
      longPEOrderId,
      longPEContract.symbol,
      longPEContract.token
    );

    console.log(`[ENTRY] Long fills confirmed -> CE: ₹${longCEPremium}, PE: ₹${longPEPremium}`);
  } catch (err: any) {
    await sendAlert(
      `🚨 CRITICAL: Long strangle entry failed or could not be confirmed: ${err.message}. Aborting entire entry sequence.`
    );
    // Note: Do not place short leg orders if long fails.
    return;
  }

  // Record snapshot in store
  const longCEState: LegState = {
    symbol: longCEContract.symbol,
    token: longCEContract.token,
    strike: longCEStrike,
    optionType: 'CE',
    expiry: longCEContract.expiry,
    side: 'BUY',
    qty: lotSize,
    fillPremium: longCEPremium,
    orderId: longCEOrderId,
    status: 'OPEN',
  };

  const longPEState: LegState = {
    symbol: longPEContract.symbol,
    token: longPEContract.token,
    strike: longPEStrike,
    optionType: 'PE',
    expiry: longPEContract.expiry,
    side: 'BUY',
    qty: lotSize,
    fillPremium: longPEPremium,
    orderId: longPEOrderId,
    status: 'OPEN',
  };

  const snapshot: PositionState = {
    status: 'PARTIAL_ENTRY', // Temporarily partial until shorts open
    niftyLTP: spotLTP,
    T0: getISTDateString(T0),
    T1: getISTDateString(T1),
    entryTimestamp: new Date().toISOString(),
    entryMargin: 0,
    exitThreshold: 0,
    legs: [longCEState, longPEState],
  };
  saveStore(snapshot);
  console.log('[ENTRY] Phase B complete. Long snapshot stored.');

  // Phase C - Sell ratio hedges on T0
  console.log('[ENTRY] Selecting T0 short ratio strikes...');
  const targetCEPremium = longCEPremium / 2;
  const targetPEPremium = longPEPremium / 2;

  // Filter all contracts for T0 CE / PE
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
    // To avoid fetching too many, keep contracts within +/- 1500 points of spot
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
      } else if (diff === bestDiff && bestContract) {
        // Tie breaker: prefer farther OTM (higher strike for CE, lower strike for PE)
        const currentStrike = Math.round(parseFloat(contract.strike) / 100);
        const bestStrike = Math.round(parseFloat(bestContract.strike) / 100);
        if (optionType === 'CE' && currentStrike > bestStrike) {
          bestContract = contract;
        } else if (optionType === 'PE' && currentStrike < bestStrike) {
          bestContract = contract;
        }
      }
    }

    if (!bestContract) {
      throw new Error(`No workable short strike found for ${optionType}`);
    }
    return bestContract;
  };

  let shortCEContract: ScripItem;
  let shortPEContract: ScripItem;

  try {
    shortCEContract = await selectBestShortStrike(t0CEContracts, targetCEPremium, 'CE');
    shortPEContract = await selectBestShortStrike(t0PEContracts, targetPEPremium, 'PE');
    console.log(
      `[ENTRY] Selected short CE: ${shortCEContract.symbol} (strike ${Math.round(parseFloat(shortCEContract.strike) / 100)})`
    );
    console.log(
      `[ENTRY] Selected short PE: ${shortPEContract.symbol} (strike ${Math.round(parseFloat(shortPEContract.strike) / 100)})`
    );
  } catch (err: any) {
    await sendAlert(
      `🚨 Phase C failed: Strike selection for short hedges failed: ${err.message}. Keeping long positions open. Position state set to PARTIAL_ENTRY.`
    );
    return;
  }

  // Place short orders (2 lots each)
  let shortCEOrderId: string;
  let shortPEOrderId: string;
  let shortCEPremium: number;
  let shortPEPremium: number;

  try {
    console.log('[ENTRY] Placing SELL order for T0 CE (2 lots)...');
    shortCEOrderId = await placeMarketOrder({
      symbol: shortCEContract.symbol,
      token: shortCEContract.token,
      side: 'SELL',
      qty: lotSize * 2,
    });

    console.log('[ENTRY] Placing SELL order for T0 PE (2 lots)...');
    shortPEOrderId = await placeMarketOrder({
      symbol: shortPEContract.symbol,
      token: shortPEContract.token,
      side: 'SELL',
      qty: lotSize * 2,
    });

    console.log('[ENTRY] Confirming short order fills...');
    shortCEPremium = await confirmOrderFill(
      shortCEOrderId,
      shortCEContract.symbol,
      shortCEContract.token
    );
    shortPEPremium = await confirmOrderFill(
      shortPEOrderId,
      shortPEContract.symbol,
      shortPEContract.token
    );

    console.log(`[ENTRY] Short fills confirmed -> CE: ₹${shortCEPremium}, PE: ₹${shortPEPremium}`);
  } catch (err: any) {
    // Rule 1.2: Partial entry policy
    await sendAlert(
      `🚨 CRITICAL PARTIAL ENTRY: Long legs filled, but short hedges failed or could not be confirmed: ${err.message}. Position state: PARTIAL_ENTRY.`
    );
    // Keep longs in store, marked as PARTIAL_ENTRY
    return;
  }

  const shortCEState: LegState = {
    symbol: shortCEContract.symbol,
    token: shortCEContract.token,
    strike: Math.round(parseFloat(shortCEContract.strike) / 100),
    optionType: 'CE',
    expiry: shortCEContract.expiry,
    side: 'SELL',
    qty: lotSize * 2,
    fillPremium: shortCEPremium,
    orderId: shortCEOrderId,
    status: 'OPEN',
  };

  const shortPEState: LegState = {
    symbol: shortPEContract.symbol,
    token: shortPEContract.token,
    strike: Math.round(parseFloat(shortPEContract.strike) / 100),
    optionType: 'PE',
    expiry: shortPEContract.expiry,
    side: 'SELL',
    qty: lotSize * 2,
    fillPremium: shortPEPremium,
    orderId: shortPEOrderId,
    status: 'OPEN',
  };

  // Phase D - Post-entry
  console.log('[ENTRY] Fetching utilized margin for full position...');
  const entryMargin = await getUtilisedMargin();
  const exitThreshold = entryMargin * (env.EXIT_THRESHOLD_PCT / 100);

  const finalState: PositionState = {
    status: 'FULL_ENTRY',
    niftyLTP: spotLTP,
    T0: getISTDateString(T0),
    T1: getISTDateString(T1),
    entryTimestamp: new Date().toISOString(),
    entryMargin,
    exitThreshold,
    legs: [longCEState, longPEState, shortCEState, shortPEState],
  };

  saveStore(finalState);

  await sendAlert(
    `🚀 *FULL ENTRY EXECUTED SUCCESSFULLY*
*Index*: NIFTY Spot @ ${spotLTP}
*T1 Longs*: CE ${longCEStrike} @ ₹${longCEPremium}, PE ${longPEStrike} @ ₹${longPEPremium}
*T0 Shorts*: CE ${shortCEState.strike} @ ₹${shortCEPremium}, PE ${shortPEState.strike} @ ₹${shortPEPremium}
*Utilized Margin*: ₹${entryMargin}
*Symmetric Exit Threshold*: ±₹${exitThreshold} (2%)`
  );

  // Subscribe and connect to WebSocket monitor
  const activeTokens = finalState.legs.map((l) => l.token);
  activeTokens.push('99926000'); // include spot
  await connectWebSocket(activeTokens);
}
