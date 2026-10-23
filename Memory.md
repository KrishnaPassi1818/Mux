# Memory — LLM Router (Shared Agent Context)

> **Read this first. Update it last.**
> This is the project's shared memory for all agents and contributors. It carries context between sessions so nobody re-derives decisions or repeats mistakes.
> Keep it factual and short. Never store secrets, personal data, or prompt/response content here.

Related: `prd.md` · `Architecture.md` · `Design.md` · `Rules.md` · `Tasks.md` · `plan.md`

---

## 0. How to Use This File

| When | Do |
|------|----|
| Starting a session | Read §1 (snapshot), §2 (status), §3 (decisions), §7 (known issues), then your phase in `Tasks.md` |
| Making a choice others must follow | Add a row to §3 Decision Log (and an ADR in `Architecture.md §13` if architectural) |
| Finishing a task | Add a Handoff entry (§9) using the template; update §2 |
| Hitting a blocker or ambiguity | Add to §8 Open Questions with the owning track tagged |
| Measuring anything | Record real numbers + date in §5 (never estimates presented as measurements) |

Edit rules: append-only for §9 (Handoff Log); in other sections update in place and keep a date. Don't delete a decision, mark it **superseded** with a pointer.

---

## 1. Project Snapshot

| Item | Value |
|------|-------|
| Name | LLM Router — intelligent local LLM load balancer |
| One-liner | Routes each prompt to the best local Ollama model (light / code / heavy), caches answers in Redis, and proves the efficiency gain with live metrics and a benchmark |
| Owner | Krishna (B.Tech CS student) |
| Purpose | College AI-subject submission + portfolio/resume project (GitHub + LinkedIn visibility) |
| Evaluation lens | Must be demonstrable, solve a real problem, and stand out from generic student projects |
| Stack | React (Vite, TS) · Node.js (Express, TS) gateway · Rust (axum) router · Redis 7 · Ollama · Docker/Compose · Kubernetes (k3d/minikube) · Prometheus + Grafana |
| Repo layout | See `Architecture.md §12` |

### Elevator architecture
`React UI → Node gateway → Rust router → (Redis cache | classifier → policy → queue → Ollama)`; metrics to Prometheus/Grafana and a JSON stats stream to the UI dashboard.

---

## 2. Current Status  *(update at end of every task)*

| Field | Value |
|-------|-------|
| Active phase | Phase 0 — Foundation & Contracts (not started) |
| Last completed task | — |
| In progress | — |
| Blocked | — |
| Last updated | _(date)_ by _(track)_ |
| `main` health | _(green/red; last CI run)_ |

### Phase tracker
| Phase | State |
|-------|-------|
| 0 Foundation & Contracts | not started |
| 1 Walking Skeleton | not started |
| 2 Redis Cache | not started |
| 3 Routing Engine v1 | not started |
| 4 Observability | not started |
| 5 Routing Engine v2 | not started |
| 6 Live Dashboard | not started |
| 7 Benchmark Harness | not started |
| 8 Containerization | not started |
| 9 Kubernetes | not started |
| 10 Hardening/Docs/Demo | not started |

---

## 3. Decision Log

| # | Date | Decision | Why | Alternatives rejected | Status |
|---|------|----------|-----|----------------------|--------|
| D-001 | — | Routing engine in Rust (axum) | Low latency, safe concurrency, great streaming; portfolio value | Node-only router | Active |
| D-002 | — | Node gateway stays thin (validation, rate limit, SSE passthrough) | Mandated stack; keeps logic in one place | Logic split across gateway/router | Active |
| D-003 | — | SSE (POST + fetch streams) not WebSocket | One-way token stream; simple, proxy-friendly | WebSocket | Active |
| D-004 | — | Cache lookup before classification; key is model-independent | Skips all work on hit | Per-model cache keys | Active |
| D-005 | — | Ollama runs on host, not in a container | Reliable GPU access on a Windows laptop | Ollama in Docker | Active |
| D-006 | — | Rule-based scoring classifier for v1 | Sub-ms, explainable, no extra VRAM | LLM/embedding classifier (deferred to stretch) | Active |
| D-007 | — | `OLLAMA_MAX_LOADED_MODELS=1`; policy prefers the already-loaded model near boundaries | 6 GB VRAM holds one model; swaps cost seconds | Allow multiple resident models | Active |
| D-008 | — | Contracts-first (OpenAPI + SSE spec) | Enables parallel agent work | Code-first | Active |
| D-009 | — | Mock Ollama server in repo | GPU-less dev/CI, deterministic tests | Tests against real Ollama | Active |
| D-010 | — | Efficiency shown two ways: live **estimate** (labeled) and measured **benchmark** | Honesty and defensibility | Single unlabeled number | Active |

