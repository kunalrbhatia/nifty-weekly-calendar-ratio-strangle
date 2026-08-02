import { DataLoader } from './dataLoader.js';
import { isHoliday } from '../src/helpers/holidayCheck.js';

export interface CycleDef {
  cycleId: string; // e.g. "2026-05-04_to_2026-05-05"
  entryDate: string; // YYYY-MM-DD
  entryTime: string; // "0945" (or "0940" fallback)
  exitDate: string; // YYYY-MM-DD
  exitTime: string; // "1515"
  T0Expiry: string; // YYYY-MM-DD
  T1Expiry: string; // YYYY-MM-DD
  tradingDays: string[]; // List of YYYY-MM-DD included in cycle
  isValidData: boolean;
  skipReason?: string;
}

export function generateDayTimeStamps(): string[] {
  const times: string[] = [];
  let h = 9;
  let m = 15;
  while (h < 15 || (h === 15 && m <= 30)) {
    const hh = String(h).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    times.push(`${hh}${mm}`);
    m += 5;
    if (m >= 60) {
      h += 1;
      m = 0;
    }
  }
  return times;
}

function parseDateStr(dateStr: string): Date {
  return new Date(`${dateStr}T12:00:00+05:30`);
}

function formatDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function buildWeeklyCycles(
  dataLoader: DataLoader,
  fromDate?: string,
  toDate?: string
): CycleDef[] {
  const availableDates = dataLoader.getAvailableDates();
  if (availableDates.length === 0) return [];

  const startLimit = fromDate || availableDates[0];
  const endLimit = toDate || availableDates[availableDates.length - 1];

  const cycles: CycleDef[] = [];

  for (const dateStr of availableDates) {
    const expiries = dataLoader.getExpiriesForDate(dateStr);
    const validExpiries = expiries.filter((exp) => exp >= dateStr).sort();

    if (validExpiries.length >= 2) {
      const T0Expiry = validExpiries[0];
      const T1Expiry = validExpiries[1];

      let exitDateStr = T0Expiry;
      const exitDateObj = parseDateStr(T0Expiry);
      if (isHoliday(exitDateObj)) {
        let prevDay = new Date(exitDateObj.getTime() - 86400000);
        while (isHoliday(prevDay)) {
          prevDay = new Date(prevDay.getTime() - 86400000);
        }
        exitDateStr = formatDateStr(prevDay);
      }

      const cycleId = `${dateStr}_to_${exitDateStr}`;
      if (cycles.some((c) => c.cycleId === cycleId)) continue;

      // Build list of trading days
      const tradingDays: string[] = [];
      let d = parseDateStr(dateStr);
      const exitD = parseDateStr(exitDateStr);
      while (d <= exitD) {
        if (!isHoliday(d)) {
          tradingDays.push(formatDateStr(d));
        }
        d = new Date(d.getTime() + 86400000);
      }

      if (dateStr >= startLimit && exitDateStr <= endLimit) {
        let totalRequiredSnapshots = 0;
        let presentSnapshots = 0;
        let hasGap = false;

        const dayTimes = generateDayTimeStamps();

        for (const day of tradingDays) {
          for (const time of dayTimes) {
            if (day === dateStr && time < '0945') continue;
            if (day === exitDateStr && time > '1515') continue;

            totalRequiredSnapshots += 2; // For T0 and T1

            if (dataLoader.isGap(day, time, T0Expiry) || dataLoader.isGap(day, time, T1Expiry)) {
              hasGap = true;
            }

            const s0 = dataLoader.loadSnapshot(day, time, T0Expiry);
            const s1 = dataLoader.loadSnapshot(day, time, T1Expiry);
            if (s0) presentSnapshots++;
            if (s1) presentSnapshots++;
          }
        }

        const entryS0 =
          dataLoader.loadSnapshot(dateStr, '0945', T0Expiry) ||
          dataLoader.loadSnapshot(dateStr, '0940', T0Expiry);
        const entryS1 =
          dataLoader.loadSnapshot(dateStr, '0945', T1Expiry) ||
          dataLoader.loadSnapshot(dateStr, '0940', T1Expiry);

        const exitS0 =
          dataLoader.loadSnapshot(exitDateStr, '1515', T0Expiry) ||
          dataLoader.loadSnapshot(exitDateStr, '1520', T0Expiry) ||
          dataLoader.loadSnapshot(exitDateStr, '1510', T0Expiry);
        const exitS1 =
          dataLoader.loadSnapshot(exitDateStr, '1515', T1Expiry) ||
          dataLoader.loadSnapshot(exitDateStr, '1520', T1Expiry) ||
          dataLoader.loadSnapshot(exitDateStr, '1510', T1Expiry);

        let isValidData = true;
        let skipReason: string | undefined;

        if (hasGap) {
          isValidData = false;
          skipReason = 'DATA_GAP_DECLARED_IN_MANIFEST';
        } else if (!entryS0 || !entryS1) {
          isValidData = false;
          skipReason = 'MISSING_ENTRY_SNAPSHOT';
        } else if (!exitS0 || !exitS1) {
          isValidData = false;
          skipReason = 'MISSING_EXIT_SNAPSHOT';
        } else if (totalRequiredSnapshots > 0 && presentSnapshots / totalRequiredSnapshots < 0.5) {
          isValidData = false;
          skipReason = `INSUFFICIENT_SNAPSHOTS (${presentSnapshots}/${totalRequiredSnapshots})`;
        }

        cycles.push({
          cycleId,
          entryDate: dateStr,
          entryTime: dataLoader.loadSnapshot(dateStr, '0945', T0Expiry) ? '0945' : '0940',
          exitDate: exitDateStr,
          exitTime: dataLoader.loadSnapshot(exitDateStr, '1515', T0Expiry)
            ? '1515'
            : dataLoader.loadSnapshot(exitDateStr, '1520', T0Expiry)
              ? '1520'
              : '1510',
          T0Expiry,
          T1Expiry,
          tradingDays,
          isValidData,
          skipReason,
        });
      }
    }
  }

  return cycles;
}
