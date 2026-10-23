import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

/** Validates a JSON request body and replaces it with the parsed/normalized value. */
export const validateBody = (schema: ZodType): RequestHandler => (req, _res, next) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    next(parsed.error);
    return;
  }
  req.body = parsed.data;
  next();
};
