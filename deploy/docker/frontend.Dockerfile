# syntax=docker/dockerfile:1.7
FROM node:24.22.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY gateway/package.json ./gateway/package.json
COPY frontend/package.json ./frontend/package.json
COPY tools/mock-ollama/package.json ./tools/mock-ollama/package.json
COPY tools/mock-router/package.json ./tools/mock-router/package.json
RUN npm ci
COPY contracts ./contracts
COPY config ./config
COPY frontend ./frontend
RUN npm run build --workspace=@llm-router/frontend

FROM nginxinc/nginx-unprivileged:1.31.7-alpine AS runtime
COPY deploy/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/ || exit 1
