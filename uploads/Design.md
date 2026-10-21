# Design — LLM Router UI/UX

Scope: the React frontend (`/frontend`). Behavior/data come from `contracts/`; routing logic is never implemented in the UI (see `Rules.md §5.3`).

---

## 1. Design Principles

1. **Transparency first** — every answer shows *which model* and *why*.
2. **Speed you can feel** — stream tokens immediately; show cache hits distinctly.
3. **Proof, not claims** — dashboards and benchmarks present measured numbers and label estimates as estimates.
4. **Calm, technical aesthetic** — dark-first, dense but readable, no decorative noise.
5. **Resilient** — every view has loading, empty, error and streaming states.

---

## 2. Information Architecture

```
/                Chat           (primary)
/dashboard       Live Dashboard (real-time stats)
/benchmark       Benchmark      (A/B/C comparison, accuracy)
/settings        Settings       (models view, cache flush, theme, API base)
```

Top navigation: logo · Chat · Dashboard · Benchmark · Settings · connection status dot (gateway/router/redis/ollama health) · theme toggle.

---

## 3. Design Tokens

Define as CSS variables (Tailwind reads them; no raw hex in components).

```css
:root {
  /* surfaces */
  --bg:            #0b0f14;
  --surface-1:     #111821;
  --surface-2:     #172130;
  --border:        #243247;
  /* text */
  --text:          #e6edf5;
  --text-muted:    #93a4b8;
  /* brand + semantic */
  --accent:        #4f9dff;
  --success:       #34d399;
  --warning:       #fbbf24;
  --danger:        #f87171;
  /* tier colors (also used in charts) */
  --tier-light:    #34d399;  /* emerald */
  --tier-code:     #a78bfa;  /* violet  */
  --tier-heavy:    #fbbf24;  /* amber   */
  --cache:         #22d3ee;  /* cyan    */
  /* shape & motion */
  --radius-sm: 6px; --radius-md: 10px; --radius-lg: 16px;
  --shadow-1: 0 1px 2px rgb(0 0 0 / .35);
  --ease: cubic-bezier(.2,.8,.2,1); --dur-fast: 120ms; --dur: 200ms;
}
[data-theme="light"] {
  --bg:#f6f8fb; --surface-1:#ffffff; --surface-2:#eef2f7; --border:#d8e0ea;
  --text:#0f1a2a; --text-muted:#51647c;
  --accent:#1d6fe0; --success:#0f9d6b; --warning:#b7791f; --danger:#d64545;
  --tier-light:#0f9d6b; --tier-code:#6d4fd6; --tier-heavy:#b7791f; --cache:#0891b2;
}
```

| Token set | Value |
|-----------|-------|
| Font (UI) | Inter, system-ui, sans-serif |
| Font (code/metrics) | JetBrains Mono, ui-monospace, monospace |
| Type scale | 12 / 14 (body) / 16 / 20 / 24 / 32 px |
| Spacing | 4-px base: 4, 8, 12, 16, 24, 32, 48 |
| Breakpoints | sm 640 · md 768 · lg 1024 · xl 1280 |
| Max content width | Chat 820 px; Dashboard 1280 px |

**Color is never the only signal:** tier badges also carry an icon/label (⚡ light, `</>` code, 🧠 heavy → use `lucide-react` icons `Zap`, `Code2`, `Brain`).

---

## 4. Core Components

| Component | Purpose | Key props / behavior |
|-----------|---------|----------------------|
| `AppShell` | Layout, nav, health dot, theme toggle | Sticky top bar |
| `PromptInput` | Multi-line input, send/stop | Enter = send, Shift+Enter = newline, Esc = stop stream; char counter vs limit |
| `ModelSelector` | Auto / force model | Default "Auto (router)"; options come from `/api/models` |
| `ChatMessage` | Renders user/assistant message | Markdown (sanitized), code blocks with copy button |
| `RouteBadge` | Shows tier icon + model + score | Tooltip/popover: intent, reason, swap expected |
| `CacheBadge` | "⚡ cached · 12 ms" | Cyan; shows original model that produced it |
| `UsageFooter` | tokens, TTFT, tokens/s, total ms | Mono font, muted |
| `PreviewHint` | Debounced routing preview while typing | Calls `/api/route/preview` after 400 ms idle; optional toggle |
| `StatCard` | KPI tile (value, delta, sparkline) | Used on dashboard |
| `ModelDonut` | Request share by model | Tier colors; legend with counts |
| `LatencyChart` | Latency over time per model | Line chart, last 5 min window |
| `LatencyBars` | Avg/p95 latency by model | Bar chart |
| `CacheGauge` | Hit rate | Radial gauge |
| `VramBar` | VRAM used/total + loaded model name | Warning color > 90% |
| `QueueStatus` | Per-model queue depth | Small pills |
| `DecisionFeed` | Last 20 routing decisions | Virtualized list, newest on top, animated insert |
| `EfficiencyPanel` | "Time saved vs heavy-only" | Big number + % + **"Estimated"** chip with info tooltip |
| `BenchmarkCompare` | Runs A/B/C comparison | Grouped bars + metrics table |
| `ErrorBanner` / `EmptyState` / `Skeleton` | State handling | Consistent copy (§8) |

