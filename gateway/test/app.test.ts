import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

let routerServer: ReturnType<typeof createServer>;
let routerUrl = '';

beforeAll(async () => {
  routerServer = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ status: 'healthy', services: { ollama: { status: 'healthy' } } }));
      return;
    }
    if (req.url === '/v1/route/chat') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('event: meta\ndata: {"cache":"miss"}\n\n');
      setTimeout(() => {
        res.end('event: token\ndata: {"text":"ok"}\n\n');
      }, 5);
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ models: [], recent: [], requests_total: 0 }));
  });
  await new Promise<void>((resolve) => routerServer.listen(0, '127.0.0.1', resolve));
  const address = routerServer.address() as AddressInfo;
  routerUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => routerServer.close((error) => error ? reject(error) : resolve()));
});

describe('gateway surface', () => {
  const app = () => createApp({ routerUrl, corsOrigins: ['http://localhost:5173'], rateLimitPerMinute: 120 });

  it('assigns and returns a request id', async () => {
    const response = await request(app()).get('/api/health').expect(200);
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/i);
    expect(response.body.status).toBe('healthy');
  });

  it('rejects an invalid chat with the common error envelope', async () => {
    const response = await request(app()).post('/api/chat').send({ messages: [] }).expect(400);
    expect(response.body.error.code).toBe('INVALID_REQUEST');
    expect(response.body.error.request_id).toBeTruthy();
  });

  it('passes the chat stream through without buffering', async () => {
    const response = await request(app())
      .post('/api/chat')
      .set('accept', 'text/event-stream')
      .send({ messages: [{ role: 'user', content: 'hello' }] })
      .expect(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['x-accel-buffering']).toBe('no');
    expect(response.text).toContain('event: meta');
    expect(response.text).toContain('event: token');
  });

  it('returns an empty benchmark list when no result files exist yet', async () => {
    const response = await request(app()).get('/api/benchmark/results').expect(200);
    expect(response.body.results).toEqual([]);
  });

  it('returns a retry-after hint when rate limited', async () => {
    const limitedApp = createApp({ routerUrl, corsOrigins: [], rateLimitPerMinute: 1, rateLimitWindowMs: 1000 });
    await request(limitedApp).get('/api/models').expect(200);
    const response = await request(limitedApp).get('/api/models').expect(429);
    expect(response.headers['retry-after']).toBe('1');
    expect(response.body.error.code).toBe('RATE_LIMITED');
  });

  it('exposes router metrics endpoint', async () => {
    const response = await request(app()).get('/metrics').expect(200);
    expect(response.headers['content-type']).toContain('text/plain');
  });
});
