import { Zap } from 'lucide-react';
import type { MetaEvent } from '../../api/client';
import { formatDuration } from '../../lib/format';
import { Pill } from '../ui/Pill';

export const CacheBadge = ({ meta, ttftMs }: { meta: MetaEvent; ttftMs?: number | undefined }) => {
  if (meta.cache === 'hit') return <Pill tone="cache"><Zap size={11} fill="currentColor" aria-hidden="true" /> cached · {formatDuration(ttftMs)}</Pill>;
  if (meta.cache === 'bypass') return <Pill>cache bypassed</Pill>;
  return <Pill>cache miss</Pill>;
};
