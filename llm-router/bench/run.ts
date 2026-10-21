import { execSync } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { cpus, platform, release, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

interface BenchConfig {
  gateway_url: string;
  prompt_file: string;
  results_dir: string;
  request_timeout_ms: number;
  rate_limit_retry_ms: number;
  max_rate_limit_retries: number;
  hardware?: string | null;
  gpu?: string | null;
  backend_mode?: string;
  kpi_routing_accuracy_target: number;
  kpi_latency_reduction_target_pct: number;
}
interface PromptCase { id: string; category: 'simple' | 'code' | 'complex'; expected_tier: 'light' | 'code' | 'heavy'; prompt: string; duplicate_of?: string }
interface ModelInfo { name: string; tier: string }
interface MetaEvent { model: string; tier: 'light' | 'code' | 'heavy'; score: number; intent: string; cache: 'hit' | 'miss' | 'bypass'; swap_expected?: boolean }
interface Usage { prompt_tokens: number; completion_tokens: number; ttft_ms: number; total_ms: number; tokens_per_sec: number; load_ms: number }
interface ChatResult { meta: MetaEvent; usage: Usage; latency_ms: number }
interface PreviewResult { model: string; tier: 'light' | 'code' | 'heavy'; score: number; intent: string; reason: string }
type RunKey = 'A' | 'B' | 'C';
interface RequestMeasurement {
  run: RunKey;
  prompt_id: string;
  expected_tier: string;
  routed_tier: string;
  model: string;
  latency_ms: number;
  ttft_ms: number;
  tokens_per_sec: number;
  completion_tokens: number;
  load_ms: number;
  cache: string;
  swap_expected: boolean;
}
interface BenchmarkProgress {
  phase: 'previews' | 'run_A' | 'run_B' | 'run_C' | 'finalizing' | 'completed';
  phase_name: string;
  current_step: number;
  total_steps: number;
  current_prompt_id?: string;
  elapsed_ms: number;
  updated_at: string;
}

interface Checkpoint {
  id: string;
  created_at: string;
  prompt_ids: string[];
  previews: PreviewResult[];
  runs: Record<RunKey, RequestMeasurement[]>;
  wall_ms: Record<RunKey, number>;
  progress?: BenchmarkProgress;
}

const percentile = (values: number[], fraction: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)] ?? 0;
};

const scriptRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const configPath = resolve(scriptRoot, 'config/bench.yaml');
const config = parse(await readFile(configPath, 'utf8')) as BenchConfig;
const gatewayUrl = (process.env.BENCH_GATEWAY_URL ?? config.gateway_url).replace(/\/$/u, '');
const promptsPath = resolve(scriptRoot, process.env.BENCH_PROMPTS ?? config.prompt_file);
const resultsDir = resolve(scriptRoot, process.env.BENCH_RESULTS_DIR ?? config.results_dir);
const timeoutMs = Number(process.env.BENCH_TIMEOUT_MS ?? config.request_timeout_ms);
const resume = process.argv.includes('--resume') || process.env.BENCH_RESUME === 'true';
const checkpointPath = resolve(resultsDir, '.checkpoint');
const checkpointTempPath = `${checkpointPath}.tmp`;

const rawPrompts = JSON.parse(await readFile(promptsPath, 'utf8')) as PromptCase[];
const promptLimit = Math.max(0, Number(process.env.BENCH_LIMIT ?? 0));
const prompts = selectPrompts(rawPrompts, promptLimit);
if (prompts.length === 0) throw new Error(`No prompt cases found in ${promptsPath}.`);
await mkdir(resultsDir, { recursive: true });

const newCheckpoint = (): Checkpoint => ({
  id: new Date().toISOString().replace(/[:.]/gu, '-'),
  created_at: new Date().toISOString(),
  prompt_ids: prompts.map((prompt) => prompt.id),
  previews: [],
  runs: { A: [], B: [], C: [] },
  wall_ms: { A: 0, B: 0, C: 0 },
});

let checkpoint = newCheckpoint();
if (resume) {
  try {
    const saved = JSON.parse(await readFile(checkpointPath, 'utf8')) as Checkpoint;
    if (saved.prompt_ids.join('|') !== prompts.map((prompt) => prompt.id).join('|')) throw new Error('Checkpoint uses a different prompt selection.');
    checkpoint = saved;
    process.stdout.write(`Resuming benchmark ${checkpoint.id} at the next unfinished request.\n`);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    process.stdout.write('No resumable checkpoint found; starting a new benchmark.\n');
  }
}

