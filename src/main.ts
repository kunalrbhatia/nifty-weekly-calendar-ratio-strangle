import './helpers/logger.js'; // must be first — patches console.log/warn/error
import cron from 'node-cron';
import { env } from './config/env.js';
import { startHealthServer } from './server.js';
import { initTelegramBot } from './telegram/bot.js';
import { loginToBroker } from './helpers/login.js';
import { downloadScripMaster, loadCachedScrips } from './helpers/scripMaster.js';
import { isHoliday, getNextTradingDay, getISTDateParts } from './helpers/holidayCheck.js';
import { runEntrySequence } from './jobs/entry.js';
import { executeExit } from './jobs/monitor.js';
import { runReportGeneration } from '../analysis/generateReport.js';
import { loadStore } from './store/index.js';
import { connectWebSocket } from './helpers/websocket.js';
import { sendAlert } from './notifier.js';

async function initializeApp() {
  console.log('--- Initializing Nifty weekly strangle trading bot ---');

  // Load store
  const store = loadStore();

  // Login to Broker
  const loggedIn = await loginToBroker();
  if (!loggedIn) {
    console.error('Failed to log in on startup. Exiting.');
    process.exit(1);
  }

  // Download / Refresh Scrip Master
  try {
    await downloadScripMaster();
  } catch (err) {
    console.warn('Failed to download scrip master on startup, using cached file.');
  }

  // Resume active trade monitoring if open
  if (store.status === 'FULL_ENTRY' || store.status === 'PARTIAL_ENTRY') {
    console.log(
      `[RESUME] Active trade found in state: ${store.status}. Resuming WebSocket monitor...`
    );
    const activeTokens = store.legs.map((l) => l.token);
    activeTokens.push('99926000'); // include spot
    try {
      await connectWebSocket(activeTokens);
      await sendAlert('🔄 Bot restarted/resumed: WebSocket monitor reconnected.');
    } catch (err: any) {
      console.error('Failed to reconnect WebSocket monitor on resume:', err);
    }
  }

  // Start server and bot
  startHealthServer();
  initTelegramBot();

  // --- Cron Schedules (Asia/Kolkata) ---

  // 1. Scrip Master Refresh Daily at 08:30 AM IST (Monday to Friday)
  cron.schedule(
    '30 8 * * 1-5',
    async () => {
      console.log('[CRON] Refreshing scrip master...');
      try {
        await downloadScripMaster();
      } catch (err: any) {
        await sendAlert(`🚨 Failed to refresh scrip master: ${err.message}`);
      }
    },
    { timezone: 'Asia/Kolkata' }
  );

  // 2. Entry sequence run at 09:45 AM IST strictly on Wednesday (or next trading day if Wednesday is a holiday)
  cron.schedule(
    '45 9 * * 1-5',
    async () => {
      console.log('[CRON] Running entry schedule check...');
      const today = new Date();
      const parts = getISTDateParts(today);
      const dayOfWeek = today.getDay(); // 0 = Sun, 3 = Wed

      // Verify today is Wednesday (3) OR if Wednesday was a holiday, check if today is the resolved next trading day
      let isScheduledEntryDay = dayOfWeek === 3; // Wednesday

      // Handle Wednesday holiday fallback
      if (!isScheduledEntryDay) {
        // Resolve current week's Wednesday
        const currentWednesday = new Date(today.getTime());
        const diff = 3 - dayOfWeek;
        currentWednesday.setDate(currentWednesday.getDate() + diff);

        if (isHoliday(currentWednesday)) {
          const resolvedEntryDay = getNextTradingDay(currentWednesday);
          const rParts = getISTDateParts(resolvedEntryDay);
          if (
            parts.year === rParts.year &&
            parts.month === rParts.month &&
            parts.day === rParts.day
          ) {
            isScheduledEntryDay = true;
          }
        }
      }

      if (isScheduledEntryDay) {
        console.log(
          '[CRON] Today is the resolved entry day (Wednesday / holiday fallback). Running entry sequence.'
        );
        try {
          await runEntrySequence();
        } catch (err: any) {
          await sendAlert(`🚨 Entry sequence failed: ${err.message}`);
        }
      } else {
        console.log(
          `[CRON] Entry skipped today. Entry runs strictly on Wednesday (or next trading day if Wednesday is a holiday).`
        );
      }
    },
    { timezone: 'Asia/Kolkata' }
  );

  // 3. Expiry day wind-down on Tuesdays at 15:15 IST (03:15 PM IST)
  cron.schedule(
    `${env.TRADE_CLOSE_MINUTE} ${env.TRADE_CLOSE_HOUR} * * 2`,
    async () => {
      console.log(
        `[CRON] Running expiry-day exit wind-down at ${env.TRADE_CLOSE_HOUR}:${env.TRADE_CLOSE_MINUTE} IST...`
      );
      try {
        await executeExit('EXPIRY_WIND_DOWN', true);
      } catch (err: any) {
        await sendAlert(`🚨 Expiry-day wind-down failed: ${err.message}`);
      }
    },
    { timezone: 'Asia/Kolkata' }
  );

  // 4. Daily Report at 15:40 IST (Monday to Friday)
  cron.schedule(
    '40 15 * * 1-5',
    async () => {
      console.log('[CRON] Running daily trade report generation...');
      try {
        await runReportGeneration();
      } catch (err: any) {
        await sendAlert(`🚨 Daily report generation failed: ${err.message}`);
      }
    },
    { timezone: 'Asia/Kolkata' }
  );
}

initializeApp().catch((err) => {
  console.error('Initialization error:', err);
});
