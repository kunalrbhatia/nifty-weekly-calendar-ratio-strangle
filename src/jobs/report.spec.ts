import { parseMtmLogLines } from '../analysis/generateReport.js';

describe('Report Generation Smoke Test', () => {
  it('should parse MtmLogLines correctly from a fixture log file content', () => {
    const fixtureLog = `
[28/7/2026, 9:45:00 am] [INFO] NIFTY: MTM = -120.50
[28/7/2026, 9:46:00 am] [INFO] NIFTY: MTM = 50.00
[28/7/2026, 3:15:00 pm] [INFO] NIFTY: MTM = 3500.00
[28/7/2026, 3:16:00 pm] [INFO] NIFTY: MTM = 3974.75
    `.trim();

    const records = parseMtmLogLines(fixtureLog);

    expect(records.length).toBe(4);
    
    expect(records[0]).toEqual({
      timestamp: '28/7/2026, 9:45:00 am',
      index: 'NIFTY',
      mtm: -120.50
    });

    expect(records[3]).toEqual({
      timestamp: '28/7/2026, 3:16:00 pm',
      index: 'NIFTY',
      mtm: 3974.75
    });

    // Verify Open, Close, High, Low logic can be computed
    const openMtm = records[0].mtm;
    const closeMtm = records[records.length - 1].mtm;
    
    let highMtm = -Infinity;
    let lowMtm = Infinity;

    for (const r of records) {
      if (r.mtm > highMtm) highMtm = r.mtm;
      if (r.mtm < lowMtm) lowMtm = r.mtm;
    }

    expect(openMtm).toBe(-120.50);
    expect(closeMtm).toBe(3974.75);
    expect(highMtm).toBe(3974.75);
    expect(lowMtm).toBe(-120.50);
  });
});
