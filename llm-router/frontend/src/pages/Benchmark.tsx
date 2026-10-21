import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  FileCode2,
  FileJson,
  FileSpreadsheet,
  Play,
  RefreshCw,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getBenchmarkResults, getBenchmarkStatus, startBenchmark, type BenchmarkResult } from '../api/client';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorBanner } from '../components/ui/ErrorBanner';
import { Pill } from '../components/ui/Pill';
import { formatDuration, formatPercent, formatRelativeTime } from '../lib/format';
import { exportAsJson, exportAsPdf, exportAsYaml } from '../lib/benchmarkReport';

const tierNames = ['light', 'code', 'heavy'] as const;
const runLabels = ['A', 'B', 'C'] as const;
const emptyResults: BenchmarkResult[] = [];
const runName = (run: typeof runLabels[number]): string => run === 'A' ? 'Heavy only' : run === 'B' ? 'Router' : 'Router + cache';
const tierColor = (tier: string): string => getComputedStyle(document.documentElement).getPropertyValue(`--tier-${tier}`).trim() || 'var(--accent)';

const metricsForChart = (result: BenchmarkResult | undefined) => {
  if (!result?.runs) return [];
  return [
    { metric: 'Mean latency', A: result.runs.A?.mean_ms ?? null, B: result.runs.B?.mean_ms ?? null, C: result.runs.C?.mean_ms ?? null },
    { metric: 'p50 latency', A: result.runs.A?.p50_ms ?? null, B: result.runs.B?.p50_ms ?? null, C: result.runs.C?.p50_ms ?? null },
    { metric: 'p95 latency', A: result.runs.A?.p95_ms ?? null, B: result.runs.B?.p95_ms ?? null, C: result.runs.C?.p95_ms ?? null },
  ];
};

const verdictFor = (result: BenchmarkResult | undefined): { text: string; pass: boolean | null } => {
  const baseline = result?.runs?.A?.mean_ms;
  const router = result?.runs?.B?.mean_ms;
  if (baseline === undefined || router === undefined || baseline <= 0) return { text: 'Run a benchmark to compare the router against the heavy-only baseline.', pass: null };
  const improvement = (baseline - router) / baseline * 100;
  const direction = improvement >= 0 ? `${Math.abs(improvement).toFixed(1)}% lower mean latency` : `${Math.abs(improvement).toFixed(1)}% higher mean latency`;
  const targetValue = result?.kpis?.KPI2_target;
  if (typeof targetValue !== 'number') return { text: `Router is ${direction} than heavy-only. This result does not include the KPI-2 target.`, pass: null };
  const target = improvement >= targetValue;
  return { text: `Router is ${direction} than heavy-only. ${target ? 'KPI-2 target met.' : `KPI-2 target (${targetValue}% lower) not met.`}`, pass: target };
};

const ChartTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number | null; color?: string }>; label?: string }) => {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><strong>{label}</strong>{payload.map((item) => <div key={item.name} style={{ color: item.color }}>{item.name}: {item.value === null || item.value === undefined ? '-' : formatDuration(item.value)}</div>)}</div>;
};

