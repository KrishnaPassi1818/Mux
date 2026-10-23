import { Router } from 'express';
import { asyncHandler } from '../middleware/async-handler.js';
import { validateBody } from '../middleware/validation.js';
import { previewRequestSchema } from '../validation.js';
import { routerBaseUrl, routerJson } from '../upstream/router-client.js';

export const previewRoutes = Router();

previewRoutes.post('/route/preview', validateBody(previewRequestSchema), asyncHandler(async (req, res) => {
  const decision = await routerJson<unknown>('/v1/route/preview', req.requestId, { method: 'POST', body: JSON.stringify(req.body) }, routerBaseUrl(req));
  res.json(decision);
}));