_Add new rows at the bottom. If a decision changes, set the old row to `Superseded by D-0xx`._

---

## 4. Environment Facts

### 4.1 Hardware (target dev machine)
| Item | Value |
|------|-------|
| GPU | NVIDIA RTX 4050 Laptop, 6 GB VRAM |
| RAM | 24 GB DDR5 |
| CPU | AMD Ryzen 7 7435HS (8C/16T) |
| OS | _(confirm: Windows + Docker Desktop/WSL2 assumed)_ |

### 4.2 Models (config-driven; defaults)
| Tier | Model | Notes |
|------|-------|-------|
| light | `gemma3:4b` | _(confirm size)_ |
| code | `qwen2.5-coder:7b` | |
| heavy | `llama3.1:8b` | _(alt: `qwen2.5:7b`; confirm)_ |

### 4.3 Ollama settings
```
OLLAMA_MAX_LOADED_MODELS=1
OLLAMA_NUM_PARALLEL=1
OLLAMA_KEEP_ALIVE=10m
request options: num_ctx=4096
```

### 4.4 Ports
| Service | Port |
|---------|------|
| Frontend dev / nginx | 5173 / 8080 |
| Gateway | 3000 |
| Router | 8081 |
| Redis | 6379 |
| Ollama (host) | 11434 |
| Prometheus | 9090 |
| Grafana | 3001 |
| GPU exporter | 9835 |

### 4.5 Pinned versions  *(fill in at Phase 0, P0-11)*
| Tool | Version |
|------|---------|
| Rust toolchain | _TBD_ |
| Node | _TBD (22/24 LTS)_ |
| axum / tokio / reqwest / redis crate | _TBD_ |
| React / Vite / Tailwind / Recharts | _TBD_ |
| Redis image | _TBD_ |
| Prometheus / Grafana images | _TBD_ |

### 4.6 Host networking note
Containers reach host Ollama via `host.docker.internal:11434` (Docker Desktop). On Linux add `extra_hosts: ["host.docker.internal:host-gateway"]`. If Ollama refuses connections, set `OLLAMA_HOST=0.0.0.0`.

---

## 5. Measured Baselines & Results  *(real numbers only; include date)*

### 5.1 Per-model baseline (Phase 0, P0-03)
| Model | Cold load (s) | Warm TTFT (ms) | Tokens/s | VRAM (GB) | Date |
|-------|---------------|----------------|----------|-----------|------|
| gemma3:4b | _TBD_ | _TBD_ | _TBD_ | _TBD_ | |
| qwen2.5-coder:7b | _TBD_ | _TBD_ | _TBD_ | _TBD_ | |
| llama3.1:8b | _TBD_ | _TBD_ | _TBD_ | _TBD_ | |

### 5.2 KPI results (Phase 7, P7-06)
| KPI | Target | Measured | Pass? | Result file |
|-----|--------|----------|-------|-------------|
| KPI-1 Routing accuracy | ≥ 85% | _TBD_ | | |
| KPI-2 Mean latency vs heavy-only | ≥ 30% lower | _TBD_ | | |
| KPI-3 Cache-hit TTFT | < 50 ms | _TBD_ | | |
| KPI-4 Router overhead p95 | < 20 ms | _TBD_ | | |
| KPI-5 Swaps v2 vs v1 | fewer | _TBD_ | | |
| KPI-6 Fresh clone → running | ≤ 3 commands | _TBD_ | | |

---

## 6. Glossary

