# Rules — LLM Router

Binding rules for every contributor, human or AI agent. If a rule blocks you, don't bypass it: record the conflict in `Memory.md → Open Questions` and propose a change.

**Priority order when rules conflict:** `contracts/` → this file → `Architecture.md` → `Design.md` → `Tasks.md` → conventions in code.

---

## 1. Agent Protocol (start → finish)

| Step | Action |
|------|--------|
| 1 | Read `Memory.md` (status, decisions, known issues) then `Tasks.md` (your phase) |
| 2 | Claim a task: set `[ ]` → `[~]` and add your track/branch in the Tasks table |
| 3 | Re-read the relevant contract in `contracts/` and the section of `Architecture.md` |
| 4 | Work only inside your owned directories (Rule 2) |
| 5 | Write tests with the code (Rule 7) |
| 6 | Run the pre-merge checklist (Rule 14) |
| 7 | Mark task `[x]`, append a handoff entry to `Memory.md`, list anything left undone |

**Never** mark a task done if acceptance criteria are unmet or tests are failing. Mark it `[!]` blocked with a reason instead.

---

## 2. Ownership & Boundaries

| Track | Owns | May read | May NOT edit |
|-------|------|----------|--------------|
| **A Router** | `router/`, `config/` | everything | `gateway/`, `frontend/`, `deploy/` |
| **B Gateway** | `gateway/` | everything | `router/`, `frontend/`, `deploy/` |
| **C Frontend** | `frontend/` | everything | `router/`, `gateway/`, `deploy/` |
| **D Infra** | `deploy/`, `docker-compose*.yml`, `.github/` | everything | app source (open an issue/PR note instead) |
| **E Bench/QA** | `bench/`, `tools/`, cross-service tests | everything | app source except tests |
| **Shared** (any track, via PR) | `contracts/`, `docs/`, `Memory.md`, `Tasks.md` status | — | — |

Cross-directory change needed? Write it in `Memory.md → Open Questions` tagged with the owning track, or make the change as a **separate PR** reviewed by that owner.

---

## 3. Contract Rules

