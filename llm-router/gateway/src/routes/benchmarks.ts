import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Router } from 'express';
import { asyncHandler } from '../middleware/async-handler.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

export const benchmarkRoutes = Router();
let benchmarkRunning = false;

benchmarkRoutes.get('/benchmark/results', asyncHandler(async (_req, res) => {
  const projectRoot = resolve(process.cwd(), config.PROJECT_ROOT);
  const resultsDir = resolve(projectRoot, config.BENCH_RESULTS_DIR);
  let entries: string[];
  try {
    entries = (await readdir(resultsDir)).filter((name) => name.endsWith('.json')).sort().reverse();
  } catch {
    res.json({ results: [] });
    return;
  }
  const results: unknown[] = [];
  for (const entry of entries.slice(0, 50)) {
    try {
      const content = await readFile(resolve(resultsDir, entry), 'utf8');
      results.push(JSON.parse(content) as unknown);
    } catch (error) {
      logger.warn({ err: error, file: entry }, 'skipping invalid benchmark result');
    }
  }
  res.json({ results });
}));

benchmarkRoutes.get('/benchmark/status', asyncHandler(async (_req, res) => {
  const projectRoot = resolve(process.cwd(), config.PROJECT_ROOT);
  const resultsDir = resolve(projectRoot, config.BENCH_RESULTS_DIR);
  const checkpointPath = resolve(resultsDir, '.checkpoint');
  let progress: unknown = null;
  let checkpointMeta: { id?: string; created_at?: string; prompt_count?: number } | null = null;

  try {
    const raw = await readFile(checkpointPath, 'utf8');
    const cp = JSON.parse(raw) as { id?: string; created_at?: string; prompt_ids?: string[]; progress?: unknown };
    checkpointMeta = {};
    if (typeof cp.id === 'string') checkpointMeta.id = cp.id;
    if (typeof cp.created_at === 'string') checkpointMeta.created_at = cp.created_at;
    if (Array.isArray(cp.prompt_ids)) checkpointMeta.prompt_count = cp.prompt_ids.length;
    progress = cp.progress ?? null;
  } catch {
    // No checkpoint file or currently unreadable
  }

  res.json({
    running: benchmarkRunning,
    progress,
    checkpoint: checkpointMeta,
  });
}));

benchmarkRoutes.post('/benchmark/run', (_req, res) => {
  if (config.BENCHMARK_ENABLED !== 'true') {
    res.status(503).json({ error: { code: 'INTERNAL', message: 'Benchmark execution is disabled.', request_id: _req.requestId } });
    return;
  }
  if (benchmarkRunning) {
    res.status(409).json({ error: { code: 'INTERNAL', message: 'A benchmark is already running.', request_id: _req.requestId } });
    return;
  }

  benchmarkRunning = true;
  const root = resolve(process.cwd(), config.PROJECT_ROOT);
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const processHandle = spawn(command, ['run', 'bench'], {
    cwd: root,
    env: { ...process.env },
    stdio: 'ignore',
  });
  processHandle.once('error', (error) => {
    benchmarkRunning = false;
    logger.error({ err: error }, 'failed to start benchmark runner');
  });
  processHandle.once('exit', (code) => {
    benchmarkRunning = false;
    logger.info({ exit_code: code }, 'benchmark runner finished');
  });
  res.status(202).json({ ok: true, message: 'Benchmark started. Live progress will display in the benchmark lab.' });
});

