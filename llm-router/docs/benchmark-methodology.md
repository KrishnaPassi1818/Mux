# Benchmark methodology

This document describes the committed harness in `bench/run.ts`, dataset in `bench/prompts.json`, and JSON contract in `contracts/schemas/benchmark-result.schema.json`.

## Dataset

`prompts.json` contains 72 labeled cases: 20 unique prompts each for `simple`/`light`, `code`/`code`, and `complex`/`heavy`, plus 12 labeled duplicates (four per category). Duplicates are retained on purpose so the cache run has exact repeats. Expected tiers are annotations for routing classification only; they do **not** assert answer quality.

## Runs

The harness preserves deterministic order from the prompt file (or uses a balanced simple/code/complex selection when `BENCH_LIMIT` is set):

| Run | Routing mode | Cache | Cases |
|---|---|---|---|
| A | Force the configured heavy-tier model for every prompt | Disabled | Prompt set once |
| B | Automatic routing | Disabled | Prompt set once |
| C | Automatic routing | Enabled | Prompt set twice in the same order |

Before each run, the harness flushes the router cache and completes one unmeasured forced-heavy warm-up request. Prompt options, request order, and warm-up procedure are shared across runs. The C cache is kept between its two passes. Do not compare runs made with different model registries, sampling options, data, or warm-up policy without recording the difference.

## Measurements

- `latency_ms` is measured by the runner from the successful gateway request start until the terminal SSE `done` event.
- `ttft_ms`, `tokens_per_sec`, token counts, and load duration come from the router's terminal usage metadata; they are not inferred from token text.
- `mean_ms`, nearest-rank `p50_ms`/`p95_ms`, mean TTFT, and mean tokens/s are computed from per-request rows.
- `cache_hit_rate` counts `meta.cache == hit` over all requests in that run. Run C has two passes and can include labeled duplicates.
- The reported `swaps` count is a proxy: non-cache-hit inference requests with a positive Ollama `load_ms`. It is not a hardware counter and does not establish a model swap in every Ollama version.
- `total_wall_ms` includes harness overhead and any gateway rate-limit backoff; per-request latency excludes retry backoff by starting its timer on the successful attempt.
- Accuracy and the confusion matrix use `/api/route/preview` and the labels from the dataset. This is classifier/tier agreement, not quality scoring.
- GPU/VRAM fields are omitted when the stats API reports them unavailable. This implementation does not currently collect a peak VRAM sample.

The runner retries HTTP 429 responses using `Retry-After` and the configurable backoff in `config/bench.yaml`. It checkpoints each preview and completed request in `bench/results/.checkpoint`; run `npm run bench -- --resume` or set `BENCH_RESUME=true` to continue with the same prompt selection. A changed selection invalidates the checkpoint. A partially completed C run assumes the Redis cache has remained available; if Redis was cleared during an interruption, discard the checkpoint and start C again.

## Output and claims

Successful runs are atomically saved as `bench/results/<run-id>.json`; gateway `GET /api/benchmark/results` serves those files, and the Benchmark page displays saved runs. The file records host hardware text, backend description, methodology, per-request rows, aggregates, confusion matrix, and measured KPI values. The runner explicitly labels mock backends as smoke-only.

Do not publish mock-router or mock-Ollama timings as inference performance. A valid hardware result needs the real Ollama model tags, host/GPU/VRAM information, date, full prompt count, and an unmodified committed harness. Until such a run is performed, KPI claims remain **unverified**. KPI-1/2 are measured by the harness; KPI-3 is only partially represented by C cache hits (cache TTFT should also be checked); KPI-4 requires dedicated overhead instrumentation; KPI-5 requires a true v1-v2 comparison; GPU peak VRAM is not implemented.