| Term | Meaning |
|------|---------|
| Tier | `light`, `code`, or `heavy` model class |
| Score | 0–100 complexity score from the classifier |
| Intent | `chat`, `code`, or `reasoning` |
| Boundary zone | Score band near a tier threshold where warm-model stickiness may override |
| Warm model | The model currently loaded in VRAM (from Ollama `/api/ps`) |
| Swap | Unloading one model and loading another; costs seconds (`load_duration`) |
| TTFT | Time to first token |
| Cache hit replay | Re-streaming a stored answer in chunks to mimic live streaming |
| Baseline (A) | Benchmark run forcing the heavy model with cache off |
| Mock Ollama | `tools/mock-ollama`, fake Ollama API for dev/CI |
| Track | Agent responsibility lane A–E (see `Rules.md §2`) |
| Contract | `contracts/openapi.yaml` + `contracts/sse-events.md` |

---

## 7. Conventions Quick-Reference  *(authoritative detail in `Rules.md`)*

- Branch `phase-<N>/<track>-<topic>`; Conventional Commits.
- Contracts change only via a `contract-change` PR, merged first.
- No hard-coded models/thresholds/URLs; config + `.env.example`.
- Rust: `fmt`, `clippy -D warnings`, no `unwrap` in non-test code. TS: strict, no `any`, zod at boundaries.
- Never log prompt/response text above `debug`; metrics prefixed `llmr_`, low-cardinality labels.
- Streams unbuffered; cache only complete, low-temperature responses.
- Benchmark claims must come from the committed harness + result file.

### Known issues / gotchas  *(add as discovered)*
| # | Issue | Workaround | Owner | Status |
|---|-------|------------|-------|--------|
| KI-1 | Reverse proxies (nginx) buffer SSE by default | `proxy_buffering off`, `X-Accel-Buffering: no` | D | Preempt in P8-03 |
| KI-2 | `EventSource` can't POST | Use `fetch` + `ReadableStream` parser | C | Handled in P1-08 |
| KI-3 | 6 GB VRAM: model swap latency | Warm-model stickiness; document in results | A | Addressed in P5 |
| KI-4 | Ollama may partially offload to CPU if model + context too large | Cap `num_ctx`; watch `size_vram` vs `size` | A | Addressed in P5-06 |

---

## 8. Open Questions

| # | Question | Default assumed | Owner | Raised | Resolved? |
|---|----------|-----------------|-------|--------|-----------|
| OQ-1 | Exact gemma3 size (1b/4b/12b)? | `gemma3:4b` | Krishna | plan.md | no |
| OQ-2 | Which "medium" model: `llama3.1:8b` or `qwen2.5:7b`? | `llama3.1:8b` | Krishna | plan.md | no |
| OQ-3 | Primary host OS (Windows + Docker Desktop assumed)? | Windows | Krishna | prd.md | no |
| OQ-4 | Is Kubernetes required in the graded deliverable? | Build it in P9, keep optional | Krishna | prd.md | no |
| OQ-5 | Is a live demo on the evaluator's machine needed (GPU-less → mock profile)? | Support both | Krishna | prd.md | no |

---

## 9. Handoff Log  *(append-only, newest at bottom)*

### Template
```
### <date> · <Track> · <Task IDs>
- Done: <what works, how to run it>
- Tests: <added/passing>
- Contract impact: <none | PR #>
- Decisions: <new D-0xx / ADR>
- Left undone / risks: <list>
- Next agent should: <specific next step>
```

### Entries
_(none yet)_

---

## 10. Quick Commands  *(fill in as they come to exist)*

```bash
# Dev (no Docker for app code)
ollama serve
docker compose --profile mock up redis mock-ollama     # GPU-less
cd router   && cargo run
cd gateway  && npm run dev
cd frontend && npm run dev

# Quality gates
cd router   && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
cd gateway  && npm run lint && npm test
cd frontend && npm run lint && npm test

# Contracts → types
npm run gen:types      # in gateway/ and frontend/

# Benchmark
npm run bench          # writes bench/results/<timestamp>.json

# Full stack
docker compose up
docker compose -f docker-compose.yml -f docker-compose.observability.yml up
kubectl apply -k deploy/k8s/overlays/dev
```

---

## 11. Session Start Checklist (copy for each agent session)

- [ ] Read §2 status and §7 known issues
- [ ] Read the Decision Log for anything touching my area
- [ ] Open my phase in `Tasks.md`; claim one task (`[~]`)
- [ ] Read the relevant contract and `Architecture.md` section
- [ ] Do the work in my owned directories only
- [ ] Run the pre-merge checklist (`Rules.md §14`)
- [ ] Update `Tasks.md`, §2 status, and append a Handoff entry
