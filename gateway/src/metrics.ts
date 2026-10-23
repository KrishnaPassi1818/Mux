import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/** Dedicated registry, avoiding accidental process-global metric duplication in tests. */
export const registry = new Registry();
registry.setDefaultLabels({ service: 'gateway' });
collectDefaultMetrics({ register: registry, prefix: 'llmr_gateway_' });

export const httpRequests = new Counter({
  name: 'llmr_gateway_http_requests_total',
  help: 'Total HTTP requests served by the gateway.',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [registry],
});

export const httpDuration = new Histogram({
  name: 'llmr_gateway_http_request_duration_seconds',
  help: 'Gateway HTTP request duration in seconds.',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [registry],
});

export const clientAborts = new Counter({
  name: 'llmr_client_aborts_total',
  help: 'Chat streams cancelled because the downstream client disconnected.',
  registers: [registry],
});
