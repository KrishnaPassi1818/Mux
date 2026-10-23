import { useMemo, useState, type ReactNode } from 'react';
import { Activity, ArrowUpRight, Gauge, Layers3, RefreshCw, Timer, Zap } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useStatsStream } from '../hooks/useStatsStream';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Pill } from '../components/ui/Pill';
import { Skeleton } from '../components/ui/Skeleton';
import { formatDuration, formatNumber, formatPercent, formatRelativeTime } from '../lib/format';

const tierColor = (tier: string): string => getComputedStyle(document.documentElement).getPropertyValue(`--tier-${tier}`).trim() || 'var(--accent)';

const StatCard = ({ icon, label, value, foot, tone = 'default' }: { icon: ReactNode; label: string; value: string; foot: string; tone?: 'default' | 'estimated' }) => (
  <article className="card stat-card"><div className="stat-icon">{icon}</div><p className="stat-label">{label}</p><div className={`stat-value ${tone === 'estimated' ? 'estimated' : ''}`}>{value}</div><div className="stat-foot">{foot}</div></article>
);

const TooltipBox = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: string | number; color?: string }>; label?: string }) => {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><strong>{label}</strong>{payload.map((item) => <div key={item.name} style={{ color: item.color }}>{item.name}: {typeof item.value === 'number' ? `${Math.round(item.value)} ms` : item.value}</div>)}</div>;
};

const StatCardSkeleton = () => <div className="card stat-card"><Skeleton width={30} height={30} /><Skeleton width="60%" height={10} className="skeleton-spaced" /><Skeleton width="40%" height={22} /></div>;

