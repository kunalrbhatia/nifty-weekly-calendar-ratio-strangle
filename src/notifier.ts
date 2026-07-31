import axios from 'axios';
import { Telegraf } from 'telegraf';
import { env } from './config/env.js';

let bot: Telegraf | null = null;

if (env.USE_TELEGRAM && env.TELEGRAM_BOT_TOKEN) {
  bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);
}

export async function sendAlert(message: string): Promise<void> {
  console.log(`[ALERT] ${message}`);

  if (env.USE_TELEGRAM && bot && env.TELEGRAM_CHAT_ID) {
    try {
      await bot.telegram.sendMessage(env.TELEGRAM_CHAT_ID, message, {
        parse_mode: 'Markdown',
      });
    } catch (err) {
      console.error('Failed to send Telegram alert:', err);
    }
  }

  if (env.USE_SLACK && env.SLACK_WEBHOOK_URL) {
    try {
      await axios.post(env.SLACK_WEBHOOK_URL, { text: message }, { timeout: 5000 });
    } catch (err) {
      console.error('Failed to send Slack alert:', err);
    }
  }
}

export function getTelegramBot(): Telegraf | null {
  return bot;
}
