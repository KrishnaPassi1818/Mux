import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';

const defaultsSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  router_url: z.string().url(),
  cors_origins: z.string(),
  rate_limit_per_min: z.number().int().min(1),
  rate_limit_window_ms: z.number().int().min(1000),
  max_request_bytes: z.number().int().min(1024).max(1048576),
  request_timeout_ms: z.number().int().min(1000),
  log_level: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
  benchmark_enabled: z.boolean(),
  bench_results_dir: z.string().min(1),
  project_root: z.string().min(1),
});

const configPath = process.env.GATEWAY_CONFIG ?? fileURLToPath(new URL('../../config/gateway.yaml', import.meta.url));
let defaults: z.infer<typeof defaultsSchema>;
try {
  const parsedFile = parse(readFileSync(resolve(configPath), 'utf8')) as { gateway?: unknown };
  const validated = defaultsSchema.safeParse(parsedFile?.gateway);
  if (!validated.success) throw new Error(validated.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  defaults = validated.data;
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  throw new Error(`Invalid gateway configuration at ${configPath}: ${detail}`, { cause: error });
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  GATEWAY_HOST: z.string().min(1).default(defaults.host),
  GATEWAY_PORT: z.coerce.number().int().min(1).max(65535).default(defaults.port),
  ROUTER_URL: z.string().url().default(defaults.router_url),
  CORS_ORIGINS: z.string().default(defaults.cors_origins),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(defaults.rate_limit_per_min),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(defaults.rate_limit_window_ms),
  MAX_REQUEST_BYTES: z.coerce.number().int().min(1024).max(1048576).default(defaults.max_request_bytes),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default(defaults.log_level),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(defaults.request_timeout_ms),
  BENCH_RESULTS_DIR: z.string().default(defaults.bench_results_dir),
  PROJECT_ROOT: z.string().default(defaults.project_root),
  BENCHMARK_ENABLED: z.enum(['true', 'false']).default(String(defaults.benchmark_enabled) as 'true' | 'false'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const issueText = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  throw new Error(`Invalid gateway environment: ${issueText}`);
}

/** Validated process configuration; secrets are intentionally not included. */
export const config = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
};