1. `contracts/openapi.yaml` and `contracts/sse-events.md` are the source of truth for every HTTP/SSE shape.
2. **Contract changes** go in their own PR labeled `contract-change`, merged **before** any code that depends on them.
3. Changes must be **backward compatible** within a phase (add optional fields; don't rename/remove). Breaking change = bump `info.version`, update all consumers in the same phase, log in `Memory.md`.
4. After a contract change, regenerate types (`npm run gen:types` in `gateway/` and `frontend/`); Rust structs must be updated and covered by a serialization test using a fixture from `contracts/schemas/`.
5. Never ship an endpoint or event field that is not in the contract.

---

## 4. Configuration Rules

1. **No hard-coded model names, thresholds, TTLs, ports, URLs, or keyword lists** in source code. Use `config/*.yaml` and env vars.
2. Every env var is documented in `.env.example` and in `Architecture.md`/README with a default.
3. Config is validated at startup; invalid config → fail fast with a human-readable error.
4. Secrets never in git. `.env` is git-ignored; only `.env.example` is committed.

---

## 5. Coding Standards

### 5.1 Rust (router)
- Format and lint gates: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`.
- **No `unwrap()` / `expect()` / `panic!` in non-test code** except for provably infallible startup constants (comment why).
- Errors: library-style `thiserror` enums in modules; `anyhow` only in `main`. Every error maps to a contract error code.
- **No blocking calls in async code** (no `std::thread::sleep`, blocking file/network I/O). Use `tokio` equivalents or `spawn_blocking`.
- Concurrency: shared state via `Arc` + `RwLock`/`DashMap`; never hold a lock across `.await`.
- Use traits at module boundaries (`Classifier`, `Selector`, `CacheStore`, `LlmBackend`) so each is mockable.
- Resource safety: semaphore permits and in-flight guards must be RAII; verify release on cancel/drop with a test.
- Logging: `tracing` with `request_id` span on every request. No `println!`.
- Public items documented with `///`. Keep functions small; prefer pure functions for classifier/scorer.
- `unsafe` is forbidden (`#![forbid(unsafe_code)]`).

### 5.2 TypeScript / Node (gateway)
- `strict: true`; no `any` (use `unknown` + zod parse). ESLint + Prettier clean.
- Validate **all** external input with zod at the route boundary.
- No `console.log`; use `pino` with `request_id`.
- Never swallow errors: no empty `catch`. Handle or rethrow with context.
- Stream handling: abort upstream (`AbortController`) when the client disconnects; never buffer entire streams.
- Async route handlers wrapped by a central error middleware that returns the contract error envelope.
- No business/routing logic in the gateway.

### 5.3 React / TypeScript (frontend)
- Function components + hooks only. `strict: true`; no `any`.
- API access only via `src/api/` (typed client from contract types). **No `fetch` inside components.**
- Server state → TanStack Query; UI/session state → Zustand. No prop-drilling beyond 2 levels.
- Components are presentational where possible; side effects in hooks.
- Every async view implements **loading, empty, error, and streaming** states (see `Design.md`).
- Accessibility: semantic HTML, labelled controls, keyboard operable, `aria-live="polite"` on streaming output, WCAG AA contrast.
- No inline magic colors/sizes: use design tokens (`Design.md §3`).
- Charts must be driven by data props; no hard-coded sample data outside tests/storybook fixtures.

### 5.4 Shell / YAML / Docker
- Dockerfiles: multi-stage, non-root user, pinned base image tags, `.dockerignore` present, no secrets in layers.
- YAML formatted with 2 spaces; K8s manifests pass `kubectl apply --dry-run=client`.

---

## 6. Streaming Rules (critical path)

1. Streams are **never** buffered end-to-end in gateway/router/proxy. Set `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`; flush after every event.
2. Event order: `meta` → `token*` → `done` (or `error`). A second `meta` is allowed only after a fallback.
3. Heartbeat comment line (`: ping`) every 15 s on long-running streams.
4. Only **complete** (`done`) responses are cached. Partial/aborted responses are never stored.
5. On client disconnect: cancel upstream, release queue permit, record metric `llmr_client_aborts_total`.

---

## 7. Testing Rules

| Layer | Minimum required |
|-------|------------------|
| Rust classifier/scorer | Table-driven unit tests (≥ 40 labeled prompts), edge cases (empty, huge, unicode) |
| Rust policy | Unit tests for warmth, queue diversion, fallback ordering |
| Rust cache | Key normalization tests; TTL/temperature rules; Redis-down bypass |
| Rust API | Integration tests against `wiremock`/mock-ollama incl. streaming and cancel |
| Gateway | `vitest` + `supertest`: validation errors, rate limit, SSE passthrough, upstream failure |
| Frontend | Component tests for chat stream rendering, badges, dashboard empty/error states |
| E2E | At least one smoke flow against Compose + mock-ollama: prompt → meta/token/done; repeat → cache hit |

- **Bug fix = regression test first.**
- Tests are deterministic: no real Ollama, no wall-clock sleeps (use fake timers / controllable mock delays).
- Coverage guideline: ≥ 80% lines on `classifier/`, `policy/`, `cache/`; do not game it.
- Performance tests: `criterion` bench for classifier must show < 1 ms for a 2,000-char prompt.

---

## 8. Git & Review Rules

- Branch: `phase-<N>/<track>-<topic>` (e.g., `phase-3/router-classifier`).
- Commits: Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `perf:`); one logical change per commit.
- PRs: small (< ~400 changed lines where possible), description lists *what*, *why*, *how tested*, *contract impact*.
- `main` is always green and runnable via `docker compose up` (mock profile at minimum).
- No force-push to `main`. No committing build artifacts, `.env`, model files, or benchmark scratch output (only curated `bench/results/*.json`).
- Rebase on `main` before merge; resolve conflicts in your own directories only.

---

## 9. Dependency Rules

