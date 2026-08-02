import fs from 'fs';
import path from 'path';

export interface OptionRow {
  strike_price: number;
  call_inst_type: string;
  calls_ltp: number;
  calls_iv: number;
  calls_oi: number;
  calls_volume: number;
  calls_delta: number;
  calls_gamma: number;
  calls_theta: number;
  calls_vega: number;
  put_inst_type: string;
  puts_ltp: number;
  puts_iv: number;
  puts_oi: number;
  puts_volume: number;
  puts_delta: number;
  puts_gamma: number;
  puts_theta: number;
  puts_vega: number;
}

export interface ChainSnapshot {
  source: string;
  symbol_name: string;
  expiry_date: string; // YYYY-MM-DD
  snapshot_time: string; // ISO string e.g. 2026-05-04T10:45:00+05:30
  index_close: number;
  greeks_available: boolean;
  rows: OptionRow[];
}

export interface ManifestData {
  lastUpdated: string;
  collected: Record<
    string,
    {
      date: string;
      time: string;
      expiry: string;
      source: string;
      timestamp: string;
    }
  >;
  gaps?: Record<
    string,
    {
      date: string;
      time: string;
      expiry: string;
      reason: string;
    }
  >;
}

export class DataLoader {
  private dataRoot: string;
  private manifest: ManifestData | null = null;
  private snapshotCache = new Map<string, ChainSnapshot | null>();

  constructor(dataRoot: string) {
    this.dataRoot = dataRoot;
    this.loadManifest();
  }

  private loadManifest() {
    const manifestPath = path.join(this.dataRoot, 'data', 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      try {
        const raw = fs.readFileSync(manifestPath, 'utf8');
        this.manifest = JSON.parse(raw);
      } catch (err) {
        console.warn(`[DataLoader] Could not load manifest at ${manifestPath}`);
      }
    }
  }

  public getManifest(): ManifestData | null {
    return this.manifest;
  }

  public isGap(dateStr: string, hhmm: string, expiryDateStr: string): boolean {
    if (!this.manifest?.gaps) return false;
    const timeFormatted = `${hhmm.substring(0, 2)}:${hhmm.substring(2, 4)}:00`;
    for (const gapKey of Object.keys(this.manifest.gaps)) {
      const gap = this.manifest.gaps[gapKey];
      if (
        gap.date === dateStr &&
        gap.time.startsWith(hhmm.substring(0, 2) + ':' + hhmm.substring(2, 4)) &&
        gap.expiry === expiryDateStr
      ) {
        return true;
      }
    }
    return false;
  }

  public loadSnapshot(
    dateStr: string, // YYYY-MM-DD (date folder name)
    hhmm: string, // e.g. "0945"
    expiryDateStr: string // YYYY-MM-DD
  ): ChainSnapshot | null {
    const cacheKey = `${dateStr}_${hhmm}_${expiryDateStr}`;
    if (this.snapshotCache.has(cacheKey)) {
      return this.snapshotCache.get(cacheKey)!;
    }

    const filePath = path.join(
      this.dataRoot,
      'data',
      'chains',
      dateStr,
      `${expiryDateStr}_${hhmm}.json`
    );

    if (!fs.existsSync(filePath)) {
      this.snapshotCache.set(cacheKey, null);
      return null;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const snapshot: ChainSnapshot = JSON.parse(content);
      if (snapshot.expiry_date !== expiryDateStr) {
        this.snapshotCache.set(cacheKey, null);
        return null;
      }
      this.snapshotCache.set(cacheKey, snapshot);
      return snapshot;
    } catch (err) {
      this.snapshotCache.set(cacheKey, null);
      return null;
    }
  }

  public getAvailableDates(): string[] {
    const chainsDir = path.join(this.dataRoot, 'data', 'chains');
    if (!fs.existsSync(chainsDir)) return [];
    const entries = fs.readdirSync(chainsDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
      .map((e) => e.name)
      .sort();
  }

  public getExpiriesForDate(dateStr: string): string[] {
    const dir = path.join(this.dataRoot, 'data', 'chains', dateStr);
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir);
    const expiries = new Set<string>();
    for (const f of files) {
      const match = f.match(/^(\d{4}-\d{2}-\d{2})_\d{4}\.json$/);
      if (match) {
        expiries.add(match[1]);
      }
    }
    return Array.from(expiries).sort();
  }
}
