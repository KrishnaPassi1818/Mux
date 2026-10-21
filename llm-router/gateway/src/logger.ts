import { pino } from 'pino';
import { config } from './config.js';

/** Structured logger. Prompt and completion payloads are never attached to log records. */
export const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: ['req.body.messages', 'res.body', 'body'],
    censor: '[REDACTED]',
  },
  base: { service: 'llmr-gateway' },
  timestamp: pino.stdTimeFunctions.isoTime,
});
