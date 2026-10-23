# Gateway

Thin public API layer: Express 4 + strict TypeScript. It validates external inputs, assigns request IDs, rate-limits, applies security headers/CORS, proxies unbuffered SSE to the Rust router, and fans stats out to browsers. **Model selection and inference stay in the router.**

## Run

```bash
npm install
npm run dev --workspace=@llm-router/gateway
```

Set `ROUTER_URL` (default `http://localhost:8081`) and `GATEWAY_PORT` in `.env`. `npm test`, `npm run typecheck --workspace=@llm-router/gateway`, `npm run lint --workspace=@llm-router/gateway`, and `npm run build --workspace=@llm-router/gateway` are the quality gates.

## Endpoints

Public endpoints follow `../contracts/openapi.yaml`. Every request gets/propagates `x-request-id`; SSE responses stream each upstream chunk immediately and abort the router call when the browser disconnects. `/metrics` exposes low-cardinality Prometheus HTTP counters and histograms.
