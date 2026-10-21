# Operations and deployment

## Local development

Use Node.js 24.22.0 and npm 11 (`.nvmrc` pins the runtime) with `npm ci`. `npm run dev:mock` starts the deterministic Node mock router, Express gateway, and Vite frontend. It does not start the Rust router, Ollama, or Redis. `npm run dev` starts Rust router source, gateway, and frontend and expects a reachable Ollama API and Redis service.

The gateway health endpoint `/api/health` reports dependency state. Rust `/healthz` reports router/Ollama/Redis health; cache unavailability is degraded and should not prevent inference from continuing. Frontend and gateway API calls are same-origin under `/api`; Vite and NGINX proxy `/api` to the gateway. Both proxies disable buffering for SSE.

## Docker Compose

`docker-compose.yml` keeps router, Redis, and gateway internal; only the frontend publishes a host port. Redis uses AOF persistence, a bounded `256mb` memory cap and `allkeys-lru`. The router and gateway use non-root identities, read-only root filesystems, dropped capabilities, and bounded scratch volumes where supported. Benchmark JSON and Redis data use named volumes.

For Linux/Windows/macOS Docker host access, Compose adds the `host.docker.internal` alias. Ollama must bind to an interface Docker can reach. Restrict host firewall rules; the Ollama API has no authentication by default. The mock profile avoids downloaded model weights. The separate `mock-router` overlay exercises gateway/UI without compiling the Rust router.

## Prometheus and Grafana

The observability overlay scrapes Rust `/metrics` and gateway `/metrics`, and provisions a Prometheus datasource and a dashboard. Set `GRAFANA_ADMIN_PASSWORD` before startup. The optional `gpu` profile requires NVIDIA Container Toolkit and a compatible host driver. Without a supported GPU exporter, GPU/VRAM values remain unavailable; the app does not fabricate them.

Useful checks:

```bash
curl -fsS http://localhost:8080/api/health
curl -fsS http://localhost:8080/api/models
curl -fsS http://localhost:8080/api/stats
# Internal-only metric endpoint (run inside the Compose gateway container):
docker compose exec gateway node -e "fetch('http://127.0.0.1:3000/metrics').then(async r=>{if(!r.ok)process.exit(1);process.stdout.write((await r.text()).slice(0,300))})"
```

The JSON stats shape is defined in `contracts/openapi.yaml`; operational estimates are labeled `calibrated-estimate` and must not be represented as measured benchmark results.

## Kubernetes

See [`deploy/k8s/README.md`](../deploy/k8s/README.md). The Kustomize base includes a Namespace, YAML ConfigMaps, service/deployment resources, Redis StatefulSet/PVC, result PVC, probes, resource bounds, security contexts, Ingress, and gateway HPA. The `dev` overlay points the Rust router at an in-cluster mock Ollama endpoint. For real inference, patch the Ollama ExternalName to a host DNS name reachable from the pods or replace it with a Service plus Endpoints.

The router's model/queue warm state is process-local. Scaling router replicas does not add GPU capacity and would make warm-state/queue behavior per-replica. The HPA is illustrative and needs Metrics Server. Select a storage provisioner compatible with the PVC access mode before scaling gateway replicas.

## Data and backups

- Redis AOF and cache data are disposable; inference continues on cache failure.
- Benchmark result JSON is user data and is stored in a named volume for Compose or a PVC in Kubernetes.
- Model weights live in Ollama's own host storage and are not included in the repository or images.
- Back up or export benchmark results before deleting volumes. Never put prompts containing private information in committed benchmark fixtures.

## Shutdown and troubleshooting

- **Router unhealthy:** check Rust logs, YAML parse/startup validation, `OLLAMA_URL`, model availability, and `GET /api/tags` from the router's network namespace.
- **Ollama unavailable in Docker:** confirm `OLLAMA_HOST` is reachable from Docker, `COMPOSE_OLLAMA_URL` points to the host, and firewall rules permit the local bridge.
- **SSE appears stalled:** inspect the NGINX/Vite proxy; `proxy_buffering off`, `X-Accel-Buffering: no`, and `Cache-Control: no-cache` are required.
- **429 responses during a benchmark:** the harness honors `Retry-After`; retries add to total wall time but not per-request latency.
- **GPU values absent:** expected without a compatible exporter; no GPU measurements are emitted by the default router.
- **Kubernetes pods pending:** check PVC provisioning, image import/tag, ingress controller, and Metrics Server availability.