---

## 5. Screen Designs

### 5.1 Chat (`/`)

```
┌───────────────────────────────────────────────────────────────────────┐
│ ◈ LLM Router   Chat  Dashboard  Benchmark  Settings        ● healthy ☾ │
├───────────────────────────────────────────────────────────────────────┤
│                                                                       │
│   ┌ You ────────────────────────────────────────────────┐             │
│   │ Write a Python function to detect a cycle in a list │             │
│   └─────────────────────────────────────────────────────┘             │
│                                                                       │
│   ┌ Assistant ──────────────────────────────────────────┐             │
│   │ [</> qwen2.5-coder:7b · score 62]  [miss]           │ ← RouteBadge│
│   │ ```python                                           │             │
│   │ def has_cycle(head): ...                            │             │
│   │ ```                                                 │             │
│   │ 180 tok · TTFT 420 ms · 31 tok/s · 6.1 s            │ ← Usage     │
│   └─────────────────────────────────────────────────────┘             │
│                                                                       │
├───────────────────────────────────────────────────────────────────────┤
│ Likely route: [🧠 llama3.1:8b] (preview)          Model: [Auto ▾]     │
│ ┌───────────────────────────────────────────────────────┐  [ Send ➤ ] │
│ │ Type a message…                                       │             │
│ └───────────────────────────────────────────────────────┘ ☐ bypass cache│
└───────────────────────────────────────────────────────────────────────┘
```

**Behaviors**
- On send: append user message, create assistant placeholder in `streaming` state; show `RouteBadge` as soon as `meta` arrives (before first token).
- Tokens append in place; auto-scroll only if user is within 80 px of bottom (otherwise show "Jump to latest").
- `done` finalizes usage footer; `error` shows inline retry.
- Cache hit: message appears nearly instantly with `CacheBadge`; subtle cyan left border.
- Fallback (second `meta`): badge animates to the new model with note "fell back from X (timeout)".
- Stop button cancels the request (aborts fetch).

### 5.2 Dashboard (`/dashboard`)

```
┌───────────────────────────────────────────────────────────────────────┐
│ Live · window 5 min ▾                                      ● streaming │
├───────────┬───────────┬───────────┬───────────┬──────────────────────┤
│ Requests  │ Avg lat.  │ Cache hit │ Swaps     │ Efficiency vs heavy  │
│   120     │  3.2 s    │  28 %     │   7       │  −41 %  [Estimated]  │
├───────────┴───────────┴───────────┴───────────┴──────────────────────┤
│  Latency over time (per model)            │  Model distribution       │
│  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ │     ◔ donut + legend      │
├───────────────────────────────────────────┼───────────────────────────┤
│  Avg / p95 latency by model (bars)        │  Loaded model & VRAM      │
│  ▇▇ ▇▇▇ ▇▇▇▇                              │  gemma3:4b  ▇▇▇▇░░ 3.4/6GB│
│                                           │  Queues: L 0 · C 1 · H 0  │
├───────────────────────────────────────────┴───────────────────────────┤
│ Recent decisions                                                      │
│ 12:04:11  ⚡ gemma3:4b      score 14  "short factual"      1.5 s  miss │
│ 12:04:02  </> qwen2.5-coder score 62  "code keywords"      5.2 s  miss │
│ 12:03:55  ⚡ cached                                         0.02 s hit │
└───────────────────────────────────────────────────────────────────────┘
```

- Data from `/api/stats/stream` (SSE ~1 s). Charts keep a client-side ring buffer (max 300 points).
- Time window selector (1 / 5 / 15 min) filters the buffer client-side.
- `EfficiencyPanel` always shows "Estimated" chip; clicking opens popover explaining the formula and linking to Benchmark for measured results.

### 5.3 Benchmark (`/benchmark`)

```
┌───────────────────────────────────────────────────────────────────────┐
│ Benchmark results   Run: [2026-10-17 14:02 ▾]   [Run new ▸] [Download]│
├───────────────────────────────────────────────────────────────────────┤
│ Verdict: Router is 38% faster on mean latency than heavy-only         │
│ Hardware: RTX 4050 6GB · 60 prompts · 2026-10-17                      │
├───────────────────────────────────────────────────────────────────────┤
│  Mean latency        Total wall time       Tokens/s                   │
│  A ▇▇▇▇▇▇▇▇          A ▇▇▇▇▇▇▇▇            A ▇▇▇▇▇                    │
│  B ▇▇▇▇▇             B ▇▇▇▇▇                B ▇▇▇▇▇▇                   │
│  C ▇▇▇               C ▇▇▇                  C —                        │
├───────────────────────────────────────────────────────────────────────┤
│ Metric        | A heavy-only | B router | C router+cache              │
│ mean / p50 / p95 · TTFT · swaps · peak VRAM · cache hit · accuracy    │
└───────────────────────────────────────────────────────────────────────┘
```
- Verdict sentence is generated from data (never hard-coded); if the target is missed, it says so plainly.
- Routing accuracy shown with a small confusion matrix (expected tier × routed tier).

