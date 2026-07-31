import fs from 'fs';
import path from 'path';
import { getISTDateParts, getISTDateString } from '../helpers/holidayCheck.js';
import { isPanicSwitchActive } from '../helpers/modeManager.js';
import { loadStore, saveStore, LegState, PositionState } from '../store/index.js';
import { placeMarketOrder, confirmOrderFill } from '../helpers/orders.js';
import { sendAlert } from '../notifier.js';
import { disconnectWebSocket } from '../helpers/websocket.js';
import { env } from '../config/env.js';

// Cache for latest LTPs of open legs and spot
const latestPrices: Record<string, number> = {};

let lastLoggedMinute = -1;

export function updateLTPCache(token: string, ltp: number) {
  latestPrices[token] = ltp;
}

export function getMtmLogPath(date: Date = new Date()): string {
  const dateStr = getISTDateString(date);
  const dir = path.join(process.cwd(), 'logs', 'mtm');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, `mtm-nifty-${dateStr}.log`);
}

export function formatMtmLogLine(date: Date, index: 'NIFTY', mtm: number): string {
  const parts = getISTDateParts(date);
  // Timestamp format: [DD/MM/YYYY, H:mm:SS am/pm] with seconds as "00"
  // DD/MM/YYYY without leading zeros (e.g. 28/7/2026)
  return `[${parts.day}/${parts.month}/${parts.year}, ${parts.hour}:${String(parts.minute).padStart(2, '0')}:00 ${parts.dayPeriod}] [INFO] ${index}: MTM = ${mtm}`;
}

export function calculateLegMTL(leg: LegState, currentLtp: number): number {
  // If option is worthless, mark LTP as 0 for MTM recomputation
  const markLtp = currentLtp < env.WORTHLESS_LTP_THRESHOLD ? 0 : currentLtp;

  if (leg.side === 'BUY') {
    return (markLtp - leg.fillPremium) * leg.qty;
  } else {
    return (leg.fillPremium - markLtp) * leg.qty;
  }
}

export function calculateCombinedMTM(store: PositionState): {
  mtm: number;
  details: Record<string, number>;
} {
  let combinedMtm = 0;
  const details: Record<string, number> = {};

  for (const leg of store.legs) {
    if (leg.status !== 'OPEN') continue;

    const currentLtp = latestPrices[leg.token] || leg.fillPremium; // fallback to fill if no tick yet
    const mtm = calculateLegMTL(leg, currentLtp);
    combinedMtm += mtm;
    details[leg.symbol] = mtm;
  }

  return { mtm: combinedMtm, details };
}

export async function logMtmLine(date: Date, mtm: number, force = false): Promise<void> {
  const parts = getISTDateParts(date);

  // Only write once per clock minute unless forced (e.g. breach)
  if (parts.minute !== lastLoggedMinute || force) {
    if (!force) {
      lastLoggedMinute = parts.minute;
    }
    const logPath = getMtmLogPath(date);
    const logLine = formatMtmLogLine(date, 'NIFTY', mtm);

    fs.appendFileSync(logPath, logLine + '\n', 'utf8');
    console.log(`[MTM LOG] ${logLine}`);
  }
}

