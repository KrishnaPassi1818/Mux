# syntax=docker/dockerfile:1.7
FROM lukemathwalker/cargo-chef:0.1.71-rust-1.85.1-slim-bookworm AS chef

FROM chef AS planner
WORKDIR /app/router
COPY router/Cargo.toml ./Cargo.toml
COPY router/Cargo.lock ./Cargo.lock
COPY router/src ./src
COPY router/benches ./benches
RUN cargo chef prepare --recipe-path /app/recipe.json

FROM chef AS builder
WORKDIR /app/router
COPY --from=planner /app/recipe.json /app/recipe.json
RUN cargo chef cook --release --locked --recipe-path /app/recipe.json
COPY router ./
RUN cargo build --release --locked --manifest-path Cargo.toml

FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 llmr \
    && useradd --system --uid 10001 --gid llmr --home-dir /nonexistent --shell /usr/sbin/nologin llmr
WORKDIR /app
COPY --from=builder --chown=10001:10001 /app/router/target/release/llm-router /usr/local/bin/llm-router
COPY --chown=10001:10001 config /app/config
ENV ROUTER_HOST=0.0.0.0 ROUTER_PORT=8081 SERVER_CONFIG=/app/config/server.yaml MODELS_CONFIG=/app/config/models.yaml ROUTING_CONFIG=/app/config/routing.yaml
USER 10001:10001
EXPOSE 8081
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 CMD curl --fail --silent http://127.0.0.1:8081/healthz >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/llm-router"]