### 5.4 Settings (`/settings`)
Read-only registry table (tier, model, timeout, concurrency, loaded?), cache flush button with confirm dialog, theme (dark/light/system), API base URL display, app/build version.

---

## 6. Interaction & Motion

| Interaction | Behavior |
|-------------|----------|
| Streaming text | Append without reflow jitter; blinking caret at end |
| Badge appear | Fade/scale-in 120 ms when `meta` arrives |
| Decision feed insert | Slide-down 200 ms; respects `prefers-reduced-motion` |
| Chart updates | Animate only on data change, ≤ 300 ms; disabled with reduced motion |
| Hover/focus | Visible 2-px focus ring using `--accent` |
| Keyboard | `Enter` send · `Shift+Enter` newline · `Esc` stop · `Ctrl/⌘+K` focus model selector · `g d` go to dashboard (optional) |

---

## 7. Data → Visual Mapping

| Visual | Source field(s) | Refresh |
|--------|-----------------|---------|
| Requests / hit rate / swaps | `requests_total`, `cache.hit_rate`, `swaps` | 1 s |
| Model donut | `by_model[*].count` | 1 s |
| Latency lines | `recent[*].latency_ms` grouped by `model` | 1 s (append) |
| Latency bars | `by_model[*].avg_latency_ms` (+ p95 when provided) | 1 s |
| VRAM bar | gateway-merged `gpu.vram_used/vram_total` | 5 s |
| Queue pills | `queue_depth` | 1 s |
| Efficiency panel | `estimated_savings.{time_ms,pct_vs_heavy_only}` | 1 s |
| Decision feed | `recent[*]` | 1 s (diff by timestamp+id) |
| Benchmark charts/table | `bench/results/*.json` via `/api/benchmark/results` | on load |

If a field is absent (older result files), the UI shows "—" and never crashes.

---

## 8. States & Microcopy

| State | Copy / behavior |
|-------|-----------------|
| Chat empty | "Ask anything. I'll pick the right local model for it." + 3 suggestion chips (simple / code / reasoning) |
| Connecting dashboard | Skeleton cards + "Connecting to live stats…" |
| Dashboard no data | "No requests yet — send a prompt in Chat to see routing in action." |
| Stream error | "Couldn't finish this response (UPSTREAM_TIMEOUT). [Retry]" + request id (copy) |
| Fallback | "Switched from **llama3.1:8b** to **qwen2.5-coder:7b** after a timeout." |
| Backend down | Banner: "Router unreachable. Check that the stack is running." with health detail |
| Rate limited | "Too many requests. Try again in {n}s." |
| Estimate chip tooltip | "Estimated from average heavy-model speed. See Benchmark for measured results." |
| Reason strings (from router) | Short, lowercase fragment: "short factual question", "code keywords + stack trace", "multi-step reasoning" |

---

## 9. Accessibility

- WCAG 2.1 AA contrast in both themes; tier colors verified against surfaces.
- Streaming region: `role="log"`, `aria-live="polite"`, `aria-busy` while streaming.
- All icons paired with text or `aria-label`; charts have a text summary and a "View as table" toggle.
- Full keyboard navigation; focus is restored after dialogs close; no keyboard traps.
- Respect `prefers-reduced-motion` and `prefers-color-scheme` (system default).

---

## 10. Responsive Behavior

| Width | Chat | Dashboard |
|-------|------|-----------|
| < 640 | Single column; model selector in a bottom sheet; badges collapse to icon + model | Cards stack 1-up; charts full-width; feed collapsible |
| 640–1023 | Single column, wider | 2-up grid |
| ≥ 1024 | Centered 820 px column | 12-col grid as in wireframe |

---

## 11. Frontend Structure (maps to design)

```
frontend/src/
├── api/          client.ts (typed), sse.ts (POST-stream parser), stats.ts, bench.ts
├── store/        chatStore.ts, settingsStore.ts
├── lib/          format.ts (ms, tokens), cn.ts, ringBuffer.ts
├── components/   ui/ (primitives) · chat/ · dashboard/ · benchmark/
├── pages/        Chat.tsx · Dashboard.tsx · Benchmark.tsx · Settings.tsx
├── styles/       tokens.css · globals.css
└── test/         fixtures (SSE transcripts, stats snapshots)
```

**SSE client contract:** `streamChat(req, {onMeta, onToken, onDone, onError, signal})` parses `event:`/`data:` frames from a `fetch` `ReadableStream`; handles partial frames split across chunks, `: ping` comments, and abort. It is unit-tested with recorded transcripts in `test/fixtures`.

---

## 12. Design Acceptance Checklist

- [ ] Route badge shows model, tier icon, score, and reason before first token
- [ ] Cache hit visibly distinct and fast
- [ ] Dashboard updates ~1 s without refresh; estimates labeled
- [ ] Benchmark page verdict is data-driven
- [ ] Loading / empty / error / streaming states for every view
- [ ] Keyboard-only usage works; AA contrast in both themes
- [ ] Responsive at 360 px, 768 px, 1280 px
