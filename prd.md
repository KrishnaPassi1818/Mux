# PRD — LLM Router (Intelligent Local LLM Load Balancer)

| Field | Value |
|-------|-------|
| Version | 1.0 (draft for build) |
| Owner | Krishna |
| Related docs | `Architecture.md`, `Design.md`, `Rules.md`, `Tasks.md`, `Memory.md`, `plan.md` |
| Target release | v1.0.0 (end of Phase 10) |

---

## 1. Overview

**LLM Router** is a self-hosted gateway that sits in front of several local Ollama models and automatically sends each user query to the *most appropriate* model: a lightweight model for simple prompts, a code-specialized model for programming prompts, and a heavier model for complex reasoning. It caches completed answers in Redis, and shows **real-time and benchmarked proof** of the efficiency gained compared with always using the biggest model.

## 2. Problem Statement

Running local LLMs on consumer hardware (here: RTX 4050 with 6 GB VRAM) forces a trade-off:

- Always using the biggest model wastes time and GPU on trivial prompts ("hi", "capital of France").
- Always using the smallest model gives poor answers to code and reasoning tasks.
- Only one model fits in VRAM at a time, so careless switching causes multi-second reload delays.
- Identical questions are recomputed from scratch every time.
- Users have no visibility into *why* a model was chosen or what it costs in time.

## 3. Vision & Value Proposition

> "Right model, right task, never recompute an answer you already have — and prove it with numbers."

| Value | How it is delivered |
|-------|---------------------|
| Faster average responses | Light model for simple prompts; cache for repeats |
| Better answers where it matters | Code model for code; heavy model for reasoning |
| Hardware-aware | Warm-model stickiness and queues respect 6 GB VRAM |
| Transparent | Every response shows model, score and reason |
| Verifiable | Benchmark harness and live dashboard quantify the gain |

## 4. Target Users & Personas

| Persona | Needs | Success looks like |
|---------|-------|--------------------|
| **Local-LLM Developer** (primary) | One endpoint instead of juggling models; fast answers; control | Sends prompts via UI/API and gets fast, appropriate answers |
| **Project Evaluator** (college) | Clear architecture, working demo, measurable results, clean repo | Sees live routing, dashboard, benchmark A/B, Docker + K8s |
| **Recruiter / Viewer** (portfolio) | Quick grasp of skills (Rust, Node, React, Redis, Docker, K8s, observability) | README, diagram, demo video, GitHub repo quality |

## 5. Goals, Non-Goals, Success Metrics

### 5.1 Goals
- G1 Route each query to an appropriate local model.
- G2 Reduce latency/resource use vs. a heavy-only baseline.
- G3 Serve repeated queries from cache near-instantly.
- G4 Provide real-time observability of routing efficiency.
- G5 Package for reproducible deployment (Docker Compose, Kubernetes).

### 5.2 Non-Goals (v1)
- Cloud LLM providers (OpenAI, Anthropic, etc.)
- Multi-tenant auth, billing, user accounts
- Model fine-tuning or training
- Guaranteeing identical answer quality across models
- Horizontal scaling of inference (single GPU)

### 5.3 Success Metrics (KPIs)

| ID | Metric | Target | Measured by |
|----|--------|--------|-------------|
| KPI-1 | Routing accuracy vs labeled prompts | ≥ 85% | `bench/` accuracy script |
| KPI-2 | Mean latency, router vs heavy-only | ≥ 30% lower | Benchmark run A vs B |
| KPI-3 | Cache-hit time-to-first-token | < 50 ms | Integration test + metrics |
| KPI-4 | Router overhead (classification + policy), p95 | < 20 ms (classification alone < 1 ms) | `criterion` + histogram |
| KPI-5 | Model swaps under mixed workload, v2 vs v1 policy | Fewer swaps | Benchmark swap counter |
| KPI-6 | Fresh-clone to running stack | ≤ 3 commands | README quick start |

> Targets are hypotheses to be validated in Phase 7; if missed, document the measured result honestly and tune routing.

## 6. Scope

### 6.1 In scope (MVP = v1.0.0)
Chat UI, Node gateway, Rust routing engine, three-tier model registry, Redis response cache, rule-based classifier with scoring, warm-model/queue/fallback policy, Prometheus metrics, Grafana dashboard, React live dashboard, benchmark harness and UI, Docker Compose, Kubernetes manifests, CI, docs and demo.

### 6.2 Out of scope (stretch, post v1.0.0)
Semantic cache, learned/embedding classifier, LLM-as-judge quality scoring, API-key auth, request batching by model.

## 7. User Stories

