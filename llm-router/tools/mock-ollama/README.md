# Mock Ollama

A deterministic Ollama-compatible Node service for GPU-less tests. It reads the model registry from `config/models.yaml`, supports `/api/tags`, `/api/ps`, and `/api/chat` NDJSON streaming, emits final timing/token fields, and can inject delay/failure per model through environment variables.

## Run and test

```bash
npm run dev --workspace=@llm-router/mock-ollama
npm run test --workspace=@llm-router/mock-ollama
```

It is available in Docker Compose under the `mock` profile. The mock validates request, stream, cache, and fallback plumbing; its delays and tokens/s are synthetic and must not be reported as real inference performance.