const saveCheckpoint = async (): Promise<void> => {
  await writeFile(checkpointTempPath, JSON.stringify(checkpoint), 'utf8');
  await rename(checkpointTempPath, checkpointPath);
};
const api = (path: string): string => `${gatewayUrl}/api${path}`;
const delay = async (milliseconds: number): Promise<void> => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
const rateLimitDelay = (response: Response): number => {
  const value = response.headers.get('retry-after');
  if (value && /^\d+(?:\.\d+)?$/u.test(value)) return Math.max(1, Math.ceil(Number(value) * 1000));
  if (value) {
    const retryAt = Date.parse(value);
    if (Number.isFinite(retryAt)) return Math.max(1, retryAt - Date.now());
  }
  return config.rate_limit_retry_ms;
};
const fetchWithRateLimit = async (url: string, init: RequestInit): Promise<{ response: Response; started: number }> => {
  for (let retry = 0; ; retry += 1) {
    const started = performance.now();
    const response = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
    if (response.status !== 429 || retry >= config.max_rate_limit_retries) return { response, started };
    const waitMs = rateLimitDelay(response);
    await response.body?.cancel().catch(() => undefined);
    process.stdout.write(`Gateway rate limit reached; retrying in ${(waitMs / 1000).toFixed(1)} s.\n`);
    await delay(waitMs);
  }
};
const requestJson = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const { response } = await fetchWithRateLimit(api(path), { ...init, headers: { accept: 'application/json', 'content-type': 'application/json', ...init.headers } });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${path} returned HTTP ${response.status}${body ? `: ${body.slice(0, 400)}` : ''}`);
  }
  return await response.json() as T;
};

const benchStarted = performance.now();

const renderProgressBar = (fraction: number, width = 24): string => {
  const completed = Math.max(0, Math.min(width, Math.round(fraction * width)));
  const remaining = width - completed;
  return `[${'█'.repeat(completed)}${'░'.repeat(remaining)}] ${(fraction * 100).toFixed(1)}%`;
};

const updateProgress = async (
  phase: BenchmarkProgress['phase'],
  phaseName: string,
  currentStep: number,
  totalSteps: number,
  promptId?: string
): Promise<void> => {
  const fraction = totalSteps > 0 ? currentStep / totalSteps : 0;
  checkpoint.progress = {
    phase,
    phase_name: phaseName,
    current_step: currentStep,
    total_steps: totalSteps,
    current_prompt_id: promptId,
    elapsed_ms: performance.now() - benchStarted,
    updated_at: new Date().toISOString(),
  };
  await saveCheckpoint();

  const bar = renderProgressBar(fraction);
  const promptPart = promptId ? ` · ${promptId}` : '';
  const text = `\r\x1b[36m▶\x1b[0m \x1b[1m${phaseName}\x1b[0m ${bar} (${currentStep}/${totalSteps})${promptPart}   `;
  if (process.stdout.isTTY) {
    process.stdout.write(text);
  } else {
    if (currentStep === totalSteps || currentStep % 10 === 0 || currentStep === 1) {
      process.stdout.write(`[${phaseName}] ${currentStep}/${totalSteps} (${(fraction * 100).toFixed(0)}%)${promptPart}\n`);
    }
  }
};

const getModelRegistry = async (): Promise<ModelInfo[]> => {
  const response = await requestJson<{ models: ModelInfo[] }>('/models');
  return response.models;
};
const getPreviews = async (): Promise<PreviewResult[]> => {
  if (checkpoint.previews.length === prompts.length) return checkpoint.previews;
  const decisions: PreviewResult[] = [...checkpoint.previews];
  process.stdout.write('\n\x1b[35m=== Phase 0/3: Routing Previews (Classifier Accuracy) ===\x1b[0m\n');
  for (let i = decisions.length; i < prompts.length; i += 1) {
    const prompt = prompts[i];
    if (!prompt) continue;
    await updateProgress('previews', 'Classification Previews', i + 1, prompts.length, prompt.id);
    const decision = await requestJson<PreviewResult>('/route/preview', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: prompt.prompt }], mode: 'auto' }) });
    decisions.push(decision);
    checkpoint.previews = decisions;
  }
  if (process.stdout.isTTY) process.stdout.write('\n');
  return decisions;
};

const parseFrame = (frame: string): { event: string; data: string } | null => {
  let event = 'message';
  const data: string[] = [];
  for (const line of frame.replace(/\r\n/gu, '\n').split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /u, '');
    if (field === 'event') event = value;
    if (field === 'data') data.push(value);
  }
  return data.length ? { event, data: data.join('\n') } : null;
};

const invokeChat = async (prompt: PromptCase, run: RunKey, model: string | undefined, useCache: boolean): Promise<ChatResult> => {
  const requestBody = {
    messages: [{ role: 'user', content: prompt.prompt }],
    mode: model ? 'force' : 'auto',
    ...(model ? { model } : {}),
    options: { temperature: 0.2, top_p: 0.9, num_ctx: 4096 },
    use_cache: useCache,
  };
  const { response, started } = await fetchWithRateLimit(api('/chat'), {
    method: 'POST', headers: { accept: 'text/event-stream', 'content-type': 'application/json' },
    body: JSON.stringify(requestBody),
  });
  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => '');
    throw new Error(`${run}/${prompt.id} chat returned HTTP ${response.status}${body ? `: ${body.slice(0, 400)}` : ''}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let meta: MetaEvent | undefined;
  let usage: Usage | undefined;
  let streamError: { code?: string; message?: string } | undefined;
  const dispatch = (text: string): void => {
    const frame = parseFrame(text);
    if (!frame) return;
    try {
      const payload = JSON.parse(frame.data) as unknown;
      if (frame.event === 'meta') meta = payload as MetaEvent;
      if (frame.event === 'done') usage = (payload as { usage: Usage }).usage;
      if (frame.event === 'error') streamError = payload as { code?: string; message?: string };
    } catch {
      throw new Error(`Invalid SSE JSON in ${run}/${prompt.id}.`);
    }
  };
  try {
    while (!usage && !streamError) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let match = buffer.match(/\r?\n\r?\n/u);
      while (match?.index !== undefined) {
        const boundary = match.index;
        const separatorLength = buffer.slice(boundary).startsWith('\r\n\r\n') ? 4 : 2;
        dispatch(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + separatorLength);
        if (usage || streamError) break;
        match = buffer.match(/\r?\n\r?\n/u);
      }
      if (done) { if (buffer.trim()) dispatch(buffer); break; }
    }
  } finally {
    if (streamError || usage) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (streamError) throw new Error(`${run}/${prompt.id} ${streamError.code ?? 'stream error'}: ${streamError.message ?? 'No error message.'}`);
  if (!meta || !usage) throw new Error(`${run}/${prompt.id} stream ended without both meta and done events.`);
  return { meta, usage, latency_ms: performance.now() - started };
};

const flushCache = async (): Promise<void> => {
  await requestJson<{ ok: boolean; removed: number }>('/cache/flush', { method: 'POST' });
};
const warmHeavy = async (heavyModel: string): Promise<void> => {
  const warmup: PromptCase = { id: 'warmup', category: 'simple', expected_tier: 'heavy', prompt: 'Benchmark warm-up request. Return a brief acknowledgement.' };
  await invokeChat(warmup, 'A', heavyModel, false);
};

const toMeasurement = (prompt: PromptCase, run: RunKey, result: ChatResult): RequestMeasurement => ({
  run, prompt_id: prompt.id, expected_tier: prompt.expected_tier, routed_tier: result.meta.tier,
  model: result.meta.model, latency_ms: result.latency_ms, ttft_ms: result.usage.ttft_ms,
  tokens_per_sec: result.usage.tokens_per_sec, completion_tokens: result.usage.completion_tokens,
  load_ms: result.usage.load_ms, cache: result.meta.cache, swap_expected: result.meta.swap_expected ?? false,
});

const runGroup = async (run: RunKey, cases: PromptCase[], heavyModel: string, auto: boolean): Promise<void> => {
  const current = checkpoint.runs[run];
  const phaseKey: BenchmarkProgress['phase'] = run === 'A' ? 'run_A' : run === 'B' ? 'run_B' : 'run_C';
  const phaseTitle = run === 'A' ? 'Run A: Heavy Baseline' : run === 'B' ? 'Run B: Automatic Router' : 'Run C: Router + Cache';
  if (current.length >= cases.length) {
    process.stdout.write(`\x1b[32m✔\x1b[0m ${phaseTitle}: already complete (${current.length}/${cases.length} requests).\n`);
    return;
  }
  process.stdout.write(`\n\x1b[35m=== ${phaseTitle} ===\x1b[0m\n`);
  process.stdout.write(`  Configuration: ${run === 'A' ? 'forced heavy model, no cache' : run === 'B' ? 'dynamic router, no cache' : 'dynamic router, cache enabled (2 passes)'}\n`);
  process.stdout.write('  Preparing environment: flushing cache and warming model...\n');
  await flushCache();
  await warmHeavy(heavyModel);
  process.stdout.write('  Warmup complete. Executing benchmark requests:\n');

  for (let index = current.length; index < cases.length; index += 1) {
    const prompt = cases[index];
    if (!prompt) continue;
    await updateProgress(phaseKey, phaseTitle, index + 1, cases.length, prompt.id);
    const started = performance.now();
    const result = await invokeChat(prompt, run, auto ? undefined : heavyModel, run === 'C');
    const measurement = toMeasurement(prompt, run, result);
    current.push(measurement);
    checkpoint.wall_ms[run] += performance.now() - started;
  }
  if (process.stdout.isTTY) process.stdout.write('\n');
};

const aggregate = (run: RunKey, accuracy?: number) => {
  const entries = checkpoint.runs[run];
  const durations = entries.map((entry) => entry.latency_ms);
  const ttfts = entries.map((entry) => entry.ttft_ms);
  const speeds = entries.map((entry) => entry.tokens_per_sec).filter(Number.isFinite);
  const hitCount = entries.filter((entry) => entry.cache === 'hit').length;
  const mean = (items: number[]): number => items.length ? items.reduce((sum, value) => sum + value, 0) / items.length : 0;
  return {
    mean_ms: mean(durations),
    p50_ms: percentile(durations, 0.5),
    p95_ms: percentile(durations, 0.95),
    ttft_mean_ms: mean(ttfts),
    tokens_per_sec: mean(speeds),
    swaps: entries.filter((entry) => entry.cache !== 'hit' && entry.load_ms > 0).length,
    cache_hit_rate: entries.length ? hitCount / entries.length : 0,
    ...(accuracy !== undefined ? { accuracy } : {}),
    total_wall_ms: checkpoint.wall_ms[run],
  };
};

function selectPrompts(all: PromptCase[], limit: number): PromptCase[] {
  if (!Number.isFinite(limit) || limit <= 0 || limit >= all.length) return all;
  const unique = all.filter((prompt) => !prompt.duplicate_of);
  const categories: PromptCase['category'][] = ['simple', 'code', 'complex'];
  const selected: PromptCase[] = [];
  let index = 0;
  while (selected.length < limit && selected.length < unique.length) {
    const category = categories[index % categories.length];
    const sameCategory = unique.filter((prompt) => prompt.category === category);
    const categoryIndex = Math.floor(index / categories.length);
    const candidate = sameCategory[categoryIndex];
    if (candidate) selected.push(candidate);
    index += 1;
  }
  return selected;
}

const registry = await getModelRegistry();
const heavyModel = registry.find((model) => model.tier === 'heavy')?.name;
if (!heavyModel) throw new Error('No model is configured for the heavy tier.');
const previews = await getPreviews();
const accuracy = previews.length ? previews.filter((preview, index) => preview.tier === prompts[index]?.expected_tier).length / previews.length : 0;
const confusion: Record<string, Record<string, number>> = Object.fromEntries(['light', 'code', 'heavy'].map((tier) => [tier, { light: 0, code: 0, heavy: 0 }]));
for (const [index, preview] of previews.entries()) {
  const expected = prompts[index]?.expected_tier;
  if (expected && confusion[expected]?.[preview.tier] !== undefined) confusion[expected][preview.tier] += 1;
}

await runGroup('A', prompts, heavyModel, false);
await runGroup('B', prompts, heavyModel, true);
await runGroup('C', [...prompts, ...prompts], heavyModel, true);

const health = await requestJson<{ services?: Record<string, { detail?: string }> }>('/health').catch((): { services?: Record<string, { detail?: string }> } => ({}));
const detectedMock = Object.values(health.services ?? {}).some((service) => (service.detail ?? '').toLowerCase().includes('mock'));
const backendOverride = process.env.BENCH_BACKEND;
const backend = backendOverride && backendOverride !== 'auto' ? backendOverride : detectedMock ? 'mock backend (not model-hardware inference)' : config.backend_mode ?? 'Ollama local inference';
const cpu = cpus()[0]?.model ?? 'CPU not detected';
let detectedGpu: string | null = null;
try {
  const smi = execSync('nvidia-smi --query-gpu=gpu_name --format=csv,noheader', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (smi) detectedGpu = smi;
} catch {}
const gpuInfo = process.env.BENCH_GPU || config.gpu || detectedGpu;
const hardware = process.env.BENCH_HARDWARE || config.hardware || `${platform()} ${process.arch}; ${cpu}; ${(totalmem() / 1_000_000_000).toFixed(1)} GB RAM${gpuInfo ? `; GPU: ${gpuInfo}` : '; GPU: not detected'}`;
const runA = aggregate('A');
const runB = aggregate('B', accuracy);
const runC = aggregate('C', accuracy);
const improvement = runA.mean_ms > 0 ? (runA.mean_ms - runB.mean_ms) / runA.mean_ms * 100 : 0;
const latencyTarget = config.kpi_latency_reduction_target_pct;
const accuracyTarget = config.kpi_routing_accuracy_target;
const verdict = `Router ${improvement >= 0 ? 'reduced' : 'increased'} mean latency by ${Math.abs(improvement).toFixed(1)}% vs heavy-only${improvement >= latencyTarget ? ` (KPI-2 target of ${latencyTarget}% met)` : ` (KPI-2 target of ${latencyTarget}% lower not met)`}.`;
const methodology = [
  `Backend: ${backend}.`,
  'Order: deterministic prompt-file order; A = forced heavy/no-cache, B = auto/no-cache, C = auto/cache-on over two full passes.',
  'Warm-up: before each run, one unmeasured forced-heavy request is completed; identical prompt and sampling settings are used.',
  'Cache is flushed before each run; for C it remains enabled for both passes. Cache results include labeled duplicate prompts.',
  'Latency is measured at the gateway from the successful request attempt through terminal SSE event; rate-limit backoff is excluded from per-request latency but included in total wall time. Router TTFT/tokens-per-second are reported from final usage metadata.',
  'Swap count is a proxy for non-cache-hit inference requests with positive final-chunk load_ms; it is not an independent hardware swap counter.',
  'Routing accuracy and confusion matrix use the dry-run preview endpoint and expected tiers in prompts.json; this is not answer-quality evaluation.',
  'GPU/VRAM values are omitted when the stats contract reports them as unavailable. Mock-backend measurements are for smoke testing only and are not hardware performance claims.',
].join(' ');
const result = {
  id: checkpoint.id,
  created_at: new Date().toISOString(),
  hardware,
  prompt_count: prompts.length,
  methodology,
  verdict,
  runs: { A: runA, B: runB, C: runC },
  per_request: checkpoint.runs.A.concat(checkpoint.runs.B, checkpoint.runs.C),
  confusion_matrix: confusion,
  kpis: {
    KPI1_routing_accuracy: accuracy,
    KPI1_target: accuracyTarget,
    KPI1_pass: accuracy >= accuracyTarget,
    KPI2_router_mean_latency_reduction_pct: improvement,
    KPI2_target: latencyTarget,
    KPI2_pass: improvement >= latencyTarget,
    KPI3_cache_hit_rate_C: runC.cache_hit_rate,
    KPI4_router_overhead_p95_ms: null,
    KPI5_swaps_v2_vs_v1: null,
    note: 'Only KPI-1 and the A/B latency comparison are measured by this harness; other KPIs require their dedicated instrumentation and comparison run.',
  },
};
await updateProgress('finalizing', 'Finalizing Results', 1, 1);
const outputPath = resolve(resultsDir, `${checkpoint.id}.json`);
const tempPath = `${outputPath}.tmp`;
await writeFile(tempPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
await rename(tempPath, outputPath);
await rm(checkpointPath, { force: true });
process.stdout.write(`\n\x1b[32m✔ Benchmark complete:\x1b[0m ${outputPath}\n`);
process.stdout.write(`  Routing Accuracy: \x1b[1m${(accuracy * 100).toFixed(1)}%\x1b[0m\n`);
process.stdout.write(`  Mean Latency: Run A \x1b[1m${runA.mean_ms.toFixed(0)} ms\x1b[0m vs Run B \x1b[1m${runB.mean_ms.toFixed(0)} ms\x1b[0m (${improvement >= 0 ? `${improvement.toFixed(1)}% faster` : `${Math.abs(improvement).toFixed(1)}% slower`})\n`);
process.stdout.write(`  Cache Hit Rate (Run C): \x1b[1m${(runC.cache_hit_rate * 100).toFixed(1)}%\x1b[0m\n`);
process.stdout.write(`  Verdict: ${verdict}\n\n`);
