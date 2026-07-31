import fs from 'fs';
import path from 'path';
import { getTelegramBot, sendAlert } from '../notifier.js';
import { env } from '../config/env.js';
import { loadStore } from '../store/index.js';
import { calculateCombinedMTM } from '../jobs/monitor.js';
import { executeExit } from '../jobs/monitor.js';

const ROOT_DIR = process.cwd();

export function initTelegramBot(): void {
  const bot = getTelegramBot();
  if (!bot) {
    console.log('Telegram bot is disabled or not configured.');
    return;
  }

  // Owner-only authorization middleware
  bot.use(async (ctx, next) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId || chatId !== env.TELEGRAM_CHAT_ID) {
      console.warn(`[TELEGRAM] Unauthorized access attempt from Chat ID: ${chatId}`);
      await ctx.reply('❌ Unauthorized. Access denied.');
      return;
    }
    return next();
  });

  // /status command
  bot.command('status', async (ctx) => {
    try {
      const store = loadStore();
      const mtmResult = calculateCombinedMTM(store);

      const fileStatus = [
        fs.existsSync(path.join(ROOT_DIR, '.paper')) ? '✅ PAPER' : '❌ LIVE',
        fs.existsSync(path.join(ROOT_DIR, '.kill')) ? '⚠️ KILL (Soft Pause)' : '✅ RUNNING',
        fs.existsSync(path.join(ROOT_DIR, '.panic')) ? '🚨 PANIC (Hard Stop)' : '✅ UNLOCKED',
      ].join(' | ');

      let message = `*Trading Bot Status*
--------------------
*Switches*: ${fileStatus}
*Position Status*: ${store.status}
`;

      if (store.status === 'FULL_ENTRY' || store.status === 'PARTIAL_ENTRY') {
        message += `
*Current MTM*: ₹${mtmResult.mtm.toFixed(2)}
*Entry Margin*: ₹${store.entryMargin}
*Exit Threshold*: ₹${store.exitThreshold.toFixed(2)}
*Entry Time*: ${store.entryTimestamp}

*Legs*:
`;
        for (const leg of store.legs) {
          message += `- \`${leg.symbol}\` (${leg.side}): ${leg.status} @ fill: ₹${leg.fillPremium}\n`;
        }
      }

      await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (err: any) {
      await ctx.reply(`Error retrieving status: ${err.message}`);
    }
  });

  // /panic and /unpanic commands
  bot.command('panic', async (ctx) => {
    fs.writeFileSync(path.join(ROOT_DIR, '.panic'), '', 'utf8');
    await ctx.reply('🚨 Hard Stop Activated (.panic). Exits and monitoring are HALTED.');
  });

  bot.command('unpanic', async (ctx) => {
    const panicFile = path.join(ROOT_DIR, '.panic');
    if (fs.existsSync(panicFile)) {
      fs.unlinkSync(panicFile);
    }
    await ctx.reply('✅ Hard Stop Deactivated (.panic). Monitoring resumed.');
  });

  // /kill and /unkill commands
  bot.command('kill', async (ctx) => {
    fs.writeFileSync(path.join(ROOT_DIR, '.kill'), '', 'utf8');
    await ctx.reply('⚠️ Soft Pause Activated (.kill). New Wednesday entries are BLOCKED.');
  });

  bot.command('unkill', async (ctx) => {
    const killFile = path.join(ROOT_DIR, '.kill');
    if (fs.existsSync(killFile)) {
      fs.unlinkSync(killFile);
    }
    await ctx.reply('✅ Soft Pause Deactivated (.kill). New entries allowed.');
  });

  // /exit command
  bot.command('exit', async (ctx) => {
    await ctx.reply('🔄 Initiating manual exit sequence...');
    try {
      await executeExit('MANUAL');
    } catch (err: any) {
      await ctx.reply(`Failed to execute exit: ${err.message}`);
    }
  });

  // Launch polling
  bot.launch();
  console.log('✓ Telegram bot started polling');
}
