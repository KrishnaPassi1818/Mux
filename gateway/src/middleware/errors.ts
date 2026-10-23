import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from '../logger.js';

/** Central contract-shaped error handler for all non-streaming routes. */
export const errorMiddleware: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  void _next;
  if (res.headersSent) {
    res.destroy(error instanceof Error ? error : undefined);
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'INVALID_REQUEST',
        message: 'Request did not match the API contract.',
        request_id: req.requestId,
        details: error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
      },
    });
    return;
  }
  const candidate = error instanceof Error ? error : new Error('Unknown gateway error');
  logger.error({ err: candidate, request_id: req.requestId }, 'request failed');
  res.status(500).json({
    error: { code: 'INTERNAL', message: 'An unexpected gateway error occurred.', request_id: req.requestId },
  });
};
