import { Router } from 'express';
import { asyncHandler } from '../middleware/async-handler.js';
import { routerBaseUrl, routerJson } from '../upstream/router-client.js';

interface RouterHealth {
  status?: string;
  services?: Record<string, { status?: string; detail?: string }>;
}

export const healthRoutes = Router();

healthRoutes.get('/health', asyncHandler(async (req, res) => {
  try {
    const upstream = await routerJson<RouterHealth>('/healthz', req.requestId, {}, routerBaseUrl(req));
    res.json({
      status: upstream.status === 'healthy' ? 'healthy' : 'degraded',
      version: '0.1.0',
      services: { gateway: { status: 'healthy' }, router: { status: upstream.status ?? 'unknown' }, ...(upstream.services ?? {}) },
    });
  } catch {
    res.status(503).json({
      status: 'unavailable', version: '0.1.0',
      services: { gateway: { status: 'healthy' }, router: { status: 'unavailable', detail: 'Cannot reach router.' } },
    });
  }
}));
