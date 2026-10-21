import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parse } from 'yaml';

const modelConfigPath = process.env.MODELS_CONFIG ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../config/models.yaml');
const modelRegistry = parse(await readFile(modelConfigPath, 'utf8'));
const configuredModelNames = Array.isArray(modelRegistry.models) ? modelRegistry.models.map((model) => model.name) : [];
const modelOverride = process.env.MOCK_OLLAMA_MODELS?.trim();
const modelNames = (modelOverride || configuredModelNames.join(',')).split(',').map((name) => name.trim()).filter(Boolean);

const json = (response, status, value) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
};

const parseEnvNumber = (key, fallback) => {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

const tokenize = (text) => text.match(/\S+\s*/gu) ?? [];

const responseFor = (model, prompt) => {
  const normalized = prompt.trim().toLowerCase();
  if (/^(hi|hello|hey)[!. ]*$/.test(normalized)) return `Hello! I’m a local mock response from ${model}.`;
  if (/\b(python|function|code|debug|stack trace|sql)\b/.test(normalized)) {
    return `Here’s a concise mock answer from ${model}:\n\n\`\`\`python\ndef solve(items):\n    """Replace this mock implementation with model output."""\n    return list(items)\n\`\`\`\n\nThe local test double is streaming this response; no remote model is called.`;
  }
  return `Mock response from ${model}: I’ve received your request and generated this deterministic local answer. The Ollama-compatible test server is working, so you can exercise routing, streaming, cancellation, caching, and the dashboard without a GPU.`;
};

export const createMockOllamaServer = () => {
  let loadedModel = process.env.MOCK_OLLAMA_LOADED_MODEL ?? '';
  let lastLoadDuration = 0;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/api/tags') {
      json(response, 200, { models: modelNames.map((name) => ({ name, model: name, modified_at: new Date().toISOString(), size: 1_000_000_000, digest: 'mock' })) });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/ps') {
      json(response, 200, { models: loadedModel ? [{ name: loadedModel, model: loadedModel, size: 1_000_000_000, size_vram: 900_000_000, expires_at: new Date(Date.now() + 600_000).toISOString() }] : [] });
      return;
    }
    if (request.method !== 'POST' || url.pathname !== '/api/chat') {
      json(response, 404, { error: 'not found' });
      return;
    }

    let bodyText = '';
    for await (const chunk of request) bodyText += chunk.toString();
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      json(response, 400, { error: 'invalid JSON' });
      return;
    }
    const model = typeof body.model === 'string' ? body.model : '';
    if (!model) {
      json(response, 400, { error: 'model is required' });
      return;
    }
    const failedModels = new Set((process.env.MOCK_OLLAMA_FAIL_MODELS ?? '').split(',').map((item) => item.trim()).filter(Boolean));
    if (failedModels.has(model)) {
      const status = process.env.MOCK_OLLAMA_FAIL_MODE === '404' ? 404 : 500;
      json(response, status, { error: 'injected mock model failure' });
      return;
    }
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const prompt = messages.map((message) => typeof message?.content === 'string' ? message.content : '').join('\n');
    const output = responseFor(model, prompt);
    const tokens = tokenize(output);
    const delayMap = (() => {
      try { return JSON.parse(process.env.MOCK_OLLAMA_DELAY_MAP ?? '{}'); } catch { return {}; }
    })();
    const startupDelay = Number(delayMap[model] ?? parseEnvNumber('MOCK_OLLAMA_DELAY_MS', 0));
    const tokenDelay = parseEnvNumber('MOCK_OLLAMA_TOKEN_DELAY_MS', 15);
    const loadDuration = loadedModel === model ? 0 : parseEnvNumber('MOCK_OLLAMA_LOAD_DELAY_MS', 250);
    loadedModel = model;
    lastLoadDuration = loadDuration;
    const started = process.hrtime.bigint();
    const promptTokens = Math.max(1, Math.ceil(prompt.length / 4));
    const createdAt = new Date().toISOString();

    if (body.stream === false) {
      json(response, 200, {
        model,
        created_at: createdAt,
        message: { role: 'assistant', content: output },
        done: true,
        total_duration: Number(startupDelay + loadDuration + tokens.length * tokenDelay) * 1_000_000,
        load_duration: loadDuration * 1_000_000,
        prompt_eval_count: promptTokens,
        prompt_eval_duration: 5_000_000,
        eval_count: tokens.length,
        eval_duration: Math.max(1, tokens.length * tokenDelay) * 1_000_000,
      });
      return;
    }

    response.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
    response.flushHeaders();
    let cancelled = false;
    response.on('close', () => { cancelled = true; });
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    if (startupDelay > 0) await wait(startupDelay);
    for (const token of tokens) {
      if (cancelled) return;
      response.write(`${JSON.stringify({ model, created_at: createdAt, message: { role: 'assistant', content: token }, done: false })}\n`);
      if (tokenDelay > 0) await wait(tokenDelay);
    }
    if (cancelled) return;
    const elapsedNs = Number(process.hrtime.bigint() - started);
    response.write(`${JSON.stringify({
      model,
      created_at: createdAt,
      done: true,
      total_duration: elapsedNs + loadDuration * 1_000_000,
      load_duration: loadDuration * 1_000_000,
      prompt_eval_count: promptTokens,
      prompt_eval_duration: 5_000_000,
      eval_count: tokens.length,
      eval_duration: Math.max(1, tokens.length * tokenDelay) * 1_000_000,
    })}\n`);
    response.end();
  });
  server.lastLoadDuration = () => lastLoadDuration;
  return server;
};

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const port = parseEnvNumber('MOCK_OLLAMA_PORT', 11434);
  const server = createMockOllamaServer();
  server.listen(port, process.env.MOCK_OLLAMA_HOST ?? '0.0.0.0', () => {
    process.stdout.write(`mock-ollama listening on ${port} (instance ${randomUUID().slice(0, 8)})\n`);
  });
}
