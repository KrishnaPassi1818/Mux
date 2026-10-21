import { useEffect, useState } from 'react';
import type { Stats } from '../api/client';
import { subscribeToStats, type StatsConnection } from '../api/stats';
import { RingBuffer } from '../lib/ringBuffer';

const statsBuffer = new RingBuffer<Stats>(300);

export const useStatsStream = (): { stats: Stats | null; points: Stats[]; connection: StatsConnection } => {
  const [stats, setStats] = useState<Stats | null>(null);
  const [points, setPoints] = useState<Stats[]>([]);
  const [connection, setConnection] = useState<StatsConnection>('connecting');

  useEffect(() => {
    statsBuffer.clear();
    return subscribeToStats((next) => {
      statsBuffer.push(next);
      setStats(next);
      setPoints(statsBuffer.toArray());
    }, setConnection);
  }, []);

  return { stats, points, connection };
};
