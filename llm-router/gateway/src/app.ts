import cors from 'cors';
import express, { type Express, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { config } from './config.js';
import { logger } from './logger.js';
import { httpDuration, httpRequests, registry } from './metrics.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { errorMiddleware } from './middleware/errors.js';
import { benchmarkRoutes } from './routes/benchmarks.js';
import { cacheRoutes } from './routes/cache.js';
import { chatRoutes } from './routes/chat.js';
import { healthRoutes } from './routes/health.js';
import { metricsRoutes } from './routes/metrics.js';
import { modelRoutes } from './routes/models.js';
import { previewRoutes } from './routes/preview.js';
import { statsRoutes } from './routes/stats.js';

export interface AppOptions {
  routerUrl?: string;
  corsOrigins?: string[];
  rateLimitPerMinute?: number;
  rateLimitWindowMs?: number;
  maxRequestBytes?: number;
}

/** Creates an independently configurable Express app for production and integration tests. */
export const createApp = (options: AppOptions = {}): Express => {
  const app = express();
  const origins = options.corsOrigins ?? config.corsOrigins;
  const bodyLimit = options.maxRequestBytes ?? config.MAX_REQUEST_BYTES;
  const rateLimitWindowMs = options.rateLimitWindowMs ?? config.RATE_LIMIT_WINDOW_MS;
  const limiter = rateLimit({
    windowMs: rateLimitWindowMs,
    limit: options.rateLimitPerMinute ?? config.RATE_LIMIT_PER_MIN,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: (req) => req.path === '/health' || req.path.startsWith('/benchmark/'),
    handler: (req, res) => {
      res.setHeader('Retry-After', String(Math.ceil(rateLimitWindowMs / 1000)));
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again shortly.', request_id: req.requestId },
      });
    },
  });

  app.locals.routerUrl = options.routerUrl ?? config.ROUTER_URL;
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(requestIdMiddleware);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({
    origin(origin, callback) {
      if (!origin || origins.includes(origin)) callback(null, true);
      else callback(null, false);
    },
    credentials: false,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['content-type', 'x-request-id'],
    exposedHeaders: ['x-request-id', 'retry-after'],
  }));
  app.use(express.json({ limit: bodyLimit, strict: true }));

  const requestTelemetry: RequestHandler = (req, res, next) => {
    const started = process.hrtime.bigint();
    res.once('finish', () => {
      const elapsedSeconds = Number(process.hrtime.bigint() - started) / 1_000_000_000;
      const route = String(req.route?.path ?? (req.path === '/metrics' ? '/metrics' : 'unmatched'));
      const labels = { method: req.method, route, status: String(res.statusCode) };
      httpRequests.inc(labels);
      httpDuration.observe(labels, elapsedSeconds);
      logger.info({ request_id: req.requestId, method: req.method, route, status: res.statusCode, duration_ms: elapsedSeconds * 1000 }, 'http request');
    });
    next();
  };
  app.use(requestTelemetry);

  app.get('/metrics', metricsRoutes);
  app.use('/api', limiter);
  app.use('/api', healthRoutes);
  app.use('/api', chatRoutes);
  app.use('/api', previewRoutes);
  app.use('/api', modelRoutes);
  app.use('/api', statsRoutes);
  app.use('/api', cacheRoutes);
  app.use('/api', benchmarkRoutes);

  app.use((req, res) => {
    res.status(404).json({
      error: { code: 'INVALID_REQUEST', message: 'Endpoint not found.', request_id: req.requestId },
    });
  });
  app.use(errorMiddleware);
  return app;
};

/** Exposed for tests that want to scrape a clean registry. */
export const metricsRegistry = registry;
