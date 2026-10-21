import { Router } from 'express';
import { asyncHandler } from '../middleware/async-handler.js';
import { routerBaseUrl, routerJson } from '../upstream/router-client.js';

export const cacheRoutes = Router();

cacheRoutes.post('/cache/flush', asyncHandler(async (req, res) => {
  const result = await routerJson<unknown>('/v1/cache/flush', req.requestId, { method: 'POST' }, routerBaseUrl(req));
  res.json(result);
}));
