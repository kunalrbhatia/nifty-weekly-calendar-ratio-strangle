import fs from 'fs';
import path from 'path';
import { sendAlert } from '../notifier.js';

const STORE_DIR = path.join(process.cwd(), 'data');
const STORE_FILE = path.join(STORE_DIR, 'position-nifty.json');

export interface LegState {
  symbol: string;
  token: string;
  strike: number;
  optionType: 'CE' | 'PE';
  expiry: string; // DDMMMYYYY
  side: 'BUY' | 'SELL';
  qty: number;
  fillPremium: number;
  orderId: string;
  status: 'OPEN' | 'CLOSED' | 'EXPIRED_UNBOOKED';
  exitOrderId?: string;
  exitPremium?: number;
}

export interface PositionState {
  status: 'NONE' | 'PARTIAL_ENTRY' | 'FULL_ENTRY' | 'CLOSED';
  niftyLTP: number;
  T0: string; // YYYY-MM-DD
  T1: string; // YYYY-MM-DD
  entryTimestamp: string;
  entryMargin: number;
  exitThreshold: number;
  legs: LegState[];
  exitReason?: 'THRESHOLD_BREACH' | 'EXPIRY_WIND_DOWN' | 'MANUAL';
  exitTimestamp?: string;
}

const defaultState: PositionState = {
  status: 'NONE',
  niftyLTP: 0,
  T0: '',
  T1: '',
  entryTimestamp: '',
  entryMargin: 0,
  exitThreshold: 0,
  legs: [],
};

export function initStore() {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true });
  }
  if (!fs.existsSync(STORE_FILE)) {
    saveStore(defaultState);
  }
}

export function loadStore(): PositionState {
  initStore();
  try {
    const data = fs.readFileSync(STORE_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Failed to load position store:', err);
    return { ...defaultState };
  }
}

export function saveStore(state: PositionState): void {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save position store:', err);
  }
}

export function clearStore(): void {
  // Before clearing, verify rule §2.1 & §2.6: reports read from MTM logs and we snapshot before close.
  // We keep the post-close snapshot in place for the 15:40 report and clear it only on next entry initialization
  // or at midnight. Let's make it safe: do not clear the file immediately on exit.
  // Instead, the exit flow sets status: 'CLOSED' and records exit details, keeping them intact for reports.
  // We only reset the store when a new entry sequence begins or manually.
  saveStore({ ...defaultState });
  console.log('Position store reset/cleared.');
}