| ID | As a… | I want… | So that… | Priority |
|----|-------|---------|----------|----------|
| US-01 | user | to type a prompt and see a streamed answer | I get feedback immediately | Must |
| US-02 | user | to see which model answered and why | I trust and understand the routing | Must |
| US-03 | user | repeated prompts to return instantly | I don't wait for recomputation | Must |
| US-04 | user | to override the model manually | I stay in control | Should |
| US-05 | developer | a dry-run endpoint showing the routing decision | I can debug/tune routing | Should |
| US-06 | developer | a live dashboard of latency, models, cache, VRAM | I can see system health | Must |
| US-07 | evaluator | a benchmark comparing heavy-only vs router vs router+cache | I can verify efficiency claims | Must |
| US-08 | developer | everything configurable via YAML/env | I can swap models without code changes | Must |
| US-09 | developer | `docker compose up` to run everything | setup is trivial | Must |
| US-10 | evaluator | Kubernetes manifests | orchestration skills are demonstrated | Should |
| US-11 | developer | graceful fallback if a model fails or times out | requests don't just error | Should |
| US-12 | developer | a mock Ollama server | I can develop/test without a GPU | Must |

## 8. Functional Requirements

Priority uses MoSCoW (M/S/C).

### 8.1 Chat & Streaming
| ID | Requirement | Pri |
|----|-------------|-----|
| FR-01 | Accept chat requests (`messages`, `mode`, optional `model`, `options`, `use_cache`) via `POST /api/chat` | M |
| FR-02 | Stream the response as SSE events `meta`, `token`, `done`, `error` | M |
| FR-03 | Include `request_id`, model, tier, score, intent, reason, cache status in `meta` | M |
| FR-04 | Include usage (`prompt_tokens`, `completion_tokens`, `ttft_ms`, `total_ms`, `tokens_per_sec`, `load_ms`) in `done` | M |
| FR-05 | Support multi-turn conversation context via `messages[]` | M |
| FR-06 | Validate input and enforce size limits | M |

### 8.2 Routing
| ID | Requirement | Pri |
|----|-------------|-----|
| FR-10 | Classify each prompt into intent (`chat`/`code`/`reasoning`) and complexity score (0–100) without calling an LLM (v1) | M |
| FR-11 | Map to tiers `light` / `code` / `heavy` using configurable thresholds | M |
| FR-12 | Load model registry, keywords, weights and thresholds from YAML; no hard-coded model names | M |
| FR-13 | `mode=force` bypasses classification and uses the requested model | S |
| FR-14 | Dry-run endpoint returns decision without inference | S |
| FR-15 | Prefer the currently loaded model when score is near a boundary (warm-model stickiness) | S |
| FR-16 | Per-model concurrency limits with queueing and queue-depth reporting | S |
| FR-17 | Timeout and single-retry fallback to configured next tier | S |

### 8.3 Cache
| ID | Requirement | Pri |
|----|-------------|-----|
| FR-20 | Check Redis cache before classification; on hit replay stored answer as a stream | M |
| FR-21 | Store only complete, non-error responses with temperature ≤ configurable threshold | M |
| FR-22 | TTL and LRU eviction configured | M |
| FR-23 | `use_cache=false` bypass; flush endpoint | S |
| FR-24 | Coalesce identical in-flight requests (single-flight) | C |
| FR-25 | Semantic cache using embeddings | C |

### 8.4 Observability
| ID | Requirement | Pri |
|----|-------------|-----|
| FR-30 | Router exposes Prometheus `/metrics` (latency, TTFT, tokens/s, counts, cache, swaps, queue depth, fallbacks) | M |
| FR-31 | Router exposes JSON `/v1/stats` (rolling window, recent decisions) | M |
| FR-32 | Gateway streams stats to UI via SSE every ~1 s | M |
| FR-33 | GPU VRAM/utilization collected and shown | S |
| FR-34 | UI dashboard shows model distribution, latency, cache hit rate, loaded model, queue depth, live decision feed | M |
| FR-35 | "Efficiency vs heavy-only" panel, clearly labeled as an estimate | S |
| FR-36 | Pre-provisioned Grafana dashboard | S |

### 8.5 Benchmarking
| ID | Requirement | Pri |
|----|-------------|-----|
| FR-40 | Labeled prompt set (simple/code/complex + duplicates) | M |
| FR-41 | Runner executes: A heavy-only/no-cache, B router/no-cache, C router/cache | M |
| FR-42 | Results saved as JSON and shown in a Benchmark page with comparison charts and p50/p95 table | M |
| FR-43 | Routing-accuracy figure vs labels | M |

### 8.6 Packaging & Dev Experience
| ID | Requirement | Pri |
|----|-------------|-----|
| FR-50 | Dockerfiles for frontend, gateway, router; Compose for full stack | M |
| FR-51 | Compose overlay for Prometheus/Grafana/GPU exporter | S |
| FR-52 | Kubernetes manifests (Kustomize) incl. probes, resources, HPA | S |
| FR-53 | Mock Ollama server for GPU-less dev/CI | M |
| FR-54 | CI: format, lint, test, build | S |

