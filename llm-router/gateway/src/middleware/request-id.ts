import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { z } from 'zod';

const uuidSchema = z.string().uuid();

/** Propagates a caller request ID only when it is a valid UUID, otherwise creates one. */
export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const supplied = req.header('x-request-id');
  req.requestId = supplied && uuidSchema.safeParse(supplied).success ? supplied : randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
};