export const DashboardPage = () => {
  const { stats, points, connection } = useStatsStream();
  const [windowMinutes, setWindowMinutes] = useState(5);
  const [tableView, setTableView] = useState(false);
  const current = stats;
  const populated = Boolean(current && current.requests_total > 0);
  const visiblePoints = points.filter((point) => Date.now() - new Date(point.timestamp).getTime() <= windowMinutes * 60_000);

  const models = current?.by_model ?? [];
  const lineData = useMemo(() => {
    const names = [...new Set(points.flatMap((point) => point.by_model?.map((item) => item.model) ?? []))];
    return visiblePoints.map((point) => {
      const row: Record<string, string | number | null> = { time: formatRelativeTime(point.timestamp) };
      for (const name of names) row[name] = point.by_model?.find((item) => item.model === name)?.avg_latency_ms ?? null;
      return row;
    });
  }, [points, visiblePoints]);
  const distributionTotal = models.reduce((sum, model) => sum + model.count, 0);
  const hitRate = current?.cache.hit_rate ?? 0;
  const vramUsed = current?.gpu?.vram_used_bytes ?? null;
  const vramTotal = current?.gpu?.vram_total_bytes ?? null;
  const vramPercent = vramUsed !== null && vramTotal ? Math.min(100, vramUsed / vramTotal * 100) : null;
  const savings = current?.estimated_savings;

  return (
    <div className="page-container">
      <div className="page-heading">
        <div className="page-heading-left">
          <p className="eyebrow"><Activity size={12} /> System observability</p>
          <h1 className="page-title">Live dashboard</h1>
          <p className="page-description">A real-time view of routed requests, model performance, cache behavior, and the current inference state.</p>
        </div>
        <div className="dashboard-status">
          <span className={`health-dot ${connection === 'connected' ? '' : connection === 'connecting' ? 'degraded' : 'offline'}`} />
          <span>{connection === 'connected' ? 'Live updates' : connection === 'connecting' ? 'Connecting…' : 'Reconnecting'}</span>
          <span className="status-divider" />
          <span className="mono-caption">1s refresh</span>
        </div>
      </div>

      <div className="stats-grid" aria-live="polite">
        {!current && Array.from({ length: 5 }, (_, index) => <StatCardSkeleton key={index} />)}
        {current && <>
          <StatCard icon={<Activity size={15} />} label="Requests" value={formatNumber(current.requests_total)} foot="rolling window" />
          <StatCard icon={<Timer size={15} />} label="Average latency" value={formatDuration(current.avg_latency_ms)} foot="inference + routing" />
          <StatCard icon={<Zap size={15} />} label="Cache hit rate" value={formatPercent(hitRate, true)} foot={`${formatNumber(current.cache.hits)} hits · ${formatNumber(current.cache.misses)} misses`} />
          <StatCard icon={<RefreshCw size={15} />} label="Model swaps" value={formatNumber(current.swaps)} foot="observed since startup" />
          <StatCard icon={<ArrowUpRight size={15} />} label="Time saved" value={formatDuration(savings?.time_ms)} foot="estimated vs heavy-only" tone="estimated" />
        </>}
      </div>

      {!current && <Card className="dashboard-empty"><EmptyState icon={<Activity size={18} />} title="Connecting to live stats…" description="The dashboard will fill in as soon as the router sends its first snapshot." /></Card>}
      {current && !populated && <Card className="dashboard-empty"><EmptyState icon={<Layers3 size={18} />} title="No requests yet" description="Send a prompt in Chat to see model selection, latency, and cache activity appear here." /></Card>}

      {current && populated && <>
        <div className="dashboard-grid">
          <Card>
            <CardHeader><div><h2 className="card-title">Latency over time</h2><p className="card-subtitle">Rolling model averages · last {windowMinutes} min</p></div><div className="chart-toggle" role="group" aria-label="Latency time window">{[1, 5].map((minutes) => <button type="button" key={minutes} className={windowMinutes === minutes ? 'active' : ''} onClick={() => setWindowMinutes(minutes)} aria-pressed={windowMinutes === minutes}>{minutes}m</button>)}</div></CardHeader>
            <CardBody>
              <div className="chart-wrap" role="img" aria-label="Latency line chart by model">
                {lineData.length ? <ResponsiveContainer width="100%" height="100%"><LineChart data={lineData} margin={{ top: 7, right: 10, bottom: 0, left: -14 }}><CartesianGrid stroke="var(--border)" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="time" tick={{ fill: 'var(--text-subtle)', fontSize: 9 }} axisLine={false} tickLine={false} minTickGap={24} /><YAxis tick={{ fill: 'var(--text-subtle)', fontSize: 9 }} axisLine={false} tickLine={false} /><Tooltip content={<TooltipBox />} />{[...new Set(points.flatMap((point) => point.by_model?.map((item) => item.model) ?? []))].map((name) => { const model = models.find((item) => item.model === name); return <Line key={name} type="monotone" dataKey={name} name={name} stroke={model ? tierColor(model.tier) : 'var(--accent)'} strokeWidth={2} dot={false} connectNulls activeDot={{ r: 4 }} />; })}</LineChart></ResponsiveContainer> : <div className="chart-empty">Waiting for latency samples…</div>}
              </div>
              <div className="chart-legend">{models.map((model) => <span className="legend-item" key={model.model}><span className="legend-dot" style={{ background: tierColor(model.tier) }} />{model.model}</span>)}</div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader><div><h2 className="card-title">Model distribution</h2><p className="card-subtitle">Requests served by configured tier</p></div><button className={`chart-toggle-button ${tableView ? 'active' : ''}`} type="button" onClick={() => setTableView((value) => !value)}>{tableView ? 'Chart' : 'Table'}</button></CardHeader>
            <CardBody>
              {tableView ? <div className="model-dist-list" role="table" aria-label="Model request distribution">{models.map((model) => <div className="model-dist-item" key={model.model}><span className="model-name">{model.model}</span><div className="model-dist-bar"><span style={{ width: `${distributionTotal ? model.count / distributionTotal * 100 : 0}%`, background: tierColor(model.tier) }} /></div><span className="model-dist-count">{model.count}</span></div>)}</div> : <div className="donut-layout">
                <div className="chart-wrap small" role="img" aria-label="Donut chart showing requests by model">
                  <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={models} dataKey="count" nameKey="model" cx="50%" cy="50%" innerRadius={54} outerRadius={78} paddingAngle={3} stroke="none">{models.map((model) => <Cell key={model.model} fill={tierColor(model.tier)} />)}</Pie><Tooltip formatter={(value) => [typeof value === 'number' || typeof value === 'string' ? value : 0, 'Requests']} contentStyle={{ background: 'var(--surface-2)', borderColor: 'var(--border)', borderRadius: 9, color: 'var(--text)', fontSize: 10 }} /></PieChart></ResponsiveContainer>
                </div>
                <div className="model-dist-list">{models.map((model) => <div className="model-dist-item" key={model.model}><span className="model-name">{model.model}</span><div className="model-dist-bar"><span style={{ width: `${distributionTotal ? model.count / distributionTotal * 100 : 0}%`, background: tierColor(model.tier) }} /></div><span className="model-dist-count">{model.count}</span></div>)}</div>
              </div>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader><div><h2 className="card-title">Latency by model</h2><p className="card-subtitle">Average and p95 · milliseconds</p></div><Pill>rolling</Pill></CardHeader>
            <CardBody><div className="chart-wrap small" role="img" aria-label="Average and p95 latency bar chart">
              <ResponsiveContainer width="100%" height="100%"><BarChart data={models} margin={{ top: 8, right: 4, bottom: 0, left: -16 }}><CartesianGrid stroke="var(--border)" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="tier" tick={{ fill: 'var(--text-subtle)', fontSize: 9 }} axisLine={false} tickLine={false} /><YAxis tick={{ fill: 'var(--text-subtle)', fontSize: 9 }} axisLine={false} tickLine={false} /><Tooltip content={<TooltipBox />} /><Bar dataKey="avg_latency_ms" name="Average" radius={[4, 4, 0, 0]}>{models.map((model) => <Cell key={model.model} fill={tierColor(model.tier)} fillOpacity={0.8} />)}</Bar><Bar dataKey="p95_latency_ms" name="p95" fill="var(--border-strong)" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
            </div></CardBody>
          </Card>

          <Card>
            <CardHeader><div><h2 className="card-title">Inference resources</h2><p className="card-subtitle">Current device state</p></div><Gauge size={15} color="var(--accent)" /></CardHeader>
            <CardBody>
              <div className="vram-block"><div className="vram-head"><span>VRAM usage</span><span>{vramUsed !== null && vramTotal ? `${(vramUsed / 1_000_000_000).toFixed(1)} / ${(vramTotal / 1_000_000_000).toFixed(1)} GB` : 'not reported'}</span></div><div className="vram-track" role="meter" aria-label="VRAM usage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={vramPercent ?? 0}><div className={`vram-fill ${vramPercent !== null && vramPercent > 90 ? 'critical' : vramPercent !== null && vramPercent > 75 ? 'warning' : ''}`} style={{ width: `${vramPercent ?? 0}%` }} /></div><div className="vram-caption"><span>{current.loaded_model ? `Loaded · ${current.loaded_model}` : 'No loaded model reported'}</span><span>{vramPercent === null ? '-' : `${Math.round(vramPercent)}%`}</span></div></div>
              <div className="queue-heading">Per-model queue depth</div><div className="queue-list">{Object.entries(current.queue_depth ?? {}).map(([model, depth]) => <div className="queue-item" key={model}><span className="queue-model"><span className={`tier-indicator tier-${models.find((item) => item.model === model)?.tier ?? 'light'}`} />{model}</span><span className="queue-value">{depth}</span></div>)}</div>
            </CardBody>
          </Card>
        </div>

        <Card className="decision-card">
          <CardHeader><div><h2 className="card-title">Recent routing decisions</h2><p className="card-subtitle">Newest first · prompt text is never recorded</p></div><Pill tone={connection === 'connected' ? 'success' : 'warning'}><span className={`health-dot ${connection === 'connected' ? '' : 'degraded'}`} />{connection === 'connected' ? 'live' : 'reconnecting'}</Pill></CardHeader>
          <CardBody className="table-card-body"><div className="table-scroll"><table className="decision-table"><thead><tr><th>Time</th><th>Model</th><th>Score</th><th>Reason</th><th>Latency</th><th>Cache</th></tr></thead><tbody>{current.recent?.length ? current.recent.slice(0, 12).map((record) => <tr key={record.id}><td>{formatRelativeTime(record.timestamp)}</td><td className="decision-model">{record.model}</td><td><span className={`score-chip tier-text-${record.tier}`}>{record.score}</span></td><td title={record.reason}>{record.reason}</td><td>{formatDuration(record.latency_ms)}</td><td>{record.cache === 'hit' ? <Pill tone="cache">hit</Pill> : record.cache === 'bypass' ? <Pill>bypass</Pill> : <Pill>miss</Pill>}</td></tr>) : <tr><td colSpan={6} className="table-empty">No completed decisions in this window.</td></tr>}</tbody></table></div></CardBody>
        </Card>
        <div className="dashboard-footnote"><span className="estimated-mark" /> Savings: {savings?.basis === 'calibrated-estimate' ? 'Estimated from the configured heavy-model baseline; not measured.' : 'No calibrated estimate available.'}<a href="/benchmark">Open benchmark results <ArrowUpRight size={11} /></a></div>
      </>}
    </div>
  );
};