// Order placement during exits
export async function executeExit(
  reason: 'THRESHOLD_BREACH' | 'EXPIRY_WIND_DOWN' | 'MANUAL',
  expiryOnly = false
): Promise<void> {
  if (isPanicSwitchActive()) {
    console.log('[EXIT] Panic switch (.panic) is active. Exit execution halted.');
    return;
  }

  const store = loadStore();
  if (store.status === 'CLOSED' || store.status === 'NONE') {
    console.log('[EXIT] No open position to exit.');
    return;
  }

  console.log(`[EXIT] Starting exit flow. Reason: ${reason}`);

  // Write pre-close snapshot
  const snapshotFile = path.join(
    process.cwd(),
    'data',
    `pre-close-snapshot-nifty-${Date.now()}.json`
  );
  fs.writeFileSync(snapshotFile, JSON.stringify(store, null, 2), 'utf8');
  console.log(`[EXIT] Pre-close snapshot saved: ${snapshotFile}`);

  const exitTime = new Date().toISOString();

  // Process legs
  for (const leg of store.legs) {
    if (leg.status !== 'OPEN') continue;

    // If we're only exiting expiring legs (wind-down on Tuesdays)
    if (expiryOnly) {
      // Compare leg expiry (DDMMMYYYY) to today's date
      // If the leg is not expiring today, skip it
      const currentExpiryDateStr = getISTDateString(new Date());
      // Let's parse leg expiry and compare it
      const legExpiryParts = getISTDateParts(new Date(leg.expiry)); // this may not parse DDMMMYYYY directly in JS Date, so we compare formats
      // Let's use our helper to format current date to DDMMMYYYY
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
        const parts = getISTDateParts(date);
        return `${parts.day}${months[parts.month - 1]}${parts.year}`;
      };

      const todayScripStr = formatScripExpiry(new Date());
      if (leg.expiry !== todayScripStr) {
        console.log(
          `[EXIT] Skipping leg ${leg.symbol} as it does not expire today (${leg.expiry} vs today ${todayScripStr})`
        );
        continue;
      }
    }

    const currentLtp = latestPrices[leg.token] || leg.fillPremium;

    // Check if worthless
    if (currentLtp < env.WORTHLESS_LTP_THRESHOLD) {
      console.log(
        `[EXIT] Leg ${leg.symbol} is worthless (LTP: ₹${currentLtp} < threshold ₹${env.WORTHLESS_LTP_THRESHOLD}). Allowing to expire unbooked.`
      );
      leg.status = 'EXPIRED_UNBOOKED';
      continue;
    }

    // Place exit order (opposite side)
    const exitSide = leg.side === 'BUY' ? 'SELL' : 'BUY';
    try {
      console.log(`[EXIT] Placing exit order for ${leg.symbol}: ${exitSide} ${leg.qty} lots...`);
      const exitOrderId = await placeMarketOrder({
        symbol: leg.symbol,
        token: leg.token,
        side: exitSide,
        qty: leg.qty,
      });

      const exitPremium = await confirmOrderFill(exitOrderId, leg.symbol, leg.token);
      leg.status = 'CLOSED';
      leg.exitOrderId = exitOrderId;
      leg.exitPremium = exitPremium;
      console.log(`[EXIT] Leg ${leg.symbol} exit confirmed at ₹${exitPremium}`);
    } catch (err: any) {
      await sendAlert(
        `🚨 CRITICAL: Failed to exit leg ${leg.symbol}: ${err.message}. Manual intervention required!`
      );
    }
  }

  // Update overall position status
  const anyOpen = store.legs.some((l) => l.status === 'OPEN');
  store.status = anyOpen ? 'PARTIAL_ENTRY' : 'CLOSED';
  store.exitReason = reason;
  store.exitTimestamp = exitTime;

  saveStore(store);

  const mtmResult = calculateCombinedMTM(store);

  await sendAlert(
    `⏹️ *POSITION EXIT EXECUTED*
*Reason*: ${reason}
*Final MTM*: ₹${mtmResult.mtm.toFixed(2)}
*Status*: ${store.status}`
  );

  if (store.status === 'CLOSED') {
    disconnectWebSocket();
  }
}

export async function processTick(tick: { token: string; ltp: number }) {
  updateLTPCache(tick.token, tick.ltp);

  const store = loadStore();
  if (store.status !== 'FULL_ENTRY') return;

  // Recompute MTM
  const { mtm } = calculateCombinedMTM(store);

  // Log MTM
  await logMtmLine(new Date(), mtm);

  // Check Threshold Breach (symmetric ±2% exitThreshold)
  if (Math.abs(mtm) >= store.exitThreshold) {
    console.log(
      `[MONITOR] MTM breach: Combined MTM ₹${mtm.toFixed(2)} crossed threshold ₹${store.exitThreshold.toFixed(2)}`
    );
    // Append immediately on breach
    await logMtmLine(new Date(), mtm, true);
    await executeExit('THRESHOLD_BREACH');
  }
}
