import { Router } from 'express';
import { asyncHandler } from '../middleware/async-handler.js';
import { routerBaseUrl, routerJson } from '../upstream/router-client.js';

export const modelRoutes = Router();

modelRoutes.get('/models', asyncHandler(async (req, res) => {
  const models = await routerJson<unknown>('/v1/models', req.requestId, {}, routerBaseUrl(req));
  res.json(models);
}));
