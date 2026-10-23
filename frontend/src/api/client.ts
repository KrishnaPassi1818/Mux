import type { components } from './types/api.generated';

export type ChatRequest = components['schemas']['ChatRequest'];
export type RouteDecision = components['schemas']['RouteDecision'];
export type Stats = components['schemas']['Stats'];
export type Model = components['schemas']['Model'];
export type Health = components['schemas']['Health'];
export type BenchmarkResult = components['schemas']['BenchmarkResult'];
export type MetaEvent = components['schemas']['MetaEvent'];
export type TokenEvent = components['schemas']['TokenEvent'];
export type DoneEvent = components['schemas']['DoneEvent'];
export type ErrorEvent = components['schemas']['ErrorEvent'];

const apiBase = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

export class ApiError extends Error {
  readonly code: string;
  readonly requestId?: string;
  readonly status: number;

  constructor(message: string, code: string, status: number, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    if (requestId !== undefined) this.requestId = requestId;
  }
}

const endpoint = (path: string): string => `${apiBase.replace(/\/$/u, '')}${path}`;

/** Typed JSON client used by all views; components never call fetch directly. */
export const requestJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(endpoint(path), {
      ...init,
      headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network request failed.';
    throw new ApiError(message, 'UPSTREAM_UNAVAILABLE', 0);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { code?: string; message?: string; request_id?: string } } | null;
    throw new ApiError(payload?.error?.message ?? `Request failed with HTTP ${response.status}.`, payload?.error?.code ?? 'INTERNAL', response.status, payload?.error?.request_id);
  }
  return await response.json() as T;
};

export const getHealth = (): Promise<Health> => requestJson<Health>('/health');
export const getModels = async (): Promise<Model[]> => {
  const payload = await requestJson<{ models: Model[] }>('/models');
  return payload.models;
};
export const getStats = (): Promise<Stats> => requestJson<Stats>('/stats');
export const previewRoute = (messages: ChatRequest['messages'], mode: 'auto' | 'force' = 'auto', model?: string): Promise<RouteDecision> =>
  requestJson<RouteDecision>('/route/preview', { method: 'POST', body: JSON.stringify({ messages, mode, ...(model ? { model } : {}) }) });
export const flushCache = (): Promise<{ ok: boolean; removed: number }> => requestJson('/cache/flush', { method: 'POST' });
export const getBenchmarkResults = async (): Promise<BenchmarkResult[]> => {
  const payload = await requestJson<{ results: BenchmarkResult[] }>('/benchmark/results');
  return payload.results;
};
export const startBenchmark = (): Promise<{ ok: boolean; message: string }> => requestJson('/benchmark/run', { method: 'POST', body: JSON.stringify({}) });

export interface BenchmarkStatus {
  running: boolean;
  progress?: {
    phase: 'previews' | 'run_A' | 'run_B' | 'run_C' | 'finalizing' | 'completed';
    phase_name: string;
    current_step: number;
    total_steps: number;
    current_prompt_id?: string;
    elapsed_ms: number;
    updated_at: string;
  } | null;
  checkpoint?: {
    id?: string;
    created_at?: string;
    prompt_count?: number;
  } | null;
}

export const getBenchmarkStatus = (): Promise<BenchmarkStatus> =>
  requestJson<BenchmarkStatus>('/benchmark/status');

export const apiBasePath = apiBase;

