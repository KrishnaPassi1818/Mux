# syntax=docker/dockerfile:1.7
FROM node:26.11.1-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY gateway/package.json ./gateway/package.json
COPY frontend/package.json ./frontend/package.json
COPY tools/mock-ollama/package.json ./tools/mock-ollama/package.json
COPY tools/mock-router/package.json ./tools/mock-router/package.json
RUN npm ci
COPY contracts ./contracts
COPY bench ./bench
COPY gateway ./gateway
RUN npm run build --workspace=@llm-router/gateway

FROM node:26.11.1-bookworm-slim AS runtime
ENV NODE_ENV=production GATEWAY_HOST=0.0.0.0 GATEWAY_PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
COPY gateway/package.json ./gateway/package.json
COPY frontend/package.json ./frontend/package.json
COPY tools/mock-ollama/package.json ./tools/mock-ollama/package.json
COPY tools/mock-router/package.json ./tools/mock-router/package.json
RUN npm ci --omit=dev --workspace=@llm-router/gateway --include-workspace-root=false \
    && npm cache clean --force \
    && groupadd --system --gid 10001 llmr \
    && useradd --system --uid 10001 --gid llmr --home-dir /nonexistent --shell /usr/sbin/nologin llmr
COPY --from=build --chown=10001:10001 /app/gateway/dist ./gateway/dist
COPY --from=build --chown=10001:10001 /app/bench ./bench
COPY --chown=10001:10001 config ./config
COPY --chown=10001:10001 contracts ./contracts
COPY --chown=10001:10001 bench/prompts.json ./bench/prompts.json
RUN mkdir -p /app/bench/results && chown -R 10001:10001 /app/bench/results
USER 10001:10001
WORKDIR /app/gateway
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=4s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
