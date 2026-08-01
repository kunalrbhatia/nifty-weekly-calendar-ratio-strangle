import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logsDir = path.join(__dirname, '../../logs');

// Custom console format: [HH:MM:SS] LEVEL: message
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] ${level}: ${message}${metaStr}`;
  })
);

// File format: full ISO timestamp + structured JSON
const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const dailyRotateTransport = new DailyRotateFile({
  dirname: logsDir,
  filename: 'app_%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxFiles: '30d', // keep 30 days of logs
  zippedArchive: true,
  format: fileFormat,
  level: 'debug',
});

export const logger = winston.createLogger({
  level: 'debug',
  transports: [new winston.transports.Console({ format: consoleFormat }), dailyRotateTransport],
  exitOnError: false,
});

// Replace global console.log/warn/error so existing code is captured too
console.log = (...args: any[]) => logger.info(args.map(String).join(' '));
console.warn = (...args: any[]) => logger.warn(args.map(String).join(' '));
console.error = (...args: any[]) => logger.error(args.map(String).join(' '));