1. Prefer what is listed in `Architecture.md §9`. Adding a new dependency requires: a one-line justification in `Memory.md → Decision Log`, a license check (permissive: MIT/Apache-2.0/BSD), and confirmation it is maintained.
2. Pin versions via lockfiles; commit `Cargo.lock` and `package-lock.json`.
3. No dependency for something achievable in < 20 lines.
4. Use the allowed CDN/registry only through package managers (no ad-hoc downloads in Dockerfiles).

---

## 10. Observability & Logging Rules

1. Every request has a `request_id` (UUID v4) generated at gateway (or router if absent) and propagated in header `x-request-id` and in all logs.
2. Log levels: `error` (action needed), `warn` (degraded but serving), `info` (lifecycle/decisions), `debug` (details). Production default `info`.
3. **Privacy:** never log prompt/response text at `info` or above. Log `prompt_hash` (first 8 hex of sha256) and `prompt_len`. Full text only at `debug`, and never committed in fixtures containing personal data.
4. Metric names are prefixed `llmr_`, snake_case, base units (`_seconds`, `_total`, `_bytes`). Labels are low-cardinality (model, tier, cache, outcome) — **never** label by request_id or prompt.
5. Any new routing decision path must emit a metric and a `reason` string.

---

## 11. Security Rules

- Validate/limit input at gateway **and** router (defense in depth): max total message content 32 KB, max 50 messages, allowed roles `system|user|assistant`.
- Rate-limit public endpoints; CORS allow-list from env.
- Treat model output as untrusted: the UI renders markdown **sanitized** (no raw HTML), links `rel="noopener noreferrer"`.
- Internal services (router, redis) are not exposed on host ports in the non-dev compose profile.
- No eval/dynamic code from prompts; no shell-outs with user content.
- Run containers as non-root, read-only root filesystem where feasible, drop capabilities in K8s.

---

## 12. Performance Budgets (enforced in review/benchmarks)

| Item | Budget |
|------|--------|
| Classifier | < 1 ms per request |
| Router overhead (excl. inference), p95 | < 20 ms |
| Cache-hit TTFT | < 50 ms |
| Gateway added latency | < 15 ms |
| Idle RAM of non-LLM stack | < 1.5 GB |
| Dashboard SSE update interval | ~1 s, payload < 20 KB |

Regressions beyond budget block merge unless justified in the PR and logged in `Memory.md`.

---

## 13. Documentation Rules

- Public behavior changes update the relevant doc in the **same PR** (`README`, `Architecture.md`, `Design.md`, contracts).
- Every directory with code has a short `README.md` (purpose, run, test).
- `Memory.md` is updated at the **end of every task** (status, decisions, handoff).
- Diagrams are text-based (Mermaid/ASCII) so they diff cleanly; export a PNG only for the final README.
- Benchmark claims in docs must link to a committed result file and state hardware + date.

---

## 14. Pre-Merge Checklist

- [ ] Task acceptance criteria met; task marked in `Tasks.md`
- [ ] Contract unchanged **or** `contract-change` PR merged first
- [ ] Format + lint clean (`cargo fmt/clippy`, `eslint/prettier`)
- [ ] Unit + integration tests added and passing; no flaky tests
- [ ] No hard-coded models/thresholds/URLs; config + `.env.example` updated
- [ ] No `unwrap`/`any`/`console.log`/`println!` introduced
- [ ] Streaming path verified unbuffered (manual or test)
- [ ] Logs/metrics added for new behavior; no prompt text at `info`
- [ ] Docs updated; `Memory.md` handoff entry written
- [ ] Runs via `docker compose up` (mock profile) if services changed

---

## 15. Prohibited Actions

1. Editing another track's directory without the PR route (Rule 2).
2. Changing a contract without a `contract-change` PR.
3. Hard-coding model names or thresholds.
4. Caching partial, errored, or high-temperature responses.
5. Adding routing logic to the gateway or frontend.
6. Using real Ollama in automated tests.
7. Committing secrets, `.env`, model weights, or large binaries.
8. Disabling lint rules, `#[allow(...)]`, or `// @ts-ignore` without a linked justification comment.
9. Reporting benchmark numbers that were not produced by the committed harness.
10. Claiming a task complete with failing or skipped tests.
