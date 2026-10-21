import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface PillProps { children: ReactNode; tone?: 'default' | 'success' | 'warning' | 'danger' | 'cache' | 'light' | 'code' | 'heavy'; }
export const Pill = ({ children, tone = 'default' }: PillProps) => (
  <span className={cn('pill', tone === 'success' && 'pill-success', tone === 'warning' && 'pill-warning', tone === 'danger' && 'pill-danger', tone === 'cache' && 'pill-cache', tone === 'light' && 'pill-tier-light', tone === 'code' && 'pill-tier-code', tone === 'heavy' && 'pill-tier-heavy')}>{children}</span>
);
