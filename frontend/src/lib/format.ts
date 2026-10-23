export const formatDuration = (value?: number | null): string => {
  if (value === undefined || value === null || !Number.isFinite(value)) return '-';
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 2 : 1)} s`;
};

export const formatNumber = (value?: number | null): string =>
  value === undefined || value === null || !Number.isFinite(value) ? '-' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);

export const formatPercent = (value?: number | null, fromRatio = false): string => {
  if (value === undefined || value === null || !Number.isFinite(value)) return '-';
  return `${Math.round(fromRatio ? value * 100 : value)}%`;
};

export const formatTokensPerSecond = (value?: number | null): string =>
  value === undefined || value === null || !Number.isFinite(value) ? '-' : `${value.toFixed(1)} tok/s`;

export const formatRelativeTime = (timestamp: string): string => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date);
};

export const percentile = (values: number[], pct: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(pct * sorted.length) - 1)] ?? 0;
};
