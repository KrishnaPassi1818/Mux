import { createHash } from 'node:crypto';
import { Router } from 'express';
import { clientAborts } from '../metrics.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { validateBody } from '../middleware/validation.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { routerBaseUrl } from '../upstream/router-client.js';
import { chatRequestSchema } from '../validation.js';

export const chatRoutes = Router();

chatRoutes.post('/chat', validateBody(chatRequestSchema), asyncHandler(async (req, res) => {
  const request = chatRequestSchema.parse(req.body);
  const latestUser = [...request.messages].reverse().find((message) => message.role === 'user')?.content ?? '';
  const promptHash = createHash('sha256').update(latestUser).digest('hex').slice(0, 8);
  logger.info({ request_id: req.requestId, prompt_hash: promptHash, prompt_len: Buffer.byteLength(latestUser) }, 'chat request accepted');

  const controller = new AbortController();
  let clientDisconnected = false;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('upstream timeout'));
  }, config.REQUEST_TIMEOUT_MS);
  const onClose = (): void => {
    if (!res.writableEnded) {
      clientDisconnected = true;
      controller.abort(new Error('client disconnected'));
      clientAborts.inc();
      logger.info({ request_id: req.requestId }, 'chat stream cancelled by client');
    }
  };
  res.once('close', onClose);

  try {
    const upstream = await fetch(new URL('/v1/route/chat', routerBaseUrl(req)), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        'x-request-id': req.requestId,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    if (!upstream.ok) {
      const code = upstream.status === 429 ? 'QUEUE_FULL' : upstream.status === 504 ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE';
      const status = upstream.status === 429 || upstream.status === 503 ? upstream.status : 502;
      res.status(status).json({ error: { code, message: 'The router could not accept this request.', request_id: req.requestId } });
      return;
    }
    if (!upstream.body) {
      res.status(502).json({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'The router returned an empty stream.', request_id: req.requestId } });
      return;
    }

    res.status(200).set({
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'x-request-id': req.requestId,
    });
    res.flushHeaders();

    const reader = upstream.body.getReader();
    try {
      while (!clientDisconnected) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.write(Buffer.from(value))) {
          await new Promise<void>((resolve) => res.once('drain', resolve));
        }
      }
    } finally {
      reader.releaseLock();
    }
    if (!clientDisconnected && !res.writableEnded) res.end();
  } catch (error) {
    if (clientDisconnected) return;
    const code = timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE';
    const message = timedOut ? 'The model did not finish before the request timeout.' : 'The router is temporarily unavailable.';
    if (res.headersSent) {
      res.write(`event: error\ndata: ${JSON.stringify({ code, message, request_id: req.requestId })}\n\n`);
      res.end();
    } else {
      res.status(timedOut ? 504 : 502).json({ error: { code, message, request_id: req.requestId } });
    }
    logger.warn({ err: error, request_id: req.requestId, timed_out: timedOut }, 'chat upstream failed');
  } finally {
    clearTimeout(timeout);
    res.off('close', onClose);
  }
}));
