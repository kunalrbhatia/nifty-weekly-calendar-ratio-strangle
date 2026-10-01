import { loadStore } from '../store/index.js';
import { isPaperMode } from './modeManager.js';
import { getSmartApi, retryCall } from './api.js';
import { sendAlert } from '../notifier.js';

// NOTE (2026-08-27 fix): Angel One getPosition() netqty is in SHARES, and the store's
// leg.qty is ALSO in SHARES (entry.ts places qty: lotSize = 65 shares for 1 lot).
// Earlier code multiplied store qty by 65 again (treating it as lots), which produced
// false mismatches (e.g. 4225 vs 65) on every resume. Removed the conversion — direct
// share-to-share comparison. Verified live: store long 65 == broker netqty 65 ✓

/**
 * Compares the algo's local position store (data/position-nifty.json) against
 * the broker's actual positions (Angel One SmartAPI getPosition).
 *
 * Note on Shared Broker Account:
 * The broker account is shared with another algo (e.g. rubber-band-strategy).
 * getPosition returns account-wide positions. We look up OUR symbols by exact
 * tradingsymbol match. If the shared account nets a symbol across algos,
 * netqty could offset, causing a mismatch alert. This fail-loud approach is intended.
 */
export async function reconcileStoreWithBroker(): Promise<{
  ok: boolean;
  mismatches: string[];
}> {
  const store = loadStore();

  // Return early if no active entry state
  if (store.status !== 'FULL_ENTRY' && store.status !== 'PARTIAL_ENTRY') {
    return { ok: true, mismatches: [] };
  }

  // Return early in paper mode
  if (isPaperMode()) {
    return { ok: true, mismatches: [] };
  }

  // Collect only legs with status === 'OPEN'
  const openLegs = (store.legs || []).filter((leg) => leg.status === 'OPEN');
  if (openLegs.length === 0) {
    return { ok: true, mismatches: [] };
  }

  const mismatches: string[] = [];

  try {
    const api = await getSmartApi();
    const task = async () => {
      const res = await api.getPosition();
      // Validate the response SHAPE, not just the message: a failed call can still
      // carry message='SUCCESS', which previously produced the useless alert text
      // "Could not fetch broker positions: SUCCESS". Report the real shape instead.
      if (!res || res.status !== true || !Array.isArray(res.data)) {
        throw new Error(
          `unexpected getPosition response (status=${JSON.stringify(res?.status)}, ` +
            `dataType=${Array.isArray(res?.data) ? 'array' : typeof res?.data}, ` +
            `message=${JSON.stringify(res?.message)})`
        );
      }
      return res.data;
    };

    const positionData = await retryCall(task, 'Reconcile: getPosition', 3, 1000);

    // Build broker net-qty map keyed by tradingsymbol
    const brokerNet: Record<string, number> = {};
    for (const p of positionData) {
      if (p.tradingsymbol) {
        const net = Number(p.netqty) || 0;
        brokerNet[p.tradingsymbol] = (brokerNet[p.tradingsymbol] || 0) + net;
      }
    }

    // Compare each OPEN leg against broker position
    for (const leg of openLegs) {
      const symbol = leg.symbol;
      // Store qty is in SHARES (entry.ts places qty: lotSize = 65 shares for 1 lot).
      // Broker getPosition netqty is ALSO in SHARES. Direct comparison — no ×65.
      const expectedShares = leg.side === 'BUY' ? leg.qty : -leg.qty;
      const brokerQty = brokerNet[symbol] !== undefined ? brokerNet[symbol] : 0;

      if (brokerQty === 0) {
        mismatches.push(
          `${symbol}: store says ${leg.side} ${leg.qty} shares OPEN but broker has ZERO position`
        );
      } else if (Math.sign(brokerQty) !== Math.sign(expectedShares)) {
        mismatches.push(
          `${symbol}: store says ${leg.side} ${leg.qty} shares but broker shows net ${brokerQty} shares (OPPOSITE side!)`
        );
      } else if (Math.abs(brokerQty) !== Math.abs(expectedShares)) {
        mismatches.push(
          `${symbol}: store says ${Math.abs(expectedShares)} shares but broker shows ${brokerQty} shares`
        );
      }
    }
  } catch (err: any) {
    mismatches.push(`Could not fetch broker positions: ${err?.message || err}`);
  }

  if (mismatches.length > 0) {
    const alertMsg = [
      '🚨 *POSITION RECONCILIATION MISMATCH*',
      '',
      ...mismatches.map((m) => `• ${m}`),
      '',
      `Store: ${store.status}. Broker check done on resume. Do NOT trust the store — verify before any exit order.`,
    ].join('\n');

    await sendAlert(alertMsg);
    return { ok: false, mismatches };
  }

  return { ok: true, mismatches: [] };
}
