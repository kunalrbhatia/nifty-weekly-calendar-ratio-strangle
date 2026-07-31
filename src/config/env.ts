import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.string().default('development'),
  
  // Broker Credentials
  API_KEY: z.string(),
  CLIENT_CODE: z.string(),
  CLIENT_PIN: z.string(),
  CLIENT_TOTP_PIN: z.string(),
  
  // Telegram
  USE_TELEGRAM: z.coerce.boolean().default(false),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  
  // Slack
  USE_SLACK: z.coerce.boolean().default(false),
  SLACK_WEBHOOK_URL: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),
  
  // Strategy Specific
  EXIT_THRESHOLD_PCT: z.coerce.number().default(2),
  WORTHLESS_LTP_THRESHOLD: z.coerce.number().default(5),
  TRADE_CLOSE_HOUR: z.coerce.number().default(15),
  TRADE_CLOSE_MINUTE: z.coerce.number().default(20),
  REPORT_HOUR: z.coerce.number().default(15),
  REPORT_MINUTE: z.coerce.number().default(40),
});

const isTest = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;

const sourceEnv = isTest 
  ? {
      API_KEY: 'mock-api-key',
      CLIENT_CODE: 'mock-client',
      CLIENT_PIN: '1234',
      CLIENT_TOTP_PIN: 'mock-totp',
      ...process.env
    }
  : process.env;

const parsed = envSchema.safeParse(sourceEnv);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;

