import { Router } from 'express';
import { setTimeout as delay } from 'node:timers/promises';
import { asyncHandler } from '../middleware/async-handler.js';
import { logger } from '../logger.js';
import { routerBaseUrl, routerJson } from '../upstream/router-client.js';

export const statsRoutes = Router();

statsRoutes.get('/stats', asyncHandler(async (req, res) => {
  const snapshot = await routerJson<unknown>('/v1/stats', req.requestId, {}, routerBaseUrl(req));
  res.json(snapshot);
}));

statsRoutes.get('/stats/stream', asyncHandler(async (req, res) => {
  res.status(200).set({ 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.flushHeaders();
  let clientOpen = true;
  let currentPoll: AbortController | undefined;
  const closeStream = (): void => { clientOpen = false; currentPoll?.abort(); };
  res.once('close', closeStream);

  try {
    while (clientOpen) {
      currentPoll = new AbortController();
      try {
        const snapshot = await routerJson<unknown>('/v1/stats', req.requestId, { signal: currentPoll.signal }, routerBaseUrl(req));
        if (!clientOpen) break;
        res.write(`event: stats\ndata: ${JSON.stringify(snapshot)}\n\n`);
      } catch (error) {
        if (!clientOpen) break;
        logger.warn({ err: error, request_id: req.requestId }, 'stats stream poll failed');
        res.write(': ping\n\n');
      } finally {
        currentPoll = undefined;
      }
      await delay(1000).catch(() => undefined);
    }
  } finally {
    res.off('close', closeStream);
    if (!res.writableEnded) res.end();
  }
}));
