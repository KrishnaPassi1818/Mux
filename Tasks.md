# Tasks — LLM Router

Single source of truth for work. Read `Rules.md §1` before claiming anything.

**Status legend:** `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked (add reason in `Memory.md`)
**Tracks:** **A** Router (Rust) · **B** Gateway (Node) · **C** Frontend (React) · **D** Infra & Observability · **E** Bench & QA · **All**
**Format:** `ID | Task | Track | Depends on | Acceptance`

---

## 0. Board Overview

| Phase | Name | Tracks | Depends on | Milestone | Status |
|-------|------|--------|------------|-----------|--------|
| 0 | Foundation & Contracts | All (1 lead) | — | M1 | [ ] |
| 1 | Walking Skeleton | A B C E | P0 | M1 | [ ] |
| 2 | Redis Cache | A B C E | P1 | M2 | [ ] |
| 3 | Routing Engine v1 | A B C E | P1 (P2 preferred) | M2 | [ ] |
| 4 | Observability | A B D | P2, P3 | M3 | [ ] |
| 5 | Routing Engine v2 (Smart Policy) | A E | P3, P4 | M3 | [ ] |
| 6 | Live Dashboard | C A B | P4 | M3 | [ ] |
| 7 | Benchmark Harness | E B C | P3, P5 (P6 for UI) | M3 | [ ] |
| 8 | Containerization | D E | P1+ (finalize after P7) | M4 | [ ] |
| 9 | Kubernetes | D | P8 | M4 | [ ] |
| 10 | Hardening, Docs & Demo | All | P7, P8 (P9 optional) | M5 | [ ] |
| 11 | Stretch | Any | v1.0.0 | — | [ ] |

### Parallelization map

```
P0 ─► P1 ─┬─► P2 ─┐
          └─► P3 ─┼─► P4 ─┬─► P5 ─┐
                  │       └─► P6 ─┼─► P7 ─► P10
                  └────────────────┘
