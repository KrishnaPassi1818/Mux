# Rust router

The Axum service owns classification, policy selection, per-model queueing, Ollama calls, response caching, SSE events, stats, health, and Prometheus metrics. Models and policy are loaded from `config/models.yaml`, `config/routing.yaml`, and `config/server.yaml` (paths can be overridden via environment).

## Run

From the repository root, start Redis and Ollama, then run:

```bash
cargo run --manifest-path router/Cargo.toml
```

The default listener is configured in `config/server.yaml`. Health is `/healthz`; internal versioned API routes are documented in `contracts/openapi.yaml`. The Node gateway is the intended public API surface.

## Test and lint

```bash
cargo fmt --manifest-path router/Cargo.toml -- --check
cargo test --manifest-path router/Cargo.toml --locked
cargo clippy --manifest-path router/Cargo.toml --all-targets --locked -- -D warnings
cargo bench --manifest-path router/Cargo.toml --bench classifier --locked
```

The Rust source has not been compiled in the current environment because Cargo/Rust are unavailable. Run all commands in Rust-enabled CI before relying on the image or reporting the router as verified. See `docs/acceptance-status.md`.
