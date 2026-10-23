import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const modelsFile = process.env.MODELS_CONFIG ?? resolve(root, 'config/models.yaml');
const routingFile = process.env.ROUTING_CONFIG ?? resolve(root, 'config/routing.yaml');
const [modelsConfig, routingConfig] = await Promise.all([
  readFile(modelsFile, 'utf8').then(parse),
  readFile(routingFile, 'utf8').then(parse),
]);
const models = modelsConfig.models;
const classifier = routingConfig.classifier;
const policy = routingConfig.routing;
if (!Array.isArray(models) || models.length < 3 || !classifier || !policy) throw new Error('Invalid model/routing configuration.');

const modelByTier = new Map(models.map((model) => [model.tier, model]));
const modelByName = new Map(models.map((model) => [model.name, model]));
const cache = new Map();
const decisions = [];
const latencySamples = [];
const counts = new Map();
let cacheHits = 0;
let cacheMisses = 0;
let swaps = 0;
let loadedModel = process.env.MOCK_ROUTER_LOADED_MODEL ?? null;

const json = (response, status, data) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(data));
};
const readJson = async (request) => {
  let text = '';
  for await (const chunk of request) {
    text += chunk.toString();
    if (Buffer.byteLength(text) > 65_536) throw new Error('request too large');
  }
  return JSON.parse(text);
};
const clamp = (number, min = 0, max = 100) => Math.max(min, Math.min(max, number));
const latestUser = (messages) => [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
const containsTerm = (text, term) => {
  if (/[\s]|[^\p{L}\p{N}_]/u.test(term)) return text.includes(term);
  return text.split(/[^\p{L}\p{N}_+#]+/u).some((candidate) => candidate === term);
};
const isStructuredLine = (line) => {
  const trimmed = line.trimStart();
  if (['- ', '* ', '• '].some((prefix) => trimmed.startsWith(prefix))) return true;
  const digits = trimmed.match(/^\d+/u)?.[0].length ?? 0;
  if (digits === 0) return false;
  const rest = trimmed.slice(digits);
  return rest.startsWith('. ') || rest.startsWith(') ');
};

const classify = (messages) => {
  const prompt = [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
  const text = prompt.toLowerCase();
  const wordCount = prompt.split(/\s+/u).filter(Boolean).length;
  const estimatedTokens = Math.max(1, Math.ceil([...prompt].length / 4));
  const length = clamp(estimatedTokens / Math.max(1, classifier.length_saturation_tokens) * 100);
  const reasoningHits = classifier.reasoning_keywords.filter((keyword) => containsTerm(text, keyword)).length;
  const reasoning = Math.min(100, reasoningHits * 40 + (reasoningHits > 0 ? 15 : 0));
  const questionCount = (prompt.match(/\?/gu) ?? []).length;
  const numbered = prompt.split(/\r?\n/u).filter(isStructuredLine).length;
  const structure = Math.min(100, questionCount * 14 + numbered * 20 + (prompt.includes('\n') ? 8 : 0));
  const totalContextChars = messages.reduce((sum, message) => sum + [...message.content].length, 0);
  const context = Math.min(100, Math.max(0, (messages.length - 1) * 18 + totalContextChars / 60));
  const singleTurn = messages.length === 1;
  const simplePattern = singleTurn && classifier.simple_patterns.some((source) => {
    try { return new RegExp(source).test(prompt.trim()); } catch { return false; }
  });
  const simplicity = simplePattern || (singleTurn && wordCount <= 3) ? 100 : singleTurn && wordCount <= 8 && reasoningHits === 0 ? 55 : 0;
  const weights = classifier.weights;
  const score = Math.round(clamp(length * weights.length + reasoning * weights.reasoning + structure * weights.structure + context * weights.context - simplicity * classifier.simplicity_penalty));
  const codeSignal = classifier.code_keywords.some((keyword) => containsTerm(text, keyword))
    || prompt.includes('```') || text.includes('traceback') || text.includes('stack trace');
  const intent = codeSignal ? 'code' : reasoningHits > 0 || score >= classifier.reasoning_min_score ? 'reasoning' : 'chat';
  return { score, intent, promptTokens: estimatedTokens };
};

const decide = (messages, mode = 'auto', forcedModel = undefined) => {
  const classification = classify(messages);
  if (mode === 'force') {
    const forced = modelByName.get(forcedModel);
    if (!forced) return { error: true, classification };
    return { model: forced, ...classification, reason: 'forced model override', swapExpected: Boolean(loadedModel && loadedModel !== forced.name) };
  }
  let tier = classification.intent === 'code'
    ? 'code'
    : classification.score < policy.light_max_score ? 'light'
      : classification.score >= policy.heavy_min_score ? 'heavy' : 'code';
  let model = modelByTier.get(tier);
  let reason = classification.intent === 'code'
    ? 'code keywords or programming syntax'
    : classification.score < policy.light_max_score ? 'short, low-complexity request'
      : classification.score >= policy.heavy_min_score ? 'multi-step reasoning or complex request'
        : 'moderate request complexity';
  const nearestBoundary = Math.min(Math.abs(classification.score - policy.light_max_score), Math.abs(classification.score - policy.heavy_min_score));
  if (loadedModel && model?.name !== loadedModel && nearestBoundary <= policy.warm_stickiness_margin && classification.intent !== 'code') {
    const warm = modelByName.get(loadedModel);
    if (warm) {
      model = warm;
      tier = warm.tier;
      reason += '; kept warm model to avoid a swap';
    }
  }
  if (!model) throw new Error(`No configured model for tier ${tier}`);
  return { model, ...classification, reason, swapExpected: Boolean(loadedModel && loadedModel !== model.name) };
};

const cacheKeyFor = (payload) => {
  const messages = payload.messages.map((message) => `${message.role}:${message.content.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase()}`).join('\n');
  const options = payload.options ?? {};
  return createHash('sha256').update(`${messages}\0${options.temperature ?? 0.2}\0${options.top_p ?? 0.9}\0${options.num_ctx ?? 4096}`).digest('hex');
};
const sse = (response, event, data) => response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
const tokensFor = (text) => {
  const words = text.match(/\S+\s*/gu) ?? [];
  return words.length > 0 ? words : [text];
};
const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
const maybeWrite = (response, event, data, disconnected) => {
  if (disconnected()) return false;
  return sse(response, event, data);
};
const recordDecision = (decision, cacheStatus, latencyMs) => {
  const row = {
    id: randomUUID(), timestamp: new Date().toISOString(), model: decision.model.name,
    tier: decision.model.tier, score: decision.score, intent: decision.intent,
    reason: decision.reason, latency_ms: latencyMs, cache: cacheStatus,
  };
  decisions.unshift(row);
  decisions.length = Math.min(decisions.length, 50);
  latencySamples.push({ model: decision.model.name, tier: decision.model.tier, latency: latencyMs });
  if (latencySamples.length > 500) latencySamples.shift();
  counts.set(decision.model.name, (counts.get(decision.model.name) ?? 0) + 1);
};

const statsSnapshot = () => {
  const total = decisions.length;
  const modelRows = [...new Set(latencySamples.map((sample) => sample.model))].map((name) => {
    const samples = latencySamples.filter((sample) => sample.model === name).map((sample) => sample.latency).sort((a, b) => a - b);
    const model = modelByName.get(name);
    const average = samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length);
    return { model: name, tier: model?.tier ?? 'light', count: counts.get(name) ?? samples.length, avg_latency_ms: Math.round(average), p95_latency_ms: Math.round(samples[Math.floor(Math.max(0, samples.length - 1) * 0.95)] ?? average) };
  });
  const avgLatency = latencySamples.reduce((sum, sample) => sum + sample.latency, 0) / Math.max(1, latencySamples.length);
  const estimatedHeavyMs = total ? (avgLatency + 300) * 1.55 : 0;
  const savedMs = Math.max(0, estimatedHeavyMs - avgLatency);
  return {
    timestamp: new Date().toISOString(), window_seconds: policy.stats_window_seconds,
    requests_total: total, avg_latency_ms: Math.round(avgLatency),
    cache: { hits: cacheHits, misses: cacheMisses, hit_rate: cacheHits + cacheMisses ? cacheHits / (cacheHits + cacheMisses) : 0 },
    swaps, by_model: modelRows, recent: decisions.slice(0, 20),
    queue_depth: Object.fromEntries(models.map((model) => [model.name, 0])), loaded_model: loadedModel,
    gpu: { vram_used_bytes: null, vram_total_bytes: null, utilization_pct: null },
    estimated_savings: { basis: 'calibrated-estimate', time_ms: Math.round(savedMs), pct_vs_heavy_only: estimatedHeavyMs ? Math.round(savedMs / estimatedHeavyMs * 100) : 0 },
  };
};

const handleChat = async (request, response, payload, requestId) => {
  if (!Array.isArray(payload.messages) || payload.messages.length < 1 || payload.messages.length > 50) {
    json(response, 400, { error: { code: 'INVALID_REQUEST', message: 'messages must contain 1 to 50 items.', request_id: requestId } });
    return;
  }
  const totalBytes = payload.messages.reduce((sum, message) => sum + Buffer.byteLength(String(message.content ?? '')), 0);
  if (totalBytes > 32_768) {
    json(response, 400, { error: { code: 'INVALID_REQUEST', message: 'Message content exceeds the 32 KB limit.', request_id: requestId } });
    return;
  }
  const useCache = payload.use_cache !== false && Number(payload.options?.temperature ?? 0.2) <= policy.cache_max_temperature;
  const key = cacheKeyFor(payload);
  let cacheStatus = payload.use_cache === false ? 'bypass' : 'miss';
  const cached = useCache ? cache.get(key) : undefined;
  if (cached) {
    cacheHits += 1;
    cacheStatus = 'hit';
  } else if (useCache) {
    cacheMisses += 1;
  }

  const decision = cached?.decision ?? decide(payload.messages, payload.mode ?? 'auto', payload.model);
  if (decision.error) {
    json(response, 404, { error: { code: 'MODEL_NOT_FOUND', message: 'Requested model is not configured.', request_id: requestId } });
    return;
  }

  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no', 'x-request-id': requestId,
  });
  response.flushHeaders();
  let disconnected = false;
  response.on('close', () => { disconnected = true; });
  request.on('aborted', () => { disconnected = true; });
  const requestStarted = Date.now();
  let activeDecision = decision;
  const meta = {
    request_id: requestId, model: decision.model.name, tier: decision.model.tier,
    score: decision.score, intent: decision.intent, reason: decision.reason,
    cache: cacheStatus, swap_expected: decision.swapExpected,
  };
  sse(response, 'meta', meta);
  const failModels = new Set((process.env.MOCK_ROUTER_FAIL_MODELS ?? '').split(',').map((item) => item.trim()).filter(Boolean));
  if (!cached && failModels.has(decision.model.name) && policy.fallback_enabled) {
    const fallback = modelByName.get(decision.model.fallback);
    if (fallback) {
      await wait(Number(process.env.MOCK_ROUTER_FIRST_TOKEN_MS ?? 450));
      activeDecision = { ...decision, model: fallback, reason: `${decision.reason}; fell back after mock model failure`, swapExpected: Boolean(loadedModel && loadedModel !== fallback.name) };
      sse(response, 'meta', {
        request_id: requestId, model: fallback.name, tier: fallback.tier, score: decision.score, intent: decision.intent,
        reason: activeDecision.reason, cache: cacheStatus, swap_expected: activeDecision.swapExpected, fallback_from: decision.model.name,
      });
    }
  }

  const answer = cached?.text ?? (() => {
    const prompt = latestUser(payload.messages).trim();
    if (/^(hi|hello|hey)[!. ]*$/i.test(prompt)) return `Hello! I’m the local LLM Router demo. Your request was routed to ${activeDecision.model.name}, and the answer is streaming through the API stack.`;
    if (activeDecision.intent === 'code') return `Here’s a concise starting point from **${activeDecision.model.name}**.\n\n\`\`\`python\ndef solve(items):\n    """Replace this example with the logic your task needs."""\n    return [item for item in items if item is not None]\n\`\`\`\n\nThe router selected the code tier because the request contains programming signals. In a real deployment, this text comes from your local Ollama model.`;
    return `This local demo response was generated for your request using **${activeDecision.model.name}**. The router selected the ${activeDecision.model.tier} tier because the prompt’s complexity score was ${activeDecision.score}/100.\n\nConnect Ollama to replace this deterministic demonstration with local model inference. Your prompt stays on your machine.`;
  })();
  const tokenDelay = Number(process.env.MOCK_ROUTER_TOKEN_DELAY_MS ?? 18);
  const startDelay = Number(process.env.MOCK_ROUTER_FIRST_TOKEN_MS ?? 350);
  if (!cached && startDelay > 0) await wait(startDelay);
  let completionTokens = 0;
  for (const text of tokensFor(answer)) {
    if (disconnected) return;
    if (!maybeWrite(response, 'token', { text }, () => disconnected)) return;
    completionTokens += Math.max(1, Math.ceil(text.length / 4));
    if (!cached && tokenDelay > 0) await wait(tokenDelay);
  }
  if (disconnected) return;
  const elapsed = Math.max(1, Date.now() - requestStarted);
  if (!loadedModel || loadedModel !== activeDecision.model.name) swaps += loadedModel ? 1 : 0;
  loadedModel = activeDecision.model.name;
  const usage = cached?.usage ?? {
    prompt_tokens: decision.promptTokens, completion_tokens: completionTokens,
    ttft_ms: cached ? 4 : startDelay, total_ms: elapsed,
    tokens_per_sec: completionTokens / Math.max(0.001, elapsed / 1000), load_ms: decision.swapExpected ? 250 : 0,
  };
  const fullDecision = { ...activeDecision };
  recordDecision(fullDecision, cacheStatus, elapsed);
  if (useCache && !cached && !disconnected) cache.set(key, { text: answer, decision: fullDecision, usage });
  sse(response, 'done', { request_id: requestId, usage });
  response.end();
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const requestId = request.headers['x-request-id'] && /^[0-9a-f-]{36}$/i.test(String(request.headers['x-request-id']))
    ? String(request.headers['x-request-id']) : randomUUID();
  if (request.method === 'GET' && url.pathname === '/healthz') {
    json(response, 200, { status: 'healthy', services: { router: { status: 'healthy' }, ollama: { status: 'healthy', detail: 'Mock router backend' }, redis: { status: 'healthy', detail: 'In-memory development cache' } } });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/v1/models') {
    json(response, 200, { models: models.map((model) => ({ ...model, available: true, loaded: model.name === loadedModel, timeout_ms: model.timeout_ms, size_bytes: model.size_bytes ?? null, size_vram_bytes: model.name === loadedModel ? 900_000_000 : null })) });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/v1/stats') {
    json(response, 200, statsSnapshot());
    return;
  }
  if (request.method === 'GET' && url.pathname === '/metrics') {
    response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
    response.end(`# HELP llmr_requests_total Total completed mock-router requests.\n# TYPE llmr_requests_total counter\nllmr_requests_total ${decisions.length}\n# HELP llmr_cache_hits_total Cache hits.\n# TYPE llmr_cache_hits_total counter\nllmr_cache_hits_total ${cacheHits}\n# HELP llmr_model_swaps_total Model swaps.\n# TYPE llmr_model_swaps_total counter\nllmr_model_swaps_total ${swaps}\n`);
    return;
  }
  if (request.method === 'POST' && url.pathname === '/v1/cache/flush') {
    const removed = cache.size;
    cache.clear();
    json(response, 200, { ok: true, removed });
    return;
  }
  if (request.method === 'POST' && (url.pathname === '/v1/route/preview' || url.pathname === '/v1/route/chat')) {
    let payload;
    try { payload = await readJson(request); } catch {
      json(response, 400, { error: { code: 'INVALID_REQUEST', message: 'Invalid or oversized JSON body.', request_id: requestId } });
      return;
    }
    if (url.pathname === '/v1/route/preview') {
      if (!Array.isArray(payload.messages) || payload.messages.length < 1) {
        json(response, 400, { error: { code: 'INVALID_REQUEST', message: 'messages is required.', request_id: requestId } });
        return;
      }
      const decision = decide(payload.messages, payload.mode ?? 'auto', payload.model);
      if (decision.error) {
        json(response, 404, { error: { code: 'MODEL_NOT_FOUND', message: 'Requested model is not configured.', request_id: requestId } });
        return;
      }
      json(response, 200, { model: decision.model.name, tier: decision.model.tier, score: decision.score, intent: decision.intent, reason: decision.reason, swap_expected: decision.swapExpected, fallback: decision.model.fallback ?? null, queue_depth: 0 });
      return;
    }
    await handleChat(request, response, payload, requestId);
    return;
  }
  json(response, 404, { error: { code: 'INVALID_REQUEST', message: 'Endpoint not found.', request_id: requestId } });
});

const port = Number(process.env.ROUTER_PORT ?? 8081);
server.listen(port, process.env.ROUTER_HOST ?? '0.0.0.0', () => process.stdout.write(`mock-router listening on ${port}\n`));
