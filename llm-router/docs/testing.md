# Testing and verification

## JavaScript/TypeScript checks

```bash
npm ci
npm run contracts:check
npm test
npm run lint
npm run typecheck
npm run build
```

`npm run test` executes Vitest suites for the gateway/frontend and Node's test runner for mock Ollama. `npm run typecheck` includes `bench/run.ts`. The contract validator checks OpenAPI 3.1, JSON Schema fixtures and YAML parse/config invariants.

## Mock end-to-end smoke

For the all-Node development stack, run `npm run dev:mock` in one terminal and `deploy/scripts/mock-smoke.sh` in another. The smoke script verifies health, model/preview endpoints, a complete `meta → token* → done` chat stream, and a cache hit on an exact repeat. Use the mock result only to test behavior.

The Compose-level mock is defined by `docker-compose.yml` plus `deploy/docker-compose.mock-router.yml`; the `mock` profile instead runs the Rust router with mock Ollama. Both need Docker. Compose-level build/health/SSE tests are part of CI and should be executed on every infrastructure change.

## Rust checks (Rust-enabled environment)

From the repository root:

```bash
cargo fmt --manifest-path router/Cargo.toml -- --check
cargo test --manifest-path router/Cargo.toml --locked
cargo clippy --manifest-path router/Cargo.toml --all-targets --locked -- -D warnings
cargo bench --manifest-path router/Cargo.toml --bench classifier --locked
```

Rust source is unverified in workspaces without Cargo. Treat CI compile/test output as a gate; do not infer a passing Rust build from TypeScript tests or the Node mock stack.

## Container / Kubernetes

```bash
docker compose config
docker compose -f docker-compose.yml -f deploy/docker-compose.mock-router.yml up --build -d --wait
deploy/scripts/compose-smoke.sh
docker compose -f docker-compose.yml -f deploy/docker-compose.mock-router.yml down -v
```

Kubernetes: render with `kubectl kustomize deploy/k8s/overlays/dev`, then use the local scripts in `deploy/k8s/scripts/`. Verify PVC provisioning, image imports, readiness/liveness, ingress/port-forward, and HPA/Metrics Server behavior on the target cluster.

## Reproducibility and benchmark gates

- Use the exact committed prompt dataset/config and save the generated result JSON.
- State hardware, backend, date, model tags, warm-up policy, and prompt count.
- Do not treat mock times as model results.
- The current benchmark's KPI-4 and KPI-5 are intentionally marked unmeasured; GPU peak VRAM is not currently collected.
