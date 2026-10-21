import type { RequestHandler } from 'express';

/** Converts an async Express handler rejection into the shared error middleware path. */
export const asyncHandler = (handler: RequestHandler): RequestHandler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};