## 9. Non-Functional Requirements

| ID | Category | Requirement |
|----|----------|-------------|
| NFR-01 | Performance | Classification < 1 ms; router overhead p95 < 20 ms excluding inference |
| NFR-02 | Streaming | First token passes through gateway/router without buffering; extra hop adds < 15 ms |
| NFR-03 | Reliability | No request hangs: every upstream call has a timeout; errors return structured `error` events |
| NFR-04 | Resource | Whole non-LLM stack (router, gateway, redis, UI) uses < 1.5 GB RAM idle so models retain headroom |
| NFR-05 | Configurability | Models, thresholds, TTLs, ports via config/env only |
| NFR-06 | Observability | Every request has a `request_id` traced through all layers' logs |
| NFR-07 | Security | Input size limits, rate limiting, CORS allow-list, no secrets in repo, prompts not logged above `debug` |
| NFR-08 | Portability | Runs on Windows (Docker Desktop/WSL2) and Linux; Ollama on host |
| NFR-09 | Testability | Core logic unit-tested; end-to-end tests run against mock Ollama |
| NFR-10 | Maintainability | Contracts-first; lint/format enforced; each module single-responsibility |
| NFR-11 | Privacy | All inference and data stay local |

## 10. Constraints & Assumptions

**Constraints**
- Hardware: RTX 4050 6 GB VRAM, 24 GB DDR5, Ryzen 7 7435HS → one 4–8B Q4 model resident at a time.
- Mandated stack: React, Node.js, Rust (router), Redis, Docker; Kubernetes optional.
- Single developer plus coding agents; must be demonstrable to evaluators.

**Assumptions** (flag and revisit if wrong)
- Default models: `gemma3:4b` (light), `qwen2.5-coder:7b` (code), `llama3.1:8b` (heavy) — swappable via config.
- Ollama runs on the host to access the GPU.
- Windows host with Docker Desktop (WSL2) is the primary dev environment.

## 11. Dependencies

Ollama (inference), Redis 7, Prometheus + Grafana, `nvidia_gpu_exporter`, Docker, k3d/minikube + kubectl. See `Architecture.md §9` for library list.

## 12. Release Plan

| Milestone | Phases | Outcome |
|-----------|--------|---------|
| M1 Walking skeleton | 0–1 | Prompt streams through all layers |
| M2 Smart core | 2–3 | Cache + rule-based routing with visible reasons |
| M3 Measurable | 4–7 | Metrics, smart policy, live dashboard, benchmark A/B |
| M4 Deployable | 8–9 | Docker Compose + Kubernetes |
| M5 Showcase | 10 | Tests, CI, docs, demo, `v1.0.0` |

Detailed breakdown: `Tasks.md`.

## 13. Acceptance Criteria (v1.0.0)

1. A prompt flows UI → Node → Rust → Ollama and streams back token by token.
2. Three models are selected by transparent, configurable logic; reason is displayed.
3. Repeating a cached prompt shows a cache badge and responds near-instantly.
4. Dashboard updates live during use; Grafana shows system metrics including VRAM.
5. `npm run bench` produces A/B/C results displayed in the UI; KPI results recorded honestly.
6. `docker compose up` starts the stack; `kubectl apply -k deploy/k8s/overlays/dev` deploys it.
7. CI green; README, architecture diagram and demo video complete.

## 14. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| VRAM swap latency erodes routing gains | High | High | Warm-model stickiness, one-model-loaded setting, swap metric, benchmark honestly |
| Rule-based classifier misroutes | Medium | Medium | Override, fallback, tune via benchmark, optional learned classifier |
| Streaming breaks across two hops/proxy | Medium | High | Test in Phase 1; disable buffering |
| Docker ↔ host Ollama networking issues | Medium | Medium | Documented `host.docker.internal` setup |
| K8s adds little value on one GPU | High | Low | Position as orchestration demo; state limitation openly |
| Scope creep | Medium | Medium | MoSCoW, stretch list gated behind v1.0.0 |

## 15. Open Questions

| # | Question | Default until answered |
|---|----------|------------------------|
| OQ-1 | Exact gemma3 size (1b/4b/12b)? | `gemma3:4b` |
| OQ-2 | Which "medium" model (llama3.1:8b vs qwen2.5:7b)? | `llama3.1:8b` |
| OQ-3 | Is Windows the primary host OS? | Assume Windows + Docker Desktop |
| OQ-4 | Must Kubernetes be part of the graded deliverable? | Build it (Phase 9), keep optional |
