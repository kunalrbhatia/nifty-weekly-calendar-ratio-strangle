import fs from 'fs';
import path from 'path';
import { getISTDateString } from '../src/helpers/holidayCheck.js';
import { loadStore } from '../src/store/index.js';
import { sendAlert } from '../src/notifier.js';
export function parseMtmLogLines(content) {
  const records = [];
  const lines = content.split('\n');
  // Format: [DD/MM/YYYY, H:mm:SS am/pm] [INFO] INDEX: MTM = VALUE
  const regex = /^\[([^\]]+)\]\s+\[INFO\]\s+(\w+):\s+MTM\s+=\s+(-?[\d.]+)/i;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(regex);
    if (match) {
      records.push({
        timestamp: match[1],
        index: match[2].toUpperCase(),
        mtm: parseFloat(match[3]),
      });
    }
  }
  return records;
}
export async function runReportGeneration(date = new Date()) {
  const dateStr = getISTDateString(date);
  const logDir = path.join(process.cwd(), 'logs', 'mtm');
  const logPath = path.join(logDir, `mtm-nifty-${dateStr}.log`);
  console.log(`[REPORT] Generating daily trade report for ${dateStr}...`);
  if (!fs.existsSync(logPath)) {
    const alertMsg = `⚠️ Skipping daily trade report: MTM log file missing or empty for nifty on ${dateStr}`;
    console.warn(alertMsg);
    await sendAlert(alertMsg);
    return;
  }
  const logContent = fs.readFileSync(logPath, 'utf8');
  const records = parseMtmLogLines(logContent);
  if (records.length === 0) {
    const alertMsg = `⚠️ Skipping daily trade report: Parsed 0 records from MTM log file on ${dateStr}`;
    console.warn(alertMsg);
    await sendAlert(alertMsg);
    return;
  }
  // Load static position metadata for supplementary details
  const store = loadStore();
  // Compute High, Low, Open, Close
  const openMtm = records[0].mtm;
  const closeMtm = records[records.length - 1].mtm;
  let highMtm = -Infinity;
  let highTime = '';
  let lowMtm = Infinity;
  let lowTime = '';
  for (const r of records) {
    if (r.mtm > highMtm) {
      highMtm = r.mtm;
      highTime = r.timestamp;
    }
    if (r.mtm < lowMtm) {
      lowMtm = r.mtm;
      lowTime = r.timestamp;
    }
  }
  const thresholdBreached =
    store.exitThreshold > 0 && (highMtm >= store.exitThreshold || lowMtm <= -store.exitThreshold);
  // Generate Report Markdown
  let reportMd = `# Nifty Weekly Calendar Ratio Strangle Daily Report - ${dateStr}

## Session Overview
- **Date (IST)**: ${dateStr}
- **Session Open MTM**: ₹${openMtm.toFixed(2)}
- **Session Close MTM**: ₹${closeMtm.toFixed(2)}
- **Session High MTM**: ₹${highMtm.toFixed(2)} (at ${highTime})
- **Session Low MTM**: ₹${lowMtm.toFixed(2)} (at ${lowTime})
- **Exit Threshold Breached**: ${thresholdBreached ? '🚨 YES' : '✅ NO'}

`;
  if (store.entryMargin > 0) {
    const roMargin = (closeMtm / store.entryMargin) * 100;
    reportMd += `## Trade Metadata
- **Entry Margin**: ₹${store.entryMargin}
- **Exit Threshold (2%)**: ₹${store.exitThreshold.toFixed(2)}
- **Session Return on Margin**: ${roMargin.toFixed(2)}%
- **Current Position Status**: ${store.status}
- **T0 Expiry**: ${store.T0}
- **T1 Expiry**: ${store.T1}
- **Exit Reason**: ${store.exitReason || 'N/A'}
`;
  }
  reportMd += `\n## MTM Time Series Log
| Timestamp | Index | MTM |
|---|---|---|
`;
  for (const r of records) {
    reportMd += `| ${r.timestamp} | ${r.index} | ₹${r.mtm.toFixed(2)} |\n`;
  }
  // Write Report to File
  const reportDir = path.join(process.cwd(), 'analysis', 'reports');
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }
  const reportPath = path.join(reportDir, `nifty-${dateStr}.md`);
  fs.writeFileSync(reportPath, reportMd, 'utf8');
  console.log(`✓ Daily trade report written to ${reportPath}`);
}
