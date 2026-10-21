import { Router } from 'express';
import { registry } from '../metrics.js';

export const metricsRoutes = Router();
metricsRoutes.get('/metrics', async (_req, res) => {
  res.setHeader('content-type', registry.contentType);
  res.end(await registry.metrics());
});
