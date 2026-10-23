import { Activity, Clock3, Gauge, Hash } from 'lucide-react';
import type { components } from '../../api/types/api.generated';
import { formatDuration, formatNumber, formatTokensPerSecond } from '../../lib/format';

type Usage = components['schemas']['Usage'];
export const UsageFooter = ({ usage }: { usage: Usage }) => (
  <div className="usage-footer" aria-label="Response usage">
    <span><Hash size={10} aria-hidden="true" />{formatNumber(usage.completion_tokens)} tokens</span>
    <span><Clock3 size={10} aria-hidden="true" />TTFT {formatDuration(usage.ttft_ms)}</span>
    <span><Gauge size={10} aria-hidden="true" />{formatTokensPerSecond(usage.tokens_per_sec)}</span>
    <span><Activity size={10} aria-hidden="true" />{formatDuration(usage.total_ms)}</span>
  </div>
);
