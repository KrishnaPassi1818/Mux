# Acceptance status and known limitations

This table is intentionally conservative. A feature being present in source is not the same as acceptance criteria passing in a real deployment.

| Area | Current state | Evidence / remaining work |
|---|---|---|
| Contracts and generated types | Implemented; validation script checks OpenAPI, JSON fixtures, and YAML configuration | `npm run contracts:check`; rerun after contract edits |
| Gateway | Express/TypeScript routes, validation, request IDs, SSE proxy, rate limiting, metrics, benchmark endpoints | `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`; exercise through mock stack |
| Frontend | Chat, dashboard, benchmark, settings, typed clients, route chunks and responsive styling | `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`; manual browser accessibility pass remains |
| Mock services | Node mock Ollama and mock router | Mock-Ollama test; end-to-end smoke is run against `npm run dev:mock`; container run remains unverified without Docker |
| Rust router | Implementation source is present | **Not compiled or tested here** because Cargo/Rust are unavailable. Run `cargo fmt`, `cargo test`, `cargo clippy`, API/wiremock tests and verify the Docker build in Rust-enabled CI before claiming completion |
| Redis behavior | Redis cache implementation and Compose/Kubernetes Redis resources are present | Redis integration/down-bypass tests and container checks remain unverified in this environment |
| Benchmark harness | Deterministic A/B/C runner, checkpoint/resume, 72 labeled prompts, per-request JSON output and mock-backend disclosure | `npm run bench:typecheck`; run full hardware benchmark on target Ollama/GPU. No committed hardware result exists |
| Routing KPI-1 | Harness computes accuracy against expected tier labels | Dataset/config require a full Rust-runner audit after Rust compiles; target is not yet verified |
| KPI-2 | Harness compares A/B means and writes a data-driven verdict | Target hardware and models unavailable; no performance claim is made |
| KPI-3 | Cache hits are measured in run C and TTFT is recorded | Verify cache TTFT budget with Redis/inference integration |
| KPI-4 | Criterion benchmark and request histograms are in source | Router overhead isolation and <20 ms p95 are not yet measured |
| KPI-5 | Per-request model load duration and swap expectation are available | True v1-v2 comparison and real swap-counter audit remain outstanding |
| Peak VRAM/GPU | Stats schema allows nullable GPU fields; Grafana has optional exporter target | Rust stats currently report unavailable values; peak VRAM collection is not implemented/verified |
| Docker/Compose | Dockerfiles, Compose base, mock and observability overlays are included | **Not run here** because Docker is unavailable. Build all images, validate healthchecks, SSE through NGINX, volumes, and low-resource usage |
| Kubernetes | Kustomize base, dev overlay, local cluster scripts, PVCs, probes, resource limits and HPA are present | **Not applied here** because kubectl/cluster are unavailable. Run Kustomize render/client dry-run, rollout, PVC restart, ingress/port-forward, and HPA checks |
| CI | Workflow files are part of the repository | Requires GitHub Actions execution; do not call green until CI completes successfully |
| Security | Non-root/read-only containers, input validation, CORS allow-list, limits and prompt-safe logs are implemented in source/config | No auth in v1; perform a full dependency/security audit and production hardening before network exposure |
| Documentation | README, architecture/design/rules/task/memory specs, benchmark/config/operations/demo/security docs | Demo video, external fresh-clone review, and final acceptance signoff remain outstanding |

## Environment blockers

At the time this workspace was built, `cargo`, `rustc`, `docker`, and `kubectl` were not available. No Ollama process, configured model weights, target laptop/GPU, GPU exporter, or target hardware benchmark was available either. These are blockers to Rust compilation, container/Kubernetes validation, real streaming verification, and hardware performance measurements—not reasons to invent or infer results.
