# Mock router

A deterministic Node development double for the Rust routing API. It loads model and routing policy from the shared YAML files, simulates SSE responses, caching, stats and failures, and is used by `npm run dev:mock` and the `deploy/docker-compose.mock-router.yml` Compose overlay.

## Run and test

```bash
npm run dev --workspace=@llm-router/mock-router
```

The default listener is configured via `ROUTER_HOST`/`ROUTER_PORT`; YAML paths can be set through `MODELS_CONFIG` and `ROUTING_CONFIG`. This mock is not a substitute for Rust tests, Ollama inference, or benchmark performance claims.