export const BenchmarkPage = () => {
  const queryClient = useQueryClient();
  const resultsQuery = useQuery({ queryKey: ['benchmark-results'], queryFn: getBenchmarkResults, refetchInterval: 5000, staleTime: 1000 });
  const statusQuery = useQuery({ queryKey: ['benchmark-status'], queryFn: getBenchmarkStatus, refetchInterval: 1500 });
  const results = resultsQuery.data ?? emptyResults;
  const [selectedId, setSelectedId] = useState('');
  const [notice, setNotice] = useState('');
  const [showExportMenu, setShowExportMenu] = useState(false);

  const result = useMemo(() => results.find((item) => item.id === selectedId) ?? results[0], [results, selectedId]);
  const isRunning = statusQuery.data?.running ?? false;
  const progress = statusQuery.data?.progress;

  const runMutation = useMutation({
    mutationFn: startBenchmark,
    onSuccess: (data) => {
      setNotice(data.message);
      queryClient.invalidateQueries({ queryKey: ['benchmark-status'] });
      window.setTimeout(() => setNotice(''), 6000);
    },
    onError: (error) => {
      setNotice(error instanceof Error ? error.message : 'Could not start benchmark.');
    },
  });

  const chartData = metricsForChart(result);
  const verdict = verdictFor(result);
  const confusion = result?.confusion_matrix as Record<string, Record<string, number>> | undefined;
  const accuracyValue = result?.runs?.B?.accuracy;
  const accuracyTarget = typeof result?.kpis?.KPI1_target === 'number' ? result.kpis.KPI1_target : undefined;
  const accuracyTone = typeof accuracyValue !== 'number' || accuracyTarget === undefined ? 'default' : accuracyValue >= accuracyTarget ? 'success' : 'warning';

  const progressPct = progress && progress.total_steps > 0 ? Math.min(100, Math.round((progress.current_step / progress.total_steps) * 100)) : 0;

  return (
    <div className="page-container">
      <div className="page-heading">
        <div className="page-heading-left">
          <div className="page-heading-tags">
            <p className="eyebrow"><BarChart3 size={12} /> Measured performance</p>
            {isRunning ? (
              <span className="live-pill-pulse">
                <Pill tone="success">
                  <Activity size={11} className="spin-icon" /> RUNNING LIVE
                </Pill>
              </span>
            ) : (
              <Pill>IDLE</Pill>
            )}
          </div>
          <h1 className="page-title">Benchmark lab</h1>
          <p className="page-description">Compare heavy-only inference, automatic routing, and the response cache. Results are generated by the committed test harness, not estimates.</p>
        </div>
        <div className="benchmark-toolbar">
          {results.length > 0 && (
            <>
              <label className="sr-only" htmlFor="benchmark-select">Select benchmark run</label>
              <select id="benchmark-select" className="settings-select benchmark-select" value={result?.id ?? ''} onChange={(event) => setSelectedId(event.currentTarget.value)}>
                {results.map((item) => <option value={item.id} key={item.id}>{formatRelativeTime(item.created_at)} · {item.prompt_count} prompts</option>)}
              </select>

              {/* Multi-format export dropdown */}
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <Button className="download-button" onClick={() => setShowExportMenu(!showExportMenu)} disabled={!result}>
                  <ArrowDownToLine size={13} /> Export Report ▾
                </Button>
                {showExportMenu && result && (
                  <div
                    style={{
                      position: 'absolute',
                      right: 0,
                      top: 'calc(100% + 4px)',
                      zIndex: 100,
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: 'var(--radius-xs)',
                      boxShadow: 'var(--shadow-2)',
                      minWidth: 155,
                      padding: '4px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                    }}
                  >
                    <button
                      type="button"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '7px 10px',
                        background: 'none',
                        border: 'none',
                        color: 'var(--text)',
                        fontSize: 12,
                        textAlign: 'left',
                        cursor: 'pointer',
                        borderRadius: 3,
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-1)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                      onClick={() => {
                        setShowExportMenu(false);
                        exportAsPdf(result);
                      }}
                    >
                      <FileSpreadsheet size={13} style={{ color: 'var(--accent)' }} /> Export as PDF
                    </button>
                    <button
                      type="button"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '7px 10px',
                        background: 'none',
                        border: 'none',
                        color: 'var(--text)',
                        fontSize: 12,
                        textAlign: 'left',
                        cursor: 'pointer',
                        borderRadius: 3,
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-1)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                      onClick={() => {
                        setShowExportMenu(false);
                        exportAsJson(result);
                      }}
                    >
                      <FileJson size={13} style={{ color: '#eab308' }} /> Export as JSON
                    </button>
                    <button
                      type="button"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '7px 10px',
                        background: 'none',
                        border: 'none',
                        color: 'var(--text)',
                        fontSize: 12,
                        textAlign: 'left',
                        cursor: 'pointer',
                        borderRadius: 3,
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-1)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                      onClick={() => {
                        setShowExportMenu(false);
                        exportAsYaml(result);
                      }}
                    >
                      <FileCode2 size={13} style={{ color: '#38bdf8' }} /> Export as YAML
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          <Button
            variant="primary"
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending || isRunning}
          >
            {isRunning ? (
              <><RefreshCw size={13} className="spin-icon" /> Benchmark in progress…</>
            ) : runMutation.isPending ? (
              <><RefreshCw size={13} className="spin-icon" /> Starting…</>
            ) : (
              <><Play size={13} fill="currentColor" /> Run benchmark</>
            )}
          </Button>
        </div>
      </div>

      {notice && <div className="benchmark-notice" role="status"><CheckCircle2 size={15} />{notice}</div>}
      {resultsQuery.isError && <ErrorBanner title="Could not load benchmark results" message={resultsQuery.error instanceof Error ? resultsQuery.error.message : 'Try again when the gateway is available.'} />}

      {/* Interactive Running & Progress Status Card */}
      {isRunning && (
        <Card style={{ marginBottom: 16, border: '1px solid var(--accent)', background: 'color-mix(in srgb, var(--accent) 5%, var(--surface-1))' }}>
          <CardHeader>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)', animation: 'pulse 1s infinite alternate' }} />
              <div>
                <h2 className="card-title" style={{ color: 'var(--accent)' }}>Benchmark Execution in Progress</h2>
                <p className="card-subtitle">
                  {progress ? `${progress.phase_name} · Step ${progress.current_step} of ${progress.total_steps}` : 'Harness is starting and evaluating models...'}
                </p>
              </div>
            </div>
            <Pill tone="success">{progress ? `${progressPct}% complete` : 'Active'}</Pill>
          </CardHeader>
          <CardBody>
            <div style={{ width: '100%', height: 8, background: 'var(--surface-2)', borderRadius: 4, overflow: 'hidden', margin: '6px 0 12px' }}>
              <div
                style={{
                  width: `${Math.max(5, progressPct)}%`,
                  height: '100%',
                  background: 'var(--accent)',
                  transition: 'width 300ms ease-out',
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, fontSize: 11, color: 'var(--text-subtle)' }}>
              <div><strong>Current Prompt:</strong> <code style={{ color: 'var(--text)' }}>{progress?.current_prompt_id || 'Initializing request queue...'}</code></div>
              {progress?.elapsed_ms !== undefined && (
                <div><strong>Elapsed Time:</strong> {(progress.elapsed_ms / 1000).toFixed(1)}s</div>
              )}
              <div><strong>Estimated Steps:</strong> {progress?.current_step ?? 0} / {progress?.total_steps ?? 'calculating'}</div>
            </div>
          </CardBody>
        </Card>
      )}

      {!result && !resultsQuery.isLoading && !isRunning && <Card><EmptyState icon={<BarChart3 size={19} />} title="No benchmark runs yet" description="Run the A/B/C harness to measure your local models. A full run uses the labeled prompt set and stores a JSON result in bench/results/." action={<Button variant="primary" onClick={() => runMutation.mutate()} disabled={runMutation.isPending || isRunning}><Play size={13} />Start first run</Button>} /></Card>}
      {resultsQuery.isLoading && !result && <Card><div className="benchmark-loading"><RefreshCw size={17} className="spin-icon" />Loading committed benchmark results…</div></Card>}

      {result && <>
        <section className={`benchmark-banner ${verdict.pass === false ? 'verdict-missed' : ''}`}>
          <div><div className="section-label">Data-driven verdict</div><p className="benchmark-verdict">{result.verdict || verdict.text}</p><div className="benchmark-meta">{result.hardware || 'Hardware not specified'} <span className="dot-separator">·</span> {result.prompt_count} prompts <span className="dot-separator">·</span> {formatRelativeTime(result.created_at)}</div></div>
          <div className="verdict-right">{verdict.pass === null ? <Pill>Awaiting run</Pill> : verdict.pass ? <Pill tone="success"><CheckCircle2 size={11} /> KPI-2 met</Pill> : <Pill tone="warning"><AlertTriangle size={11} /> KPI-2 missed</Pill>}{result.methodology?.toLowerCase().includes('mock') && <Pill tone="warning">Mock backend · not model hardware</Pill>}</div>
        </section>


        <div className="benchmark-grid">
          <Card>
            <CardHeader><div><h2 className="card-title">A/B/C latency comparison</h2><p className="card-subtitle">Milliseconds · lower is better</p></div><Pill>Measured run</Pill></CardHeader>
            <CardBody><div className="chart-wrap benchmark-chart" role="img" aria-label="Grouped bar chart comparing mean, p50, and p95 latency across benchmark runs">
              {chartData.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}><CartesianGrid stroke="var(--border)" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="metric" tick={{ fill: 'var(--text-subtle)', fontSize: 9 }} axisLine={false} tickLine={false} /><YAxis tick={{ fill: 'var(--text-subtle)', fontSize: 9 }} axisLine={false} tickLine={false} /><Tooltip content={<ChartTooltip />} /><Legend wrapperStyle={{ fontSize: 10, color: 'var(--text-muted)' }} /><Bar dataKey="A" name="A · Heavy only" fill={tierColor('heavy')} radius={[4, 4, 0, 0]} /><Bar dataKey="B" name="B · Router" fill={tierColor('code')} radius={[4, 4, 0, 0]} /><Bar dataKey="C" name="C · Router + cache" fill={tierColor('light')} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer> : <div className="chart-empty">This result does not include latency aggregates.</div>}
            </div></CardBody>
          </Card>

          <Card>
            <CardHeader><div><h2 className="card-title">Routing accuracy</h2><p className="card-subtitle">Expected tier × selected tier · run B</p></div><Pill tone={accuracyTone}>{typeof accuracyValue === 'number' ? formatPercent(accuracyValue, true) : '-'}</Pill></CardHeader>
            <CardBody>{confusion ? <div className="confusion-grid" role="table" aria-label="Routing confusion matrix"><span className="confusion-cell header">Expected ↓<br />Routed →</span>{tierNames.map((tier) => <span className="confusion-cell header" key={tier}>{tier}</span>)}{tierNames.map((expected) => <Fragment key={expected}><span className="confusion-cell header">{expected}</span>{tierNames.map((actual) => <span className={`confusion-cell ${expected === actual ? 'diagonal' : ''}`} key={actual}>{confusion[expected]?.[actual] ?? 0}</span>)}</Fragment>)}</div> : <div className="chart-empty matrix-empty">Confusion matrix not included in this result.</div>}
              <div className="efficiency-note"><AlertTriangle size={12} />Classifier accuracy is a labeled-prompt comparison, not answer-quality evaluation.</div>
            </CardBody>
          </Card>

          <Card className="benchmark-metrics-card">
            <CardHeader><div><h2 className="card-title">Run metrics</h2><p className="card-subtitle">Each cell comes from the saved result JSON</p></div></CardHeader>
            <CardBody className="table-card-body"><div className="table-scroll"><table className="metric-table"><thead><tr><th>Metric</th>{runLabels.map((run) => <th key={run}><span className="run-chip">{run} <span>{runName(run)}</span></span></th>)}</tr></thead><tbody>
              <MetricRow label="Mean latency" results={result} field="mean_ms" formatter={formatDuration} />
              <MetricRow label="p50 latency" results={result} field="p50_ms" formatter={formatDuration} />
              <MetricRow label="p95 latency" results={result} field="p95_ms" formatter={formatDuration} />
              <MetricRow label="TTFT mean" results={result} field="ttft_mean_ms" formatter={formatDuration} />
              <MetricRow label="Tokens / second" results={result} field="tokens_per_sec" formatter={(value) => Number.isFinite(value) ? `${value.toFixed(1)} tok/s` : '-'} />
              <MetricRow label="Model swaps" results={result} field="swaps" formatter={(value) => Math.round(value).toString()} />
              <MetricRow label="Cache hit rate" results={result} field="cache_hit_rate" formatter={(value) => formatPercent(value, true)} />
              <MetricRow label="Routing accuracy" results={result} field="accuracy" formatter={(value) => formatPercent(value, true)} />
              <MetricRow label="Total wall time" results={result} field="total_wall_ms" formatter={formatDuration} />
            </tbody></table></div></CardBody>
          </Card>

          <Card>
            <CardHeader><div><h2 className="card-title">Methodology & provenance</h2><p className="card-subtitle">Reproducibility notes attached to the run</p></div><ArrowUpRight size={14} color="var(--text-subtle)" /></CardHeader>
            <CardBody>
              <div className="provenance-row"><span>Run ID</span><code>{result.id}</code></div>
              <div className="provenance-row"><span>Created</span><code>{new Date(result.created_at).toLocaleString()}</code></div>
              <div className="provenance-row"><span>Prompt set</span><code>{result.prompt_count} labeled prompts</code></div>
              <div className="methodology-copy">{result.methodology || 'No methodology was included in this result file. See docs/benchmark-methodology.md before comparing runs.'}</div>
              <div className="efficiency-note"><AlertTriangle size={12} />Do not compare results across different models, hardware, or warm-up policies without calling that out.</div>
            </CardBody>
          </Card>
        </div>
      </>}
    </div>
  );
};

type NumericMetric = 'mean_ms' | 'p50_ms' | 'p95_ms' | 'ttft_mean_ms' | 'tokens_per_sec' | 'swaps' | 'cache_hit_rate' | 'accuracy' | 'total_wall_ms';
const MetricRow = ({ label, results, field, formatter }: { label: string; results: BenchmarkResult; field: NumericMetric; formatter: (value: number) => string }) => (
  <tr><td>{label}</td>{runLabels.map((run) => { const value = results.runs?.[run]?.[field]; return <td key={run}>{typeof value === 'number' && Number.isFinite(value) ? formatter(value) : '-'}</td>; })}</tr>
);
