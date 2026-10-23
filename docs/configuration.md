# Configuration reference

Defaults are in `config/*.yaml`; environment variables override them. `.env.example` is a template only—copy it to `.env` for local work and never commit the real file. Compose uses `COMPOSE_OLLAMA_URL` and `COMPOSE_CORS_ORIGINS` separately from local-process `OLLAMA_URL` and `CORS_ORIGINS` because container DNS and host addresses differ.

## YAML files

| File | Keys |
|---|---|
| `config/models.yaml` | Ollama tags, `light`/`code`/`heavy` tier, per-model timeout, queue/concurrency, fallback and optional configured size |
| `config/routing.yaml` | feature weights, complexity thresholds, keyword/pattern lists, queue diversion, fallback, cache behavior, rolling stats window |
| `config/server.yaml` | Rust listener, Ollama/Redis URLs, request timeout, cache enabled/TTL/temperature |
| `config/gateway.yaml` | Express listener, router URL, CORS, rate-limit count/window, body size, timeout, benchmark result path |
| `config/frontend.yaml` | Vite development/preview host and port and gateway proxy target |
| `config/bench.yaml` | runner URL, dataset/results paths, request timeout, rate-limit retry, KPI targets, backend/hardware defaults |

Model names and policy thresholds are configuration, not routing logic. Update `config/models.yaml` to match `ollama list`; do not expect an environment variable to add model records.

## Environment variables

Empty values below are optional. Defaults follow `.env.example` and YAML configuration unless explicitly noted.

