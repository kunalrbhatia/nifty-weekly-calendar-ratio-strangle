import { formatMtmLogLine } from './monitor.js';

describe('MTM Log Line Formatting', () => {
  it('should match the exact blueprint specification for log line structure', () => {
    // Spec: [DD/MM/YYYY, H:mm:SS am/pm] [INFO] INDEX: MTM = VALUE
    // Note: DD/MM/YYYY without leading zeros (e.g. 28/7/2026, 3:16:00 pm)
    // Let's mock a date: July 28, 2026, 15:16:00 (3:16:00 pm) in IST timezone
    // The date ISO string for 15:16:00 IST on 2026-07-28 is "2026-07-28T15:16:00.000+05:30"
    const date = new Date('2026-07-28T15:16:00.000+05:30');
    const mtm = 3974.75;
    
    const line = formatMtmLogLine(date, 'NIFTY', mtm);
    expect(line).toBe('[28/7/2026, 3:16:00 pm] [INFO] NIFTY: MTM = 3974.75');
  });

  it('should format single-digit hour, minute, day, and month correctly without forced leading zeros', () => {
    // January 5, 2026, 09:05:00 am IST -> "2026-01-05T09:05:00.000+05:30"
    const date = new Date('2026-01-05T09:05:00.000+05:30');
    const mtm = -120.50;
    
    const line = formatMtmLogLine(date, 'NIFTY', mtm);
    expect(line).toBe('[5/1/2026, 9:05:00 am] [INFO] NIFTY: MTM = -120.5');
  });
});
