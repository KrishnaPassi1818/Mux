# SSE event contract

All endpoints emit UTF-8 Server-Sent Events (SSE): `event: <name>\ndata: <JSON>\n\n`. A heartbeat is the comment `: ping\n\n` and is not an event. Each JSON data object must validate against its same-named schema in `schemas/`.

## Chat stream: `POST /api/chat` and `POST /v1/route/chat`

Ordering: one initial `meta`, zero or more `token`, then exactly one `done` or `error`. A fallback may emit one additional `meta` before any tokens from the fallback model. The `meta.request_id` and `done.request_id` match the `x-request-id` response header. Gateway and router must flush each frame immediately and set `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, and `X-Accel-Buffering: no`.

| Event | Data | Notes |
|---|---|---|
| `meta` | `schemas/meta.schema.json` | Routing, cache and model metadata; cache hit still replays tokens |
| `token` | `schemas/token.schema.json` | A text delta; concatenating `text` reconstructs the assistant message |
| `done` | `schemas/done.schema.json` | Final usage; only this event makes a response eligible for caching |
| `error` | `schemas/error.schema.json` | Terminal error; never followed by `done` |
| comment | — | `: ping` every 15 seconds while waiting for upstream data |

Example:

```text
event: meta
data: {"request_id":"00000000-0000-4000-8000-000000000001","model":"gemma3:4b","tier":"light","score":12,"intent":"chat","reason":"short factual question","cache":"miss","swap_expected":false}

event: token
data: {"text":"Hello"}

event: done
data: {"request_id":"00000000-0000-4000-8000-000000000001","usage":{"prompt_tokens":4,"completion_tokens":1,"ttft_ms":18,"total_ms":31,"tokens_per_sec":32.3,"load_ms":0}}
```

## Stats stream: `GET /api/stats/stream`

Emits `event: stats` once per second with the JSON payload described by `schemas/stats.schema.json`. It sends `: ping` every 15 seconds if no snapshot is available. Clients reconnect with bounded exponential backoff.

## Error codes

`INVALID_REQUEST`, `RATE_LIMITED`, `UPSTREAM_TIMEOUT`, `UPSTREAM_UNAVAILABLE`, `MODEL_NOT_FOUND`, `QUEUE_FULL`, `INTERNAL`. Non-streaming errors use the OpenAPI `ErrorEnvelope`; streaming errors use `error.schema.json`. Do not place prompt or response content in errors or logs.
