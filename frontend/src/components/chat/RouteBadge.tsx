import { useState } from 'react';
import { ArrowRightLeft, Brain, Code2, Info, Zap } from 'lucide-react';
import type { MetaEvent } from '../../api/client';
import { Pill } from '../ui/Pill';

const tierIcon = (tier: MetaEvent['tier']) => tier === 'light' ? <Zap size={12} aria-hidden="true" /> : tier === 'code' ? <Code2 size={12} aria-hidden="true" /> : <Brain size={12} aria-hidden="true" />;

export const RouteBadge = ({ meta }: { meta: MetaEvent }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="route-badge-wrap">
      <button className="route-badge-button" type="button" aria-expanded={open} aria-label={`Routing details for ${meta.model}`} onClick={() => setOpen((current) => !current)}>
        <Pill tone={meta.tier}>{tierIcon(meta.tier)} <span>{meta.model}</span></Pill>
        <span className="route-score-mini">{meta.score}</span>
        <Info size={12} className="route-info-icon" aria-hidden="true" />
      </button>
      {open && <div className="route-popover" role="status">
        <div className="route-popover-head"><span className={`tier-dot tier-${meta.tier}`} />{meta.tier} tier <span className="route-popover-score">score {meta.score}/100</span></div>
        <p>{meta.reason}</p>
        <div className="route-popover-foot"><span>Intent: {meta.intent}</span>{meta.swap_expected && <span><ArrowRightLeft size={11} /> model swap</span>}{meta.fallback_from && <span>fallback from {meta.fallback_from}</span>}</div>
      </div>}
    </div>
  );
};
