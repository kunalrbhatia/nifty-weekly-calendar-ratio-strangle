import {
  getISTDateParts,
  getISTDateString,
  isHoliday,
  getNextTradingDay,
  getISTStartOfDay,
} from './holidayCheck.js';

describe('holidayCheck', () => {
  it('should get correct IST date parts', () => {
    // 2026-07-31T12:00:00.000Z
    const d = new Date('2026-07-31T12:00:00.000Z'); // 5:30 PM IST
    const parts = getISTDateParts(d);
    expect(parts.year).toBe(2026);
    expect(parts.month).toBe(7);
    expect(parts.day).toBe(31);
  });

  it('should get correct IST date string', () => {
    const d = new Date('2026-07-31T12:00:00.000Z');
    expect(getISTDateString(d)).toBe('2026-07-31');
  });

  it('should identify weekends as holidays', () => {
    const saturday = new Date('2026-08-01T12:00:00.000Z'); // Saturday
    expect(isHoliday(saturday)).toBe(true);

    const sunday = new Date('2026-08-02T12:00:00.000Z'); // Sunday
    expect(isHoliday(sunday)).toBe(true);
  });

  it('should identify NSE holidays in 2026', () => {
    // Republic Day: 2026-01-26
    const holiday = new Date('2026-01-26T10:00:00.000+05:30');
    expect(isHoliday(holiday)).toBe(true);
  });

  it('should identify normal trading days', () => {
    const tradingDay = new Date('2026-07-29T10:00:00.000+05:30'); // Wednesday
    expect(isHoliday(tradingDay)).toBe(false);
  });

  it('should find the next valid trading day', () => {
    // Friday before a weekend: 2026-07-31
    const friday = new Date('2026-07-31T10:00:00.000+05:30');
    const next = getNextTradingDay(friday);
    // Next should be Monday: 2026-08-03
    expect(getISTDateString(next)).toBe('2026-08-03');
  });

  it('should get IST start of day date object', () => {
    const d = new Date('2026-07-31T15:00:00.000+05:30');
    const start = getISTStartOfDay(d);
    expect(start.toISOString()).toContain('T18:30:00.000Z'); // 00:00:00.000+05:30 is 18:30:00.000Z the previous day
  });
});
