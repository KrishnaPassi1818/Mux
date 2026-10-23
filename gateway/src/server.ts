import 'dotenv/config';
import { createServer } from 'node:http';
import { config } from './config.js';
import { createApp } from './app.js';
import { logger } from './logger.js';

const server = createServer(createApp());
server.requestTimeout = config.REQUEST_TIMEOUT_MS + 10_000;
server.headersTimeout = 15_000;
server.listen(config.GATEWAY_PORT, config.GATEWAY_HOST, () => {
  logger.info({ host: config.GATEWAY_HOST, port: config.GATEWAY_PORT }, 'gateway listening');
});

const shutdown = (signal: string): void => {
  logger.info({ signal }, 'gateway shutdown requested');
  server.close((error) => {
    if (error) {
      logger.error({ err: error }, 'gateway shutdown failed');
      process.exitCode = 1;
    }
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
