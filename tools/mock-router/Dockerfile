FROM node:24.22.0-alpine3.22
ENV NODE_ENV=production ROUTER_HOST=0.0.0.0 ROUTER_PORT=8081
WORKDIR /workspace
COPY tools/mock-router/package.json tools/mock-router/package-lock.json ./tools/mock-router/
RUN npm ci --prefix /workspace/tools/mock-router --omit=dev --no-audit
COPY --chown=node:node config ./config
COPY --chown=node:node tools/mock-router/server.mjs ./tools/mock-router/server.mjs
WORKDIR /workspace/tools/mock-router
USER node
EXPOSE 8081
HEALTHCHECK --interval=10s --timeout=2s --start-period=2s --retries=3 CMD node -e "fetch('http://127.0.0.1:8081/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
