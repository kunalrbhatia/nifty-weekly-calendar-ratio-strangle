import fs from 'fs';
import path from 'path';
import { getISTDateString, getISTDateParts } from '../helpers/holidayCheck.js';
import { loadStore } from '../store/index.js';

export function parseLatestMtmFromLog(
  logFilePath: string
): { timestamp: string; mtm: number } | null {
  if (!fs.existsSync(logFilePath)) return null;

  const content = fs.readFileSync(logFilePath, 'utf8').trim();
  if (!content) return null;

  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;

  const lastLine = lines[lines.length - 1];
  // Format: [DD/MM/YYYY, H:mm:SS am/pm] [INFO] NIFTY: MTM = 1250.5
  const match = lastLine.match(/\[(.*?)\]\s+\[INFO\]\s+NIFTY:\s+MTM\s+=\s+(-?\d+(?:\.\d+)?)/);
  if (match) {
    return {
      timestamp: match[1],
      mtm: parseFloat(match[2]),
    };
  }
  return null;
}

export function formatPnlBanner(
  mtm: number,
  timestamp: string,
  storeStatus: string,
  marginUtilized: number,
  exitThreshold: number
): string {
  const isProfit = mtm >= 0;
  const sign = isProfit ? '+' : '-';
  const absMtm = Math.abs(mtm).toFixed(2);
  const emoji = isProfit ? '🟢' : '🔴';
  const statusEmoji = storeStatus === 'FULL_ENTRY' ? '🎯' : storeStatus === 'NONE' ? '💤' : '⚙️';
  // Log timestamps are already IST ([DD/MM/YYYY, h:mm:ss am/pm]) — parse directly.
  // new Date() on "10/8/2026, 1:03:00 pm" returns Invalid Date in Node and the
  // server clock is UTC, so never round-trip through Date for this banner.
  const time = formatISTClockTime(timestamp);

  const line1 = `📊 NIFTY STRANGLE  ${emoji} ${sign}₹ ${absMtm}`;
  const line2 =
    marginUtilized > 0
      ? `${statusEmoji} ${storeStatus}  ·  SL −₹${exitThreshold.toFixed(0)}  ·  PT +₹${exitThreshold.toFixed(0)}`
      : `${statusEmoji} ${storeStatus}`;
  const line3 = `🕐 ${time}`;

  return [line1, line2, line3].join('\n');
}

/**
 * Formats an MTM-log timestamp "[DD/MM/YYYY, h:mm:ss am/pm]" (IST) as
 * "h:mm am/pm" WITHOUT constructing a Date — the log format is not
 * Date-parseable in Node and the server clock is UTC, not IST.
 * Falls back to the current IST clock time if the string is unexpected.
 */
export function formatISTClockTime(timestamp: string): string {
  const m = timestamp.match(
    /^(\d{1,2})\/(\d{1,2})\/\d{4},\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)$/i
  );
  if (m) {
    let hour = parseInt(m[3], 10);
    const minute = m[4];
    const meridiem = m[5].toLowerCase();
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    const hour12 = hour % 12 === 0 ? 12 : hour % 12;
    return `${hour12}:${minute} ${meridiem === 'am' ? 'am' : 'pm'}`;
  }
  // Fallback: current IST clock time (getISTDateParts returns 12h hour + dayPeriod)
  const parts = getISTDateParts(new Date());
  const meridiem = parts.dayPeriod || (parts.hour >= 12 ? 'pm' : 'am');
  return `${parts.hour}:${String(parts.minute).padStart(2, '0')} ${meridiem}`;
}

export function runShowPnl(): void {
  const today = new Date();
  const dateStr = getISTDateString(today);
  const mtmLogPath = path.join(process.cwd(), 'logs', 'mtm', `mtm-nifty-${dateStr}.log`);

  const store = loadStore();
  const parsed = parseLatestMtmFromLog(mtmLogPath);

  const marginUtilized = store.entryMargin || 0;
  const exitThreshold = store.exitThreshold || 0;

  if (parsed) {
    console.log(
      formatPnlBanner(parsed.mtm, parsed.timestamp, store.status, marginUtilized, exitThreshold)
    );
  } else {
    const parts = getISTDateParts(today);
    const tsStr = `${parts.day}/${parts.month}/${parts.year}, ${parts.hour}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')} ${parts.dayPeriod}`;
    console.log(formatPnlBanner(0, tsStr, store.status, marginUtilized, exitThreshold));
  }
}

if (process.argv[1] && process.argv[1].includes('showPnl')) {
  runShowPnl();
}
