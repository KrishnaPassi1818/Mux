import type { Request } from 'express';
import { config } from '../config.js';

export class RouterUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RouterUnavailableError';
  }
}

/** Return the internal router URL, allowing isolated integration tests to inject a test server. */
export const routerBaseUrl = (request: Request): string => {
  const injected = request.app.locals.routerUrl as unknown;
  return typeof injected === 'string' ? injected : config.ROUTER_URL;
};

/** Makes a bounded JSON request to the internal Rust router. */
export const routerJson = async <T>(
  path: string,
  requestId: string,
  init: RequestInit = {},
  baseUrl = config.ROUTER_URL,
): Promise<T> => {
  const signal = init.signal ?? AbortSignal.timeout(config.REQUEST_TIMEOUT_MS);
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  headers.set('content-type', 'application/json');
  headers.set('x-request-id', requestId);
  let response: Response;
  try {
    response = await fetch(new URL(path, baseUrl), { ...init, headers, signal });
  } catch (error) {
    throw new RouterUnavailableError('Router is unavailable.', { cause: error });
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new RouterUnavailableError(`Router returned HTTP ${response.status}${body ? `: ${body.slice(0, 500)}` : ''}`);
  }
  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new RouterUnavailableError('Router returned invalid JSON.', { cause: error });
  }
};
