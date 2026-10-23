# Frontend

React 19 + Vite + TypeScript application for local chat, routing transparency, live system statistics, benchmarks, and configuration. Tailwind is configured against `Design.md` CSS tokens; the visual system and all charts use data returned by the APIs.

## Run

```bash
npm run dev --workspace=@llm-router/frontend
```

Vite serves `http://localhost:5173` and proxies `/api` to the gateway at `http://localhost:3000`. The application supports dark/light/system themes, reduced motion, keyboard interaction and sanitized Markdown. Use `npm test`, `npm run typecheck --workspace=@llm-router/frontend`, `npm run lint --workspace=@llm-router/frontend`, and `npm run build --workspace=@llm-router/frontend`.
