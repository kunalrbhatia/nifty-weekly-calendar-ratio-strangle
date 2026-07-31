// NSE Holidays for 2026. Format: 'YYYY-MM-DD'
const NSE_HOLIDAYS_2026 = new Set([
  '2026-01-15', // Municipal Corporation Election - Maharashtra
  '2026-01-26', // Republic Day
  '2026-03-03', // Holi
  '2026-03-26', // Shri Ram Navami
  '2026-03-31', // Shri Mahavir Jayanti
  '2026-04-03', // Good Friday
  '2026-04-14', // Dr. Baba Saheb Ambedkar Jayanti
  '2026-05-01', // Maharashtra Day
  '2026-05-28', // Bakri Id
  '2026-06-26', // Muharram
  '2026-09-14', // Ganesh Chaturthi
  '2026-10-02', // Mahatma Gandhi Jayanti
  '2026-10-20', // Dussehra
  '2026-11-10', // Diwali-Balipratipada
  '2026-11-24', // Prakash Gurpurb Sri Guru Nanak Dev
  '2026-12-25', // Christmas
]);

export function getISTDateParts(date: Date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: true,
  });
  const parts = formatter.formatToParts(date);
  const partMap: Record<string, string> = {};
  for (const part of parts) {
    partMap[part.type] = part.value;
  }
  return {
    year: parseInt(partMap.year, 10),
    month: parseInt(partMap.month, 10),
    day: parseInt(partMap.day, 10),
    hour: parseInt(partMap.hour, 10),
    minute: parseInt(partMap.minute, 10),
    second: parseInt(partMap.second, 10),
    dayPeriod: partMap.dayPeriod?.toLowerCase() || 'am', // 'am' or 'pm'
  };
}

export function getISTDateString(date: Date = new Date()): string {
  const parts = getISTDateParts(date);
  const mm = String(parts.month).padStart(2, '0');
  const dd = String(parts.day).padStart(2, '0');
  return `${parts.year}-${mm}-${dd}`;
}

export function isHoliday(date: Date): boolean {
  // Check day of week in IST
  const parts = getISTDateParts(date);

  // To get the day of the week in IST:
  // We can construct a date object using the IST date parts or format the weekday
  const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
  });
  const weekday = weekdayFormatter.format(date); // 'Sun', 'Mon', etc.

  if (weekday === 'Sat' || weekday === 'Sun') {
    return true;
  }

  const dateStr = getISTDateString(date);
  return NSE_HOLIDAYS_2026.has(dateStr);
}

export function getNextTradingDay(date: Date): Date {
  const nextDate = new Date(date.getTime());
  do {
    nextDate.setDate(nextDate.getDate() + 1);
  } while (isHoliday(nextDate));
  return nextDate;
}

export function getISTStartOfDay(date: Date): Date {
  const parts = getISTDateParts(date);
  // Construct date at midnight in IST
  const isoStr = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T00:00:00.000+05:30`;
  return new Date(isoStr);
}