P8 (D) can start after P1 (compose skeleton), finalize after P7. P9 after P8.
```
**Critical path:** P0 → P1 → P3 → P4 → P5 → P7 → P10.
Within a phase, tasks marked with different tracks and no mutual dependency can run **simultaneously**.

---

## Phase 0 — Foundation & Contracts  *(lead agent; blocks all)*

Goal: any track can start independently against stable contracts and a mock backend.

| ID | Task | Track | Deps | Acceptance |
|----|------|-------|------|------------|
| [ ] P0-01 | Create monorepo skeleton per `Architecture.md §12`; `.gitignore`, `.editorconfig`, `.dockerignore`, LICENSE | D | — | Tree matches doc; `git status` clean |
| [ ] P0-02 | Install/verify Ollama; pull the 3 models; set `OLLAMA_MAX_LOADED_MODELS=1`, `NUM_PARALLEL=1`, `KEEP_ALIVE=10m` | E | — | `ollama list` shows models; each answers a test prompt |
| [ ] P0-03 | Record baseline measurements per model (cold load time, tokens/s, VRAM) into `Memory.md → Environment` | E | P0-02 | Table filled with real numbers + date |
| [ ] P0-04 | Write `contracts/openapi.yaml` (all endpoints, schemas, error envelope) | All | — | Validates with an OpenAPI linter |
| [ ] P0-05 | Write `contracts/sse-events.md` + JSON fixtures in `contracts/schemas/` (meta/token/done/error, stats, benchmark result) | All | P0-04 | Fixtures validate against schemas |
| [ ] P0-06 | Write `config/models.yaml` and `config/routing.yaml` (initial thresholds, weights, keyword lists) | A | P0-04 | Files parse; documented keys |
| [ ] P0-07 | Build `tools/mock-ollama` (Node): `/api/chat` NDJSON stream with realistic final-chunk fields, `/api/tags`, `/api/ps`, per-model delay & failure injection | E | P0-02 | Stream shape matches real Ollama; configurable via env/flags |
| [ ] P0-08 | `docker-compose.yml` skeleton: redis + mock-ollama profile + placeholders for services | D | P0-01 | `docker compose --profile mock up redis mock-ollama` healthy |
| [ ] P0-09 | Scaffold empty projects: `router` (cargo), `gateway` (npm+TS), `frontend` (Vite+React+TS+Tailwind) with lint/format/test scripts | A B C | P0-01 | Each builds and runs its (empty) test suite |
| [ ] P0-10 | Add `gen:types` script (openapi-typescript) to gateway + frontend | B C | P0-04, P0-09 | Generated types compile |
| [ ] P0-11 | Create `.env.example` + README skeleton; seed `Memory.md` with decisions & versions pinned | D | P0-01 | Documented env table |

**Exit:** all tracks can run a hello-world build/test; contracts reviewed; mock Ollama usable.

---

## Phase 1 — Walking Skeleton  *(A, B, C parallel)*

Goal: prompt typed in UI streams a model answer through all layers (fixed model, no intelligence).

| ID | Task | Track | Deps | Acceptance |
|----|------|-------|------|------------|
| [ ] P1-01 | Router: config loader (YAML+env), startup validation, `/healthz` | A | P0-06, P0-09 | Invalid config fails fast with clear message |
| [ ] P1-02 | Router: `OllamaBackend` — typed client, NDJSON stream parser, final-chunk usage extraction | A | P0-07 | Unit tests with wiremock; handles split lines |
| [ ] P1-03 | Router: `POST /v1/route/chat` → fixed default model → SSE `meta/token/done/error` | A | P1-01, P1-02 | Matches contract fixtures; streaming unbuffered |
| [ ] P1-04 | Router: cancel upstream on client disconnect | A | P1-03 | Test proves Ollama call dropped, no leak |
| [ ] P1-05 | Gateway: server, zod validation, request-id middleware, pino, error middleware, `/api/health` | B | P0-09, P0-10 | Contract-shaped errors |
| [ ] P1-06 | Gateway: `POST /api/chat` → pipe SSE from router with abort propagation | B | P1-05 | Stream passes through unbuffered; abort cancels upstream |
| [ ] P1-07 | Frontend: app shell, routing, theme tokens (`Design.md §3`), nav | C | P0-09 | Pages render; light/dark toggle works |
| [ ] P1-08 | Frontend: `api/sse.ts` POST-stream parser + unit tests with recorded transcripts | C | P0-10 | Handles partial frames, ping, abort |
| [ ] P1-09 | Frontend: Chat page — input, message list, markdown render (sanitized), streaming, stop, error states | C | P1-07, P1-08 | Tokens render live; stop works |
| [ ] P1-10 | E2E smoke script: prompt → `meta`, ≥1 `token`, `done` (mock profile) | E | P1-03, P1-06 | Passes in CI-like run |
| [ ] P1-11 | Verify streaming works end-to-end with **real** Ollama and through nginx/dev proxy (no buffering) | E | P1-09 | Documented in `Memory.md` |

**Exit:** real and mock backends both stream token-by-token to the browser.

---

## Phase 2 — Redis Cache  *(A primary)*

| ID | Task | Track | Deps | Acceptance |
|----|------|-------|------|------------|
| [ ] P2-01 | Cache key normalization + sha256 (trim, whitespace collapse, NFC, lowercase for key) | A | P1-03 | Variants hit same key; unit tests |
| [ ] P2-02 | `RedisCache` (get/set/TTL, connection manager) + `InMemoryCache` for tests | A | P2-01 | Integration test with Redis container |
| [ ] P2-03 | Cache-before-inference flow; replay stream for hits (~20-char chunks); `meta.cache = hit/miss` | A | P2-02 | Hit skips Ollama; TTFT < 50 ms |
| [ ] P2-04 | Store only complete responses with temperature ≤ `CACHE_MAX_TEMPERATURE`; never cache errors/partials | A | P2-03 | Tests for abort/error/high-temp |
| [ ] P2-05 | Redis-down bypass (warn + metric), `use_cache=false`, `POST /v1/cache/flush` | A | P2-03 | Service stays up with Redis stopped |
| [ ] P2-06 | Redis config: `maxmemory 256mb`, `allkeys-lru` in compose | D | P0-08 | Verified via `CONFIG GET` |
| [ ] P2-07 | Gateway: pass `use_cache`; `POST /api/cache/flush`; rate limiting | B | P2-05 | Validated + tested |
| [ ] P2-08 | Frontend: `CacheBadge`, "bypass cache" toggle | C | P2-03 | Hit shows cyan badge + time |
| [ ] P2-09 | Integration test: same prompt twice → second is `hit` with TTFT < 100 ms | E | P2-03 | Passes with mock profile |

---

## Phase 3 — Routing Engine v1  *(A primary)*

| ID | Task | Track | Deps | Acceptance |
|----|------|-------|------|------------|
| [ ] P3-01 | Feature extractor (length, reasoning, structure, context, simplicity, code signals) | A | P1-03 | Pure functions; unit tested |
| [ ] P3-02 | Scorer (weights from config) + intent detection → `Classification` | A | P3-01 | Deterministic; documented formula |
| [ ] P3-03 | Tier selector + model registry mapping; `mode=force` | A | P3-02 | Config-driven; no hard-coded names |
| [ ] P3-04 | `meta` includes `score`, `intent`, `reason`; human-readable reason strings | A | P3-03 | Matches contract |
| [ ] P3-05 | `POST /v1/route/preview` (dry run) | A | P3-03 | No Ollama call; returns decision |
| [ ] P3-06 | Classifier test suite (≥ 40 labeled prompts, edge cases) + `criterion` bench | A | P3-02 | < 1 ms on 2,000-char prompt |
| [ ] P3-07 | Gateway: `/api/route/preview`, `/api/models` | B | P3-05 | Contract-conformant |
| [ ] P3-08 | Frontend: `RouteBadge` + popover, `ModelSelector` (auto/force), optional `PreviewHint` (debounced) | C | P3-04, P3-07 | Badge visible before first token |
| [ ] P3-09 | Write `bench/prompts.json` (60 labeled + ~20% duplicates) | E | P0-04 | Balanced simple/code/complex |
| [ ] P3-10 | Accuracy script using preview endpoint | E | P3-05, P3-09 | Prints accuracy + confusion matrix |
| [ ] P3-11 | Tune `routing.yaml` until accuracy ≥ 80% (target 85%) | A E | P3-10 | Result logged in `Memory.md` |

---

## Phase 4 — Observability  *(D primary; A, B support)*

| ID | Task | Track | Deps | Acceptance |
|----|------|-------|------|------------|
| [ ] P4-01 | Router: Prometheus registry + `/metrics` with metrics listed in `plan.md §10.1` | A | P3-04 | `curl /metrics` shows `llmr_*` series |
| [ ] P4-02 | Router: capture Ollama final-chunk stats (`eval_count/eval_duration`, `load_duration`) → tokens/s, TTFT, swap time | A | P4-01 | Values within 5% of manual calc |
| [ ] P4-03 | Router: rolling-window stats + recent-decisions ring buffer; `GET /v1/stats` | A | P4-01 | Matches `stats` schema |
| [ ] P4-04 | Gateway: `/api/stats`, `/api/stats/stream` (SSE 1 s), `prom-client` HTTP metrics, merge GPU stats | B | P4-03 | Stream pushes ≤ 20 KB per tick |
| [ ] P4-05 | `deploy/prometheus/prometheus.yml` scraping router, gateway, GPU exporter | D | P4-01 | Targets UP |
| [ ] P4-06 | `nvidia_gpu_exporter` service in observability compose | D | P4-05 | VRAM series visible |
| [ ] P4-07 | Grafana provisioning + dashboard JSON (latency p50/p95, rate, hit rate, swaps, VRAM) | D | P4-05 | Dashboard loads automatically |
| [ ] P4-08 | `docker-compose.observability.yml` overlay | D | P4-05..07 | One command brings up stack + monitoring |

---

## Phase 5 — Routing Engine v2 (Smart Policy)  *(A primary)*

| ID | Task | Track | Deps | Acceptance |
|----|------|-------|------|------------|
| [ ] P5-01 | `/api/ps` poller + `SystemState` (loaded model, `size_vram`) | A | P4-03 | State updates within 2 s of swap |
| [ ] P5-02 | Warm-model stickiness (±8 boundary margin; never override code intent) | A | P5-01 | Unit tests incl. boundary cases |
| [ ] P5-03 | Per-model `Semaphore` queues, RAII permits, depth gauges, `QUEUE_FULL` | A | P3-03 | Permit released on cancel (test) |
| [ ] P5-04 | Queue-aware diversion to adjacent tier | A | P5-03 | Configurable; metric emitted |
| [ ] P5-05 | Per-tier timeouts + single fallback retry; second `meta`; `llmr_fallbacks_total` | A | P5-03 | Chaos tests pass |
| [ ] P5-06 | Partial-offload detection (`size_vram < size`) → warn metric | A | P5-01 | Metric exposed |
| [ ] P5-07 | Chaos/load tests using mock-ollama failure & delay injection | E | P5-05 | No hung requests; swap count lower than v1 |
| [ ] P5-08 | (Stretch) single-flight for identical in-flight prompts | A | P2-03 | Two concurrent identical requests → one inference |

---

## Phase 6 — Live Dashboard  *(C primary)*

| ID | Task | Track | Deps | Acceptance |
|----|------|-------|------|------------|
| [ ] P6-01 | `api/stats.ts` SSE client + ring buffer util (300 pts) | C | P4-04 | Reconnects with backoff |
| [ ] P6-02 | `StatCard` row (requests, avg latency, hit rate, swaps) | C | P6-01 | Handles empty/loading |
| [ ] P6-03 | `ModelDonut`, `LatencyChart`, `LatencyBars`, `CacheGauge` (Recharts, tier colors) | C | P6-01 | Chart + "view as table" toggle |
| [ ] P6-04 | `VramBar`, `QueueStatus`, loaded-model indicator | C | P4-04 (P5-01 for loaded model) | Warning color > 90% VRAM |
| [ ] P6-05 | `DecisionFeed` (virtualized, animated insert) | C | P6-01 | Smooth with 100+ events |
| [ ] P6-06 | Router: `estimated_savings` (calibrated heavy baseline from config/latest benchmark) | A | P4-03 | Labeled `basis: calibrated-estimate` |
| [ ] P6-07 | `EfficiencyPanel` with "Estimated" chip + explainer popover | C | P6-06 | Never presented as measured |
| [ ] P6-08 | Responsive layout, reduced-motion, a11y pass | C | P6-02..07 | Passes `Design.md §12` |

---

## Phase 7 — Benchmark Harness  *(E primary)*

| ID | Task | Track | Deps | Acceptance |
|----|------|-------|------|------------|
| [ ] P7-01 | `bench/run.ts`: runs A (force heavy, no cache), B (router, no cache), C (router + cache, two passes) | E | P3-09, P5-05 | Deterministic order; resumable |
| [ ] P7-02 | Collect per-request + aggregate metrics (mean/p50/p95, TTFT, tokens/s, swaps, peak VRAM, hit rate, accuracy) | E | P7-01 | Written to `bench/results/<ts>.json` matching schema |
| [ ] P7-03 | Cold-start handling & warm-up policy documented and applied identically across runs | E | P7-01 | Methodology section in README |
| [ ] P7-04 | Gateway: `/api/benchmark/results` (+ optional `/run`) | B | P7-02 | Contract-conformant |
| [ ] P7-05 | Benchmark page: run selector, grouped bars, p50/p95 table, confusion matrix, download JSON, data-driven verdict | C | P7-04 | Handles missing fields gracefully |
| [ ] P7-06 | Execute official benchmark on target hardware; commit result; record KPI outcomes in `Memory.md` | E | P7-01..05 | KPI-1/2/3/4/5 evaluated honestly |
| [ ] P7-07 | If KPI-2 missed: analyze (swaps? misroutes?) and tune; re-run | A E | P7-06 | Final numbers committed |

---

## Phase 8 — Containerization  *(D primary)*

| ID | Task | Track | Deps | Acceptance |
|----|------|-------|------|------------|
| [ ] P8-01 | Router Dockerfile (multi-stage, `cargo-chef`, slim non-root runtime) | D | P1-03 | Image < ~100 MB; healthcheck OK |
| [ ] P8-02 | Gateway Dockerfile (multi-stage, non-root) | D | P1-06 | Starts, healthy |
| [ ] P8-03 | Frontend build + nginx (SPA fallback, `/api` proxy, `proxy_buffering off`) | D | P1-09 | SSE streams live through nginx |
| [ ] P8-04 | Compose: all services, healthchecks, `depends_on: service_healthy`, volumes, `.env` | D | P8-01..03 | `docker compose up` works from fresh clone |
| [ ] P8-05 | Ollama host access (`host.docker.internal`, `extra_hosts` for Linux); doc `OLLAMA_HOST` notes | D | P8-04 | Router reaches host Ollama |
| [ ] P8-06 | `mock` profile for CI/GPU-less demo | D E | P0-07, P8-04 | Full stack works with no GPU |
| [ ] P8-07 | Compose-level smoke test in CI | E | P8-06 | Green on every PR |

---

## Phase 9 — Kubernetes  *(D primary)*

| ID | Task | Track | Deps | Acceptance |
|----|------|-------|------|------------|
| [ ] P9-01 | Local cluster (k3d/minikube) setup script + docs | D | P8-04 | `kubectl get nodes` ready |
| [ ] P9-02 | Kustomize `base/`: namespace, ConfigMaps (models/routing), Deployments, Services, Ingress | D | P9-01 | `kubectl apply --dry-run=client` passes |
| [ ] P9-03 | Redis StatefulSet + PVC (or dev Deployment) | D | P9-02 | Data survives pod restart |
| [ ] P9-04 | Probes (`/healthz`), resource requests/limits, securityContext (non-root, drop caps) | D | P9-02 | Pods Ready; no restarts |
| [ ] P9-05 | Ollama as `ExternalName`/Endpoints to host | D | P9-02 | Router in-cluster reaches host Ollama |
| [ ] P9-06 | `metrics-server` + HPA for gateway (CPU) | D | P9-04 | HPA scales under load test |
| [ ] P9-07 | Optional: `kube-prometheus-stack` + ServiceMonitors | D | P9-02 | Targets UP |
| [ ] P9-08 | k6 load test; document the single-GPU scaling limitation honestly | D E | P9-06 | Report in `docs/` |

---

## Phase 10 — Hardening, Docs & Demo  *(All)*

| ID | Task | Track | Deps | Acceptance |
|----|------|-------|------|------------|
| [ ] P10-01 | Full test pass: `cargo test/clippy/fmt`, `vitest`, lint; fix flakiness | All | P7 | All green, deterministic |
| [ ] P10-02 | Playwright E2E happy path (chat → badge → repeat → cache hit → dashboard updates) | E C | P6, P8 | Runs on mock profile |
| [ ] P10-03 | Input limits, CORS allow-list, graceful shutdown, structured errors audit | A B | P1 | `Rules.md §11` satisfied |
| [ ] P10-04 | CI workflow (GitHub Actions): fmt → lint → test → build images → compose smoke | D | P8-07 | Green on `main` |
| [ ] P10-05 | README: overview, architecture diagram, quick start (≤ 3 commands), config reference, benchmark table, limitations | All | P7-06 | Fresh-clone test by another agent |
| [ ] P10-06 | `docs/demo-script.md` (5-minute flow) + record demo video/GIF | All | P10-05 | Video shows routing, cache, dashboard, benchmark |
| [ ] P10-07 | Repo polish: topics (`rust`, `ollama`, `llm-router`, `redis`, `kubernetes`), clean history, tag `v1.0.0` | D | P10-01..06 | Release created |
| [ ] P10-08 | LinkedIn post + resume bullet drafts | All | P10-07 | Reviewed by owner |

---

## Phase 11 — Stretch (only after v1.0.0)

| ID | Task | Track |
|----|------|-------|
| [ ] P11-01 | Semantic cache (embeddings + Redis vector search, similarity ≥ 0.92) | A |
| [ ] P11-02 | Embedding-based or small-LLM intent classifier replacing rules | A |
| [ ] P11-03 | Learn thresholds from benchmark logs (offline tuning script) | A E |
| [ ] P11-04 | Request grouping by model to reduce swaps | A |
| [ ] P11-05 | API-key auth + per-key usage stats | B |
| [ ] P11-06 | LLM-as-judge quality evaluation in benchmark | E |

---

## Task Hand-off Template (paste in `Memory.md → Handoff Log`)

```
### <date> · <Track> · <Task IDs>
- Done: <what works, how to run it>
- Tests: <added/passing>
- Contract impact: <none | PR #>
- Decisions: <new ADR / config choices>
- Left undone / risks: <list>
- Next agent should: <specific next step>
```
