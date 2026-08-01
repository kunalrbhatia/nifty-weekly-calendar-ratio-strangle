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

export function formatPnlBanner(mtm: number, timestamp: string, storeStatus: string): string {
  const isProfit = mtm >= 0;
  const sign = isProfit ? '+' : '-';
  const absMtm = Math.abs(mtm).toFixed(2);
  const formattedVal = `${sign}₹${absMtm}`;
  const statusStr = `Status: ${storeStatus}`;

  const border =
    '═════════════════════════════════════════════════════════════════════════════════';
  const thinBorder =
    '─────────────────────────────────────────────────────────────────────────────────';

  return `
╔${border}╗
║                          📊 REAL-TIME NIFTY STRANGLE P&L                       ║
╠${border}╣
║                                                                                 ║
║    CURRENT MTM P&L :   ${formattedVal.padEnd(20)}                             ║
║    STATUS          :   ${statusStr.padEnd(20)}                             ║
║    LAST UPDATED    :   ${timestamp.padEnd(20)}                             ║
║                                                                                 ║
╠${thinBorder}╣
║  [Source]: MTM Logger (logs/mtm/mtm-nifty-*.log) | Direct log parsing active    ║
╚${border}╝
`;
}

export function runShowPnl(): void {
  const today = new Date();
  const dateStr = getISTDateString(today);
  const mtmLogPath = path.join(process.cwd(), 'logs', 'mtm', `mtm-nifty-${dateStr}.log`);

  const store = loadStore();
  const parsed = parseLatestMtmFromLog(mtmLogPath);

  if (parsed) {
    console.log(formatPnlBanner(parsed.mtm, parsed.timestamp, store.status));
  } else {
    const parts = getISTDateParts(today);
    const tsStr = `${parts.day}/${parts.month}/${parts.year}, ${parts.hour}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')} ${parts.dayPeriod}`;
    console.log(formatPnlBanner(0, tsStr, store.status));
  }
}

if (process.argv[1] && process.argv[1].includes('showPnl')) {
  runShowPnl();
}
