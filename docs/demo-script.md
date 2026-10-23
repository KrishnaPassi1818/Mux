# Five-minute demo script

This script is designed for the deterministic local mock stack. It demonstrates routing, streaming, cache behavior, the live dashboard, and the benchmark page without claiming that mock timings represent model inference.

## Before the demo

```bash
npm ci
npm run dev:mock
```

Open <http://localhost:5173>. Confirm the connection indicator is healthy. If using Docker instead, follow the mock Compose command in the root README and open the frontend on port 8080.

## 0:00–1:00 — Explain the flow

Show the diagram in `Architecture.md`: React → Node gateway → Rust router → Ollama, with Redis cache and Prometheus/Grafana. Clarify that this run uses `mock-router`, not the Rust service or a real local model; it is for UI/API smoke testing only.

## 1:00–2:00 — Automatic routing and streaming

1. Send a short greeting or factual question; point to the route badge (tier, model, score, reason) arriving before the stream completes.
2. Send a programming prompt such as “Write a Python function to reverse a string”; show the code tier and streaming response.
3. Send a multi-step analysis prompt; show the selected tier and explanation. If the classifier chooses an unexpected tier, show the preview/decision honestly rather than changing the result live.

## 2:00–3:00 — Cache and dashboard

1. Repeat the exact same low-temperature prompt with cache enabled; point to the cache badge.
2. Open Dashboard; show request counts, recent decisions, queue/model distributions, and the labeled estimate panel. Explain that mock stats are synthetic and estimated savings is not a benchmark measurement.

## 3:00–4:00 — Benchmark page

Open Benchmark. Explain A (forced heavy/no cache), B (automatic/no cache), and C (automatic/cache on, two passes), the labeled prompt set, and the stored methodology. If the saved run is from a mock backend, point to the mock warning and do not quote its latency as model performance. A full local inference run is started from the same page or with `npm run bench` against a real gateway.

## 4:00–5:00 — Operations and limits

Show Settings for the model registry/cache flush and mention the Compose/Kubernetes files. State the important limits: no API-key auth in v1, one-GPU inference is not horizontally scalable, GPU metrics require the optional exporter, and hardware KPIs need a real target-hardware run. Finish at `docs/acceptance-status.md` for unverified criteria.
