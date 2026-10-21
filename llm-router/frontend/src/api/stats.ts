import type { Stats } from './client';

export type StatsConnection = 'connecting' | 'connected' | 'reconnecting';

/** Open the stats SSE endpoint; EventSource reconnects with its native bounded retry behavior. */
export const subscribeToStats = (
  onStats: (stats: Stats) => void,
  onConnection: (status: StatsConnection) => void,
): (() => void) => {
  const apiBase = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';
  const source = new EventSource(`${apiBase.replace(/\/$/u, '')}/stats/stream`);
  onConnection('connecting');
  source.onopen = () => onConnection('connected');
  source.onerror = () => onConnection('reconnecting');
  source.addEventListener('stats', (message: MessageEvent<string>) => {
    try { onStats(JSON.parse(message.data) as Stats); } catch { /* Ignore an invalid snapshot; the next tick repairs it. */ }
  });
  return () => source.close();
};
