import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Layers,
  Bot,
  Zap,
  Code2,
  LockKeyhole,
  Activity,
  ArrowRightLeft,
  Server,
  Database,
  Sliders,
  ShieldCheck,
  CheckCircle2,
  Search
} from 'lucide-react';
import { getModels, type Model } from '../api/client';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Pill } from '../components/ui/Pill';

const tierLabel = (tier?: string): string =>
  tier === 'light' ? 'Light' : tier === 'code' ? 'Code' : 'Heavy';

const tierIcon = (tier?: string) =>
  tier === 'light' ? <Zap size={14} /> : tier === 'code' ? <Code2 size={14} /> : <Layers size={14} />;

export const InsightsPage = () => {
  const [activeTab, setActiveTab] = useState<'registry' | 'architecture' | 'privacy'>('registry');
  const [searchQuery, setSearchQuery] = useState('');
  const modelsQuery = useQuery({ queryKey: ['models'], queryFn: getModels, staleTime: 30_000 });
  const models: Model[] = modelsQuery.data ?? [];

  const filteredModels = useMemo(() => {
    if (!searchQuery.trim()) return models;
    const q = searchQuery.toLowerCase();
    return models.filter(m => m.name.toLowerCase().includes(q) || m.tier.toLowerCase().includes(q));
  }, [models, searchQuery]);

  return (
    <div className="insights-container">
      <div className="page-heading">
        <div>
          <p className="eyebrow"><Layers size={13} /> Local System Specifications</p>
          <h1 className="page-title">Model Registry & Routing Specs</h1>
          <p className="page-description">
            Inspect configured local LLM models, routing tiers, heuristic routing rules, and local security guarantees.
          </p>
        </div>
        <Pill tone="success"><LockKeyhole size={12} /> Local-first Engine</Pill>
      </div>

      {/* Tabs */}
      <div className="insights-tabs">
        <button
          type="button"
          className={`insights-tab-btn ${activeTab === 'registry' ? 'active' : ''}`}
          onClick={() => setActiveTab('registry')}
        >
          <Bot size={15} />
          Model Registry ({models.length})
        </button>
        <button
          type="button"
          className={`insights-tab-btn ${activeTab === 'architecture' ? 'active' : ''}`}
          onClick={() => setActiveTab('architecture')}
        >
          <Sliders size={15} />
          Routing Heuristics & Tiers
        </button>
        <button
          type="button"
          className={`insights-tab-btn ${activeTab === 'privacy' ? 'active' : ''}`}
          onClick={() => setActiveTab('privacy')}
        >
          <ShieldCheck size={15} />
          Local Architecture & Sovereignty
        </button>
      </div>

      {activeTab === 'registry' && (
        <div className="insights-section">
          <div className="insights-filter-bar">
            <div className="insights-search-wrap">
              <Search size={15} />
              <input
                type="text"
                placeholder="Search models by name or tier..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="registry-stats">
              <span>{models.filter(m => m.loaded).length} loaded in VRAM</span>
              <span className="dot-sep">·</span>
              <span>{models.filter(m => m.available).length} available</span>
            </div>
          </div>

          <div className="insights-grid">
            {filteredModels.map((model) => (
              <div key={model.name} className="model-bento-card">
                <div className="model-bento-header">
                  <div className="model-bento-icon-wrap">
                    {tierIcon(model.tier)}
                  </div>
                  <div className="model-bento-status">
                    {model.loaded ? (
                      <Pill tone="success">In Memory</Pill>
                    ) : model.available ? (
                      <Pill tone="default">Ready</Pill>
                    ) : (
                      <Pill tone="warning">Offline</Pill>
                    )}
                  </div>
                </div>

                <div className="model-bento-body">
                  <h3 className="model-bento-name">{model.name}</h3>
                  <div className="model-bento-tags">
                    <span className={`tier-badge tier-${model.tier}`}>
                      {tierLabel(model.tier)} Tier
                    </span>
                    <span className="concurrency-badge">
                      {model.max_concurrency} max concurrent
                    </span>
                  </div>
                  <p className="model-bento-desc">
                    {model.tier === 'light' && 'Fast reasoning for system lookups, quick explanations, classification, and short answers.'}
                    {model.tier === 'code' && 'Specialized syntax, debugging, algorithms, and logic code generation model.'}
                    {model.tier === 'heavy' && 'Comprehensive deep reasoning, multi-turn synthesis, complex analysis, and architecture design.'}
                  </p>
                </div>

                <div className="model-bento-footer">
                  <div className="model-bento-metric">
                    <span>Concurrency</span>
                    <strong>{model.max_concurrency}</strong>
                  </div>
                  <div className="model-bento-metric">
                    <span>State</span>
                    <strong style={{ textTransform: 'capitalize' }}>{model.loaded ? 'Warm' : 'Cold'}</strong>
                  </div>
                </div>
              </div>
            ))}
            {filteredModels.length === 0 && (
              <div className="empty-registry-state">
                <Bot size={28} />
                <p>No models matching your query were found.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'architecture' && (
        <div className="insights-section">
          <div className="routing-tiers-overview">
            <Card>
              <CardHeader>
                <div>
                  <h2 className="card-title">Intelligent Routing Pipeline</h2>
                  <p className="card-subtitle">How prompts get evaluated and assigned in single-digit milliseconds</p>
                </div>
                <Activity size={16} color="var(--accent)" />
              </CardHeader>
              <CardBody>
                <div className="pipeline-steps">
                  <div className="pipeline-step">
                    <div className="step-number">01</div>
                    <div className="step-content">
                      <h4>Prompt Ingestion & Token Estimation</h4>
                      <p>Computes byte length, token estimates, and matches against the Redis exact-match cache hash.</p>
                    </div>
                  </div>
                  <div className="pipeline-step">
                    <div className="step-number">02</div>
                    <div className="step-content">
                      <h4>Intent & Complexity Classification</h4>
                      <p>Evaluates AST markers, programming keywords, question structure, and assigns a 0-100 complexity score.</p>
                    </div>
                  </div>
                  <div className="pipeline-step">
                    <div className="step-number">03</div>
                    <div className="step-content">
                      <h4>Tier Mapping & Model Selection</h4>
                      <p>Scores &lt; 35 select the <em>Light</em> model, code syntax triggers the <em>Code</em> model, and complex prompts route to <em>Heavy</em>.</p>
                    </div>
                  </div>
                  <div className="pipeline-step">
                    <div className="step-number">04</div>
                    <div className="step-content">
                      <h4>Warm-Up & SSE Streaming</h4>
                      <p>Ollama backend receives the dispatch, streams SSE tokens immediately with real-time TTFT and throughput calculation.</p>
                    </div>
                  </div>
                </div>
              </CardBody>
            </Card>

            <div className="tiers-detail-grid">
              <div className="tier-card tier-light-card">
                <div className="tier-card-header">
                  <div className="tier-card-badge">Light Tier</div>
                  <Zap size={18} />
                </div>
                <h3>Quick Inferences & Queries</h3>
                <p>Designed for immediate low-latency responses, factual summaries, definitions, and short queries.</p>
                <div className="tier-card-specs">
                  <div><strong>Threshold:</strong> Score 0 - 34</div>
                  <div><strong>Target Latency:</strong> &lt; 250ms TTFT</div>
                </div>
              </div>

              <div className="tier-card tier-code-card">
                <div className="tier-card-header">
                  <div className="tier-card-badge">Code Tier</div>
                  <Code2 size={18} />
                </div>
                <h3>Programming & Logic</h3>
                <p>Triggered whenever code snippets, backticks, language identifiers, or algorithmic terms are detected.</p>
                <div className="tier-card-specs">
                  <div><strong>Detection:</strong> Syntax patterns & keywords</div>
                  <div><strong>Target:</strong> High precision code generation</div>
                </div>
              </div>

              <div className="tier-card tier-heavy-card">
                <div className="tier-card-header">
                  <div className="tier-card-badge">Heavy Tier</div>
                  <Layers size={18} />
                </div>
                <h3>Deep Analysis & Synthesis</h3>
                <p>Engaged for high-complexity analysis, multi-step problem solving, and long contextual explanations.</p>
                <div className="tier-card-specs">
                  <div><strong>Threshold:</strong> Score 35 - 100</div>
                  <div><strong>Target:</strong> Maximum reasoning depth</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'privacy' && (
        <div className="insights-section">
          <div className="sovereignty-grid">
            <Card>
              <CardHeader>
                <div>
                  <h2 className="card-title">100% Local Inference Guarantee</h2>
                  <p className="card-subtitle">No cloud endpoints, zero third-party telemetry</p>
                </div>
                <CheckCircle2 size={18} color="var(--success)" />
              </CardHeader>
              <CardBody>
                <div className="sovereignty-items">
                  <div className="sovereignty-item">
                    <Server size={18} />
                    <div>
                      <strong>On-Device Execution</strong>
                      <p>All inference requests execute strictly against local Ollama services on localhost:11434. Network access is isolated.</p>
                    </div>
                  </div>
                  <div className="sovereignty-item">
                    <Database size={18} />
                    <div>
                      <strong>Private Redis Caching</strong>
                      <p>Exact match prompt-response caching runs on your local Redis daemon. Flushed whenever you want via Settings.</p>
                    </div>
                  </div>
                  <div className="sovereignty-item">
                    <ArrowRightLeft size={18} />
                    <div>
                      <strong>No Telemetry or Phone-Home</strong>
                      <p>No analytics trackers, pixel cookies, or remote logging collectors. Prompts and responses never exit your system.</p>
                    </div>
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
};
