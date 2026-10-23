FROM node:24.22.0-alpine3.22
ENV NODE_ENV=production MOCK_OLLAMA_HOST=0.0.0.0 MOCK_OLLAMA_PORT=11434 MODELS_CONFIG=/app/config/models.yaml
WORKDIR /app
COPY tools/mock-ollama/package.json tools/mock-ollama/package-lock.json ./tools/mock-ollama/
RUN npm ci --prefix /app/tools/mock-ollama --omit=dev --no-audit
COPY --chown=node:node config ./config
COPY --chown=node:node tools/mock-ollama/server.mjs ./tools/mock-ollama/server.mjs
WORKDIR /app/tools/mock-ollama
USER node
EXPOSE 11434
HEALTHCHECK --interval=10s --timeout=2s --start-period=2s --retries=3 CMD node -e "fetch('http://127.0.0.1:11434/api/tags').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
