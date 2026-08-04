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
  const time = new Date(timestamp).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const line1 = `📊 NIFTY STRANGLE  ${emoji} ${sign}₹ ${absMtm}`;
  const line2 =
    marginUtilized > 0
      ? `${statusEmoji} ${storeStatus}  ·  SL −₹${exitThreshold.toFixed(0)}  ·  PT +₹${exitThreshold.toFixed(0)}`
      : `${statusEmoji} ${storeStatus}`;
  const line3 = `🕐 ${time}`;

  return [line1, line2, line3].join('\n');
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