| Variable | Default | Used by | Notes |
|---|---|---|---|
| `NODE_ENV` | `development` | Gateway | `development`, `test`, or `production` |
| `GATEWAY_HOST` / `GATEWAY_PORT` | `0.0.0.0` / `3000` | Gateway | Listener bind and port |
| `GATEWAY_CONFIG` | bundled `config/gateway.yaml` | Gateway | Optional alternate YAML path |
| `ROUTER_URL` | `http://localhost:8081` | Gateway | Internal Rust router URL; Compose overrides to `http://router:8081` |
| `CORS_ORIGINS` | local Vite + local UI origins | Gateway | Comma-separated exact origin allow-list |
| `RATE_LIMIT_PER_MIN` | `60` | Gateway | Requests allowed per IP in a time window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Gateway | Rate-limit window; 429 includes `Retry-After` |
| `MAX_REQUEST_BYTES` | `65536` | Gateway | Express JSON body ceiling; message-content limit is 32 KiB |
| `REQUEST_TIMEOUT_MS` | `180000` | Gateway | Upstream request timeout |
| `LOG_LEVEL` | `info` | Gateway | Pino verbosity; prompt/response bodies are not logged |
| `BENCHMARK_ENABLED` | `true` | Gateway | Set `false` to disable `POST /api/benchmark/run` |
| `BENCH_RESULTS_DIR` | `bench/results` | Gateway + harness | Repository-root-relative result directory |
| `PROJECT_ROOT` | `..` | Gateway | Relative to gateway process working directory |
| `ROUTER_HOST` / `ROUTER_PORT` | `0.0.0.0` / `8081` | Rust router, mocks | Listener bind and port |
| `SERVER_CONFIG` | `config/server.yaml` | Rust router | Server/runtime YAML path |
| `MODELS_CONFIG` | `config/models.yaml` | Rust router and mocks | Model registry YAML path |
| `ROUTING_CONFIG` | `config/routing.yaml` | Rust router and mock router | Policy/classifier YAML path |
| `OLLAMA_URL` | `http://localhost:11434` | Rust router | Local-process Ollama URL; Compose uses `COMPOSE_OLLAMA_URL` |
| `OLLAMA_REQUEST_TIMEOUT_MS` | `120000` | Rust router | Backend request timeout |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Rust router | Compose overrides with `redis://redis:6379` |
| `CACHE_ENABLED` | `true` | Rust router | Enable Redis response caching |
| `CACHE_TTL_SECONDS` | `3600` | Rust router | Completed-response TTL |
| `CACHE_MAX_TEMPERATURE` | `0.2` | Rust router | Maximum sampling temperature for cache eligibility |
| `VITE_API_BASE` | `/api` | Frontend | Same-origin API base |
| `VITE_GATEWAY_URL` | `http://127.0.0.1:3000` | Vite dev server | Proxy destination for `/api` |
| `VITE_DEV_HOST` / `VITE_DEV_PORT` | `0.0.0.0` / `5173` | Vite | Dev-server listener overrides |
| `VITE_PREVIEW_HOST` / `VITE_PREVIEW_PORT` | `0.0.0.0` / `4173` | Vite | Preview-server listener overrides |
| `BENCH_GATEWAY_URL` | `http://localhost:3000` | Harness | Gateway base URL |
| `BENCH_PROMPTS` | `bench/prompts.json` | Harness | Dataset path, repository-root-relative |
| `BENCH_TIMEOUT_MS` | `180000` | Harness | Per-request timeout |
| `BENCH_LIMIT` | `0` | Harness | `0`/empty runs all rows; positive values select balanced unique cases |
| `BENCH_RESUME` | `false` | Harness | Resume checkpoint; `--resume` also works |
| `BENCH_BACKEND` | inferred | Harness | Optional description recorded in result JSON |
| `BENCH_HARDWARE` / `BENCH_GPU` | auto / blank | Harness | Override host/GPU description; do not invent specifications |
| `COMPOSE_OLLAMA_URL` | `http://host.docker.internal:11434` | Compose | Host Ollama URL visible inside containers |
| `COMPOSE_CORS_ORIGINS` | `http://localhost:8080` | Compose | Allowed browser origin for containerized UI |
| `FRONTEND_PORT` | `8080` | Compose | Host port for UI |
| `PROMETHEUS_PORT` / `GRAFANA_PORT` | `9090` / `3001` | Observability Compose | Host ports |
| `GRAFANA_ADMIN_USER` | `admin` | Grafana Compose | Local admin user |
| `GRAFANA_ADMIN_PASSWORD` | **required** for observability overlay | Grafana Compose | Set a local secret; never use the example value in shared deployments |
| `RUST_LOG` | `info` | Rust router | Tracing filter |
| `MOCK_OLLAMA_HOST` / `MOCK_OLLAMA_PORT` | `0.0.0.0` / `11434` | Mock Ollama | Mock listener |
| `MOCK_OLLAMA_MODELS` | model registry | Mock Ollama | Optional comma-separated model override |
| `MOCK_OLLAMA_DELAY_MS` | `0` | Mock Ollama | Base startup delay |
| `MOCK_OLLAMA_DELAY_MAP` | `{}` | Mock Ollama | JSON map from model tag to delay in milliseconds |
| `MOCK_OLLAMA_TOKEN_DELAY_MS` | `15` | Mock Ollama | Inter-token delay in milliseconds |
| `MOCK_OLLAMA_LOAD_DELAY_MS` | `250` | Mock Ollama | Simulated load duration in milliseconds |
| `MOCK_OLLAMA_FAIL_MODELS` / `MOCK_OLLAMA_FAIL_MODE` | empty / `500` | Mock Ollama | Inject failure for tags; mode can be `404` or `500` |
| `MOCK_OLLAMA_LOADED_MODEL` | empty | Mock Ollama | Initial simulated loaded tag |
| `MOCK_ROUTER_TOKEN_DELAY_MS` / `MOCK_ROUTER_FIRST_TOKEN_MS` | `18` / `350` | Mock router | Deterministic Node mock response delays |
| `MOCK_ROUTER_FAIL_MODELS` | empty | Mock router | Comma-separated model tags for fallback simulation |
| `MOCK_ROUTER_LOADED_MODEL` | empty | Mock router | Initial mock warm-model state |

`OLLAMA_HOST` is an Ollama process setting, not an LLM Router variable. Binding it beyond loopback permits host-network access; use a firewall and a trusted local network.
