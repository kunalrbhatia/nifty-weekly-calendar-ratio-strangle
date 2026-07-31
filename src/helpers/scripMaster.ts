import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { env } from '../config/env.js';
import { INDEX_CONFIGS, IndexName } from './constants.js';
import { sendAlert } from '../notifier.js';
import { getISTDateString, getISTDateParts } from './holidayCheck.js';

const SCRIPS_FILE = path.join(process.cwd(), 'data', 'scrips.json');

export interface ScripItem {
  token: string;
  symbol: string;
  name: string;
  expiry: string; // e.g. "28OCT2025"
  strike: string; // e.g. "2440000.000000"
  lotsize: string;
  instrumenttype: string; // OPTIDX, FUTIDX
  exch_seg: string; // NFO
}

export async function downloadScripMaster(): Promise<void> {
  const dir = path.dirname(SCRIPS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  console.log('Downloading scrip master...');
  const url = 'https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json';
  
  try {
    const response = await axios.get(url, { timeout: 30000 });
    if (Array.isArray(response.data)) {
      // Filter only relevant instruments to keep file small
      const filtered = response.data.filter(
        (item: any) =>
          item.name === 'NIFTY' &&
          item.exch_seg === 'NFO' &&
          (item.instrumenttype === 'OPTIDX' || item.instrumenttype === 'FUTIDX')
      );
      fs.writeFileSync(SCRIPS_FILE, JSON.stringify(filtered, null, 2), 'utf8');
      console.log(`✓ Scrip master downloaded and filtered. Cached ${filtered.length} instruments.`);
    } else {
      throw new Error('Scrip master response is not an array');
    }
  } catch (err: any) {
    console.error('Failed to download scrip master:', err);
    throw err;
  }
}

export function loadCachedScrips(): ScripItem[] {
  if (!fs.existsSync(SCRIPS_FILE)) {
    return [];
  }
  try {
    const content = fs.readFileSync(SCRIPS_FILE, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    console.error('Failed to parse scrips cache:', err);
    return [];
  }
}

// Rule 2.10: Dynamic Lot Size Verification via majority vote
export function verifyAndGetLotSize(symbol: IndexName, scrips: ScripItem[]): number {
  const freq: Record<number, number> = {};

  for (const item of scrips) {
    if (
      item.exch_seg === 'NFO' &&
      (item.instrumenttype === 'FUTIDX' || item.instrumenttype === 'OPTIDX') &&
      item.name === symbol
    ) {
      const lot = parseInt(item.lotsize, 10);
      if (isNaN(lot) || lot <= 0) continue; // discard malformed rows

      freq[lot] = (freq[lot] || 0) + 1;
    }
  }

  const entries = Object.entries(freq);
  if (entries.length === 0) {
    throw new Error(`No contracts found in scrip master for index: ${symbol}`);
  }

  // Sort by count descending
  entries.sort((a, b) => b[1] - a[1]);
  const [majorityLotStr, majorityCount] = entries[0];
  const majorityLot = parseInt(majorityLotStr, 10);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);

  if (entries.length > 1) {
    console.warn(
      `[WARNING] Lot size disagreement for ${symbol}: ${JSON.stringify(freq)} — using majority ${majorityLot} (${majorityCount}/${total} contracts). Verify before trading.`
    );
  }

  // Verify against hardcoded config
  const configuredLotSize = INDEX_CONFIGS[symbol].defaultLotSize;
  if (majorityLot !== configuredLotSize) {
    const msg = `🚨 Lot size mismatch for ${symbol}: scrip master says ${majorityLot}, config says ${configuredLotSize}. Entry blocked until resolved.`;
    sendAlert(msg);
    throw new Error(msg);
  }

  return majorityLot;
}

// Convert DDMMMYYYY (e.g. 28OCT2025) to Date object in IST timezone
export function parseExpiryDate(expiryStr: string): Date {
  const months: Record<string, number> = {
    JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
    JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11
  };
  
  // Expiry is format: DDMMMYYYY or DMMMYYYY (e.g. 5AUG2025 or 28OCT2025)
  const match = expiryStr.match(/^(\d{1,2})([A-Z]{3})(\d{4})$/);
  if (!match) {
    throw new Error(`Invalid expiry string format: ${expiryStr}`);
  }
  
  const day = parseInt(match[1], 10);
  const monthStr = match[2];
  const year = parseInt(match[3], 10);
  
  const month = months[monthStr];
  if (month === undefined) {
    throw new Error(`Invalid month in expiry: ${monthStr}`);
  }
  
  // Construct date at 15:30 IST to be safe
  const isoStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T15:30:00.000+05:30`;
  return new Date(isoStr);
}

// Find all unique expiry dates for the symbol
export function getAvailableExpiries(symbol: IndexName, scrips: ScripItem[]): Date[] {
  const dates = new Set<string>();
  const expiryMap = new Map<string, Date>();

  for (const item of scrips) {
    if (item.name === symbol && item.exch_seg === 'NFO' && item.instrumenttype === 'OPTIDX') {
      if (!dates.has(item.expiry)) {
        try {
          const d = parseExpiryDate(item.expiry);
          dates.add(item.expiry);
          expiryMap.set(item.expiry, d);
        } catch {
          // ignore parsing error
        }
      }
    }
  }

  return Array.from(expiryMap.values()).sort((a, b) => a.getTime() - b.getTime());
}

// Find T0 and T1 expiry dates
export function resolveT0AndT1(symbol: IndexName, scrips: ScripItem[], today: Date): { T0: Date; T1: Date } {
  const expiries = getAvailableExpiries(symbol, scrips);
  
  // Filter for weekly expiries. In Nifty, weekly expiries fall on Tuesday.
  // Wait, let's filter dates that are >= today and fall on a Tuesday.
  const upcomingTuesdays = expiries.filter((date) => {
    if (date.getTime() < today.getTime()) return false;
    
    // Check if Tuesday
    const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short',
    });
    const weekday = weekdayFormatter.format(date);
    return weekday === 'Tue';
  });

  if (upcomingTuesdays.length < 2) {
    throw new Error(`Insufficient upcoming Tuesday weekly expiries found. Found: ${upcomingTuesdays.length}`);
  }

  const T0 = upcomingTuesdays[0];
  
  // T1 is exactly 1 calendar week (7 days) after T0 on the weekly chain
  const expectedT1Time = T0.getTime() + 7 * 24 * 60 * 60 * 1000;
  
  // Find the closest date matching expectedT1Time (allowing some holiday shift if T1 Tuesday is shifted)
  const T1 = upcomingTuesdays.find((d) => Math.abs(d.getTime() - expectedT1Time) < 2 * 24 * 60 * 60 * 1000);
  
  if (!T1) {
    throw new Error(`Could not resolve T1 (T0 + 7 days) on the weekly expiry chain.`);
  }

  return { T0, T1 };
}
