import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleHelp, Database, Globe2, LockKeyhole, RefreshCw, Server, Settings2, SunMoon, Trash2 } from 'lucide-react';
import { flushCache, getHealth, getModels, apiBasePath } from '../api/client';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { ErrorBanner } from '../components/ui/ErrorBanner';
import { Pill } from '../components/ui/Pill';
import { useSettingsStore } from '../store/settingsStore';

const statusTone = (status?: string): 'success' | 'warning' | 'danger' => status === 'healthy' ? 'success' : status === 'degraded' ? 'warning' : 'danger';

export const SettingsPage = () => {
  const queryClient = useQueryClient();
  const healthQuery = useQuery({ queryKey: ['health'], queryFn: getHealth, refetchInterval: 10_000 });
  const modelsQuery = useQuery({ queryKey: ['models'], queryFn: getModels, refetchInterval: 30_000 });
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const bypassCache = useSettingsStore((state) => state.bypassCache);
  const setBypassCache = useSettingsStore((state) => state.setBypassCache);
  const previewEnabled = useSettingsStore((state) => state.previewEnabled);
  const setPreviewEnabled = useSettingsStore((state) => state.setPreviewEnabled);
  const [toast, setToast] = useState('');
  const flushMutation = useMutation({ mutationFn: flushCache, onSuccess: async (result) => {
    setToast(`Cache cleared · ${result.removed} entr${result.removed === 1 ? 'y' : 'ies'} removed`);
    window.setTimeout(() => setToast(''), 3500);
    await queryClient.invalidateQueries({ queryKey: ['stats'] });
  } });
  const services = healthQuery.data?.services ?? {};
  const models = modelsQuery.data ?? [];

  const confirmFlush = (): void => {
    if (window.confirm('Flush all cached completions? This cannot be undone.')) flushMutation.mutate();
  };

  return (
    <div className="page-container">
      <div className="page-heading">
        <div className="page-heading-left">
          <p className="eyebrow"><Settings2 size={12} /> Preferences & operations</p>
          <h1 className="page-title">Settings</h1>
          <p className="page-description">Inspect the runtime model registry, adjust your local UI preferences, and manage the response cache.</p>
        </div>
        <Pill tone="success"><LockKeyhole size={11} /> Local-first</Pill>
      </div>

      {healthQuery.isError && <ErrorBanner title="Gateway health is unavailable" message={healthQuery.error instanceof Error ? healthQuery.error.message : 'The gateway could not be reached.'} />}
      {modelsQuery.isError && <div className="settings-alert"><CircleHelp size={14} /> Model registry is temporarily unavailable.</div>}

      <div className="settings-grid">
        <Card>
          <CardHeader><div><h2 className="card-title">Model registry</h2><p className="card-subtitle">Read-only view from the Rust router configuration</p></div><Server size={15} color="var(--accent)" /></CardHeader>
          <CardBody className="settings-card-body">
            {models.length ? <div className="table-scroll"><table className="decision-table model-registry-table"><thead><tr><th>Tier</th><th>Configured model</th><th>Runtime</th><th>Concurrency</th></tr></thead><tbody>{models.map((model) => <tr key={model.name}><td><Pill tone={model.tier}>{model.tier}</Pill></td><td className="decision-model">{model.name}</td><td>{model.loaded ? <Pill tone="success">loaded</Pill> : model.available ? <Pill>available</Pill> : <Pill tone="warning">not found</Pill>}</td><td>{model.max_concurrency}</td></tr>)}</tbody></table></div> : <div className="settings-empty">{modelsQuery.isLoading ? 'Loading configured models…' : 'No model registry data yet.'}</div>}
            <p className="settings-footnote">Model names, tiers, timeouts, and concurrency are managed in <code>config/models.yaml</code>.</p>
          </CardBody>
        </Card>

        <div className="settings-stack">
          <Card>
            <CardHeader><div><h2 className="card-title">Interface</h2><p className="card-subtitle">Saved in this browser only</p></div><SunMoon size={15} color="var(--accent)" /></CardHeader>
            <CardBody>
              <div className="settings-row"><div><div className="settings-label">Theme</div><div className="settings-help">Dark, light, or follow this device.</div></div><label className="sr-only" htmlFor="theme-select">Theme</label><select id="theme-select" className="settings-select" value={theme} onChange={(event) => setTheme(event.currentTarget.value as 'dark' | 'light' | 'system')}><option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option></select></div>
              <div className="settings-row"><div><div className="settings-label">Typing route preview</div><div className="settings-help">Debounced dry-run as you compose.</div></div><label className="switch-control"><input type="checkbox" checked={previewEnabled} onChange={(event) => setPreviewEnabled(event.currentTarget.checked)} /><span>{previewEnabled ? 'On' : 'Off'}</span></label></div>
              <div className="settings-row"><div><div className="settings-label">Bypass cache by default</div><div className="settings-help">Per-message cache setting can still be changed in Chat.</div></div><label className="switch-control"><input type="checkbox" checked={bypassCache} onChange={(event) => setBypassCache(event.currentTarget.checked)} /><span>{bypassCache ? 'On' : 'Off'}</span></label></div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader><div><h2 className="card-title">Services</h2><p className="card-subtitle">Latest gateway health check</p></div><Globe2 size={15} color="var(--accent)" /></CardHeader>
            <CardBody>{Object.keys(services).length ? Object.entries(services).map(([name, service]) => <div className="service-row" key={name}><div><div className="service-name">{name}</div><div className="service-detail">{service.detail ?? (service.latency_ms !== undefined ? `${Math.round(service.latency_ms)} ms` : 'health endpoint')}</div></div><Pill tone={statusTone(service.status)}><span className={`health-dot ${service.status === 'healthy' ? '' : service.status === 'degraded' ? 'degraded' : 'offline'}`} />{service.status ?? 'unknown'}</Pill></div>) : <div className="settings-empty">{healthQuery.isLoading ? 'Checking service health…' : 'No service health details returned.'}</div>}</CardBody>
          </Card>

          <Card>
            <CardHeader><div><h2 className="card-title">Response cache</h2><p className="card-subtitle">Redis · completed low-temperature responses only</p></div><Database size={15} color="var(--accent)" /></CardHeader>
            <CardBody><p className="side-copy cache-explainer">Cache keys are normalized and model-independent. Partial streams, errors, and high-temperature responses are never stored.</p><Button variant="danger" onClick={confirmFlush} disabled={flushMutation.isPending}><Trash2 size={13} />{flushMutation.isPending ? 'Flushing…' : 'Flush cache'}</Button>{flushMutation.isError && <div className="settings-inline-error">{flushMutation.error instanceof Error ? flushMutation.error.message : 'Could not flush cache.'}</div>}</CardBody>
          </Card>
        </div>

        <Card className="settings-runtime-card">
          <CardHeader><div><h2 className="card-title">Runtime & API</h2><p className="card-subtitle">Public gateway contract and build information</p></div><RefreshCw size={15} color="var(--accent)" /></CardHeader>
          <CardBody>
            <div className="settings-row"><div><div className="settings-label">API base</div><div className="settings-help">Configured by <code>VITE_API_BASE</code>.</div></div><code className="api-value">{window.location.origin}{apiBasePath}</code></div>
            <div className="settings-row"><div><div className="settings-label">Version</div><div className="settings-help">Local development build.</div></div><code className="api-value">LLM Router · v0.1.0</code></div>
            <div className="settings-row"><div><div className="settings-label">Custom Domain / Production Origin</div><div className="settings-help">Hostname detected for production routing or reverse proxy mapping.</div></div><code className="api-value">{window.location.hostname}</code></div>
            <div className="settings-row"><div><div className="settings-label">Privacy Policy & Terms</div><div className="settings-help">Data sovereignty statement and legal terms.</div></div><div style={{ display: 'flex', gap: '8px' }}><a href="/privacy" className="btn btn-quiet" style={{ fontSize: '11px', minHeight: '26px' }}>Privacy</a><a href="/terms" className="btn btn-quiet" style={{ fontSize: '11px', minHeight: '26px' }}>Terms</a></div></div>
            <div className="settings-row"><div><div className="settings-label">Privacy</div><div className="settings-help">No account, analytics beacon, or cloud inference provider.</div></div><Pill tone="success"><Check size={11} /> Private by default</Pill></div>
          </CardBody>
        </Card>
      </div>

      {toast && <div className="toast" role="status"><Check size={14} />{toast}</div>}
    </div>
  );
};
