import { useState, useRef, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowDownToLine,
  CheckCircle2,
  Cpu,
  FileCode2,
  FileJson,
  FileSpreadsheet,
  Gauge,
  Play,
  Sparkles,
  TrendingDown,
  Zap,
  Layers,
  StopCircle,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { getModels, type Model, type MetaEvent, type DoneEvent, type ErrorEvent } from '../api/client';
import { streamChat } from '../api/sse';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Pill } from '../components/ui/Pill';
import { EmptyState } from '../components/ui/EmptyState';
import { formatDuration } from '../lib/format';
import {
  EVALUATION_TEST_CASES,
  type TestCasePrompt,
} from '../lib/evaluationTestCases';
import {
  type EvaluationItemResult,
  type EvaluationReport,
  exportEvaluationCsv,
  exportEvaluationJson,
  exportEvaluationPdf,
} from '../lib/evaluationReport';

type TestMode = 'sample' | 'custom';

export const EvaluationPage = () => {
  const modelsQuery = useQuery({ queryKey: ['models'], queryFn: getModels, staleTime: 30_000 });
  const models: Model[] = modelsQuery.data ?? [];

  // Heavy model choices (prefer heavy models, or fallback to first available model)
  const heavyModels = useMemo(() => {
    const heavyOnly = models.filter((m) => m.tier === 'heavy');
    return heavyOnly.length > 0 ? heavyOnly : models;
  }, [models]);

  const [selectedHeavyModel, setSelectedHeavyModel] = useState<string>('');

  useEffect(() => {
    if (!selectedHeavyModel && heavyModels.length > 0 && heavyModels[0]) {
      setSelectedHeavyModel(heavyModels[0].name);
    }
  }, [heavyModels, selectedHeavyModel]);

  // Number of test cases to run
  const [testCount, setTestCount] = useState<number>(10);
  const [testMode, setTestMode] = useState<TestMode>('sample');
  const [customPromptInput, setCustomPromptInput] = useState<string>('');

  // Execution state
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [currentProgress, setCurrentProgress] = useState<{
    currentIdx: number;
    total: number;
    activeBranch: 'router' | 'heavy';
    promptId: string;
    promptPreview: string;
  } | null>(null);

  // In-flight items collected
  const [liveResults, setLiveResults] = useState<EvaluationItemResult[]>([]);
  const [finalReport, setFinalReport] = useState<EvaluationReport | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Parse prompt test cases
  const preparedTestCases = useMemo<TestCasePrompt[]>(() => {
    if (testMode === 'custom') {
      const lines = customPromptInput
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      return lines.map((p, i) => ({
        id: `custom-${i + 1}`,
        category: 'simple',
        expected_tier: 'light',
        prompt: p,
      }));
    }
    return EVALUATION_TEST_CASES.slice(0, testCount);
  }, [testMode, customPromptInput, testCount]);

  // Execute a single chat turn and measure performance
  const runSingleTurn = async (
    prompt: string,
    mode: 'auto' | 'force',
    forcedModel: string | undefined,
    signal: AbortSignal
  ): Promise<{
    meta: MetaEvent;
    done: DoneEvent;
    output: string;
  }> => {
    return new Promise((resolve, reject) => {
      let metaEvent: MetaEvent | null = null;
      let outputText = '';

      streamChat(
        {
          messages: [{ role: 'user', content: prompt }],
          mode,
          ...(forcedModel ? { model: forcedModel } : {}),
          use_cache: false, // Ensure fresh measurement for fair comparison
        },
        {
          onMeta: (event) => {
            metaEvent = event;
          },
          onToken: (event) => {
            outputText += event.text;
          },
          onDone: (doneEvent) => {
            resolve({
              meta: metaEvent ?? {
                request_id: doneEvent.request_id,
                model: forcedModel ?? 'unknown',
                tier: 'heavy',
                score: 1.0,
                intent: 'chat',
                reason: 'Direct run',
                cache: 'bypass',
              },
              done: doneEvent,
              output: outputText,
            });
          },
          onError: (err: ErrorEvent) => {
            reject(new Error(err.message || 'Error occurred in test run.'));
          },
        },
        signal
      ).catch((err) => {
        reject(err);
      });
    });
  };

  const handleStartEvaluation = async () => {
    if (isRunning) return;
    if (preparedTestCases.length === 0) return;

    setIsRunning(true);
    setLiveResults([]);
    setFinalReport(null);

    const abortCtrl = new AbortController();
    abortControllerRef.current = abortCtrl;
    const heavyModelToUse = selectedHeavyModel || heavyModels[0]?.name || 'default-heavy';

    const items: EvaluationItemResult[] = [];

    try {
      for (let i = 0; i < preparedTestCases.length; i++) {
        if (abortCtrl.signal.aborted) break;

        const testCase = preparedTestCases[i];
        if (!testCase) continue;

        // 1. Run Router Auto-Selection
        setCurrentProgress({
          currentIdx: i + 1,
          total: preparedTestCases.length,
          activeBranch: 'router',
          promptId: testCase.id,
          promptPreview: testCase.prompt,
        });

        let routerRes: { meta: MetaEvent; done: DoneEvent; output: string } | null = null;
        let routerError: string | undefined;

        try {
          routerRes = await runSingleTurn(testCase.prompt, 'auto', undefined, abortCtrl.signal);
        } catch (e: unknown) {
          routerError = e instanceof Error ? e.message : 'Router evaluation failed';
        }

        if (abortCtrl.signal.aborted) break;

        // 2. Run Heavy-Only LLM
        setCurrentProgress({
          currentIdx: i + 1,
          total: preparedTestCases.length,
          activeBranch: 'heavy',
          promptId: testCase.id,
          promptPreview: testCase.prompt,
        });

        let heavyRes: { meta: MetaEvent; done: DoneEvent; output: string } | null = null;
        let heavyError: string | undefined;

        try {
          heavyRes = await runSingleTurn(testCase.prompt, 'force', heavyModelToUse, abortCtrl.signal);
        } catch (e: unknown) {
          heavyError = e instanceof Error ? e.message : 'Heavy evaluation failed';
        }

        // Aggregate this item's metrics
        const rUsage = routerRes?.done.usage ?? {
          prompt_tokens: Math.ceil(testCase.prompt.length / 4),
          completion_tokens: routerRes ? Math.ceil(routerRes.output.length / 4) : 0,
          ttft_ms: 0,
          total_ms: 0,
          tokens_per_sec: 0,
          load_ms: 0,
        };

        const hUsage = heavyRes?.done.usage ?? {
          prompt_tokens: Math.ceil(testCase.prompt.length / 4),
          completion_tokens: heavyRes ? Math.ceil(heavyRes.output.length / 4) : 0,
          ttft_ms: 0,
          total_ms: 0,
          tokens_per_sec: 0,
          load_ms: 0,
        };

        const routerLatency = rUsage.total_ms || 1;
        const heavyLatency = hUsage.total_ms || 1;
        const latencySaved = heavyLatency - routerLatency;
        const latencyReductionPct = heavyLatency > 0 ? (latencySaved / heavyLatency) * 100 : 0;

        const routerTotalTokens = rUsage.prompt_tokens + rUsage.completion_tokens;
        const heavyTotalTokens = hUsage.prompt_tokens + hUsage.completion_tokens;
        const tokensDiff = heavyTotalTokens - routerTotalTokens;

        const itemResult: EvaluationItemResult = {
          id: testCase.id,
          prompt: testCase.prompt,
          category: testCase.category,
          router: {
            model: routerRes?.meta.model ?? 'router-model',
            tier: routerRes?.meta.tier ?? 'light',
            intent: routerRes?.meta.intent,
            score: routerRes?.meta.score,
            cache: routerRes?.meta.cache ?? 'miss',
            latency_ms: routerLatency,
            ttft_ms: rUsage.ttft_ms,
            tokens_per_sec: rUsage.tokens_per_sec,
            prompt_tokens: rUsage.prompt_tokens,
            completion_tokens: rUsage.completion_tokens,
            total_tokens: routerTotalTokens,
            output_preview: routerRes?.output.slice(0, 120),
            error: routerError,
          },
          heavy: {
            model: heavyRes?.meta.model ?? heavyModelToUse,
            tier: 'heavy',
            cache: heavyRes?.meta.cache ?? 'miss',
            latency_ms: heavyLatency,
            ttft_ms: hUsage.ttft_ms,
            tokens_per_sec: hUsage.tokens_per_sec,
            prompt_tokens: hUsage.prompt_tokens,
            completion_tokens: hUsage.completion_tokens,
            total_tokens: heavyTotalTokens,
            output_preview: heavyRes?.output.slice(0, 120),
            error: heavyError,
          },
          latency_saved_ms: latencySaved,
          latency_reduction_pct: latencyReductionPct,
          tokens_diff: tokensDiff,
        };

        items.push(itemResult);
        setLiveResults([...items]);
      }

      // Compile final report
      if (items.length > 0) {
        const rep = computeReport(items, heavyModelToUse);
        setFinalReport(rep);
      }
    } catch (err) {
      console.error('Benchmark execution error:', err);
    } finally {
      setIsRunning(false);
      setCurrentProgress(null);
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsRunning(false);
      setCurrentProgress(null);
    }
  };

  const computeReport = (items: EvaluationItemResult[], heavyModel: string): EvaluationReport => {
    const count = items.length;
    const routerSumLatency = items.reduce((acc, it) => acc + it.router.latency_ms, 0);
    const heavySumLatency = items.reduce((acc, it) => acc + it.heavy.latency_ms, 0);

    const routerAvgLatency = routerSumLatency / count;
    const heavyAvgLatency = heavySumLatency / count;

    const routerLatencies = items.map((it) => it.router.latency_ms).sort((a, b) => a - b);
    const heavyLatencies = items.map((it) => it.heavy.latency_ms).sort((a, b) => a - b);

    const p50 = (arr: number[]) => arr[Math.floor(arr.length * 0.5)] ?? 0;

    const latencyReductionPct = heavyAvgLatency > 0
      ? ((heavyAvgLatency - routerAvgLatency) / heavyAvgLatency) * 100
      : 0;

    const routerPromptTok = items.reduce((acc, it) => acc + it.router.prompt_tokens, 0);
    const routerComplTok = items.reduce((acc, it) => acc + it.router.completion_tokens, 0);
    const routerTotalTok = routerPromptTok + routerComplTok;

    const heavyPromptTok = items.reduce((acc, it) => acc + it.heavy.prompt_tokens, 0);
    const heavyComplTok = items.reduce((acc, it) => acc + it.heavy.completion_tokens, 0);
    const heavyTotalTok = heavyPromptTok + heavyComplTok;

    const tokenDiff = heavyTotalTok - routerTotalTok;
    const tokenDiffPct = heavyTotalTok > 0 ? (tokenDiff / heavyTotalTok) * 100 : 0;

    const routerAvgTokSec = items.reduce((acc, it) => acc + it.router.tokens_per_sec, 0) / count;
    const heavyAvgTokSec = items.reduce((acc, it) => acc + it.heavy.tokens_per_sec, 0) / count;

    const tierCounts = { light: 0, code: 0, heavy: 0 };
    items.forEach((it) => {
      const t = it.router.tier as 'light' | 'code' | 'heavy';
      if (tierCounts[t] !== undefined) tierCounts[t]++;
      else tierCounts.light++;
    });

    // Efficiency Score (combines latency savings and intelligent tier offloading)
    const tierOffloadPct = ((tierCounts.light + tierCounts.code) / count) * 100;
    const efficiencyScore = Math.max(
      0,
      Math.min(100, latencyReductionPct * 0.6 + tierOffloadPct * 0.4)
    );

    let verdict = '';
    if (latencyReductionPct > 35) {
      verdict = `Outstanding Efficiency: Router saved ${latencyReductionPct.toFixed(1)}% inference latency and offloaded ${tierOffloadPct.toFixed(0)}% of queries away from heavy VRAM.`;
    } else if (latencyReductionPct > 15) {
      verdict = `Substantial Speedup: Router yielded ${latencyReductionPct.toFixed(1)}% latency advantage over heavy-only execution.`;
    } else if (latencyReductionPct >= 0) {
      verdict = `Moderate Efficiency: Router ran with ${latencyReductionPct.toFixed(1)}% lower latency than pure heavy inference.`;
    } else {
      verdict = `Heavy Model Baseline comparable: Router overhead and queries favored heavy tier routing.`;
    }

    return {
      id: new Date().toISOString().replace(/[:.]/g, '-'),
      created_at: new Date().toISOString(),
      test_count: count,
      heavy_model_used: heavyModel,
      summary: {
        router_avg_latency_ms: routerAvgLatency,
        heavy_avg_latency_ms: heavyAvgLatency,
        latency_reduction_pct: latencyReductionPct,
        router_p50_latency_ms: p50(routerLatencies),
        heavy_p50_latency_ms: p50(heavyLatencies),
        router_total_prompt_tokens: routerPromptTok,
        router_total_completion_tokens: routerComplTok,
        router_total_tokens: routerTotalTok,
        heavy_total_prompt_tokens: heavyPromptTok,
        heavy_total_completion_tokens: heavyComplTok,
        heavy_total_tokens: heavyTotalTok,
        token_usage_diff: tokenDiff,
        token_usage_diff_pct: tokenDiffPct,
        router_avg_tok_per_sec: routerAvgTokSec,
        heavy_avg_tok_per_sec: heavyAvgTokSec,
        tier_counts: tierCounts,
        efficiency_score: efficiencyScore,
        verdict,
      },
      items,
    };
  };

  const activeReport = finalReport ?? (liveResults.length > 0 ? computeReport(liveResults, selectedHeavyModel || 'heavy') : null);

  // Chart data for latency comparison
  const latencyChartData = useMemo(() => {
    if (!activeReport) return [];
    return activeReport.items.slice(0, 15).map((it) => ({
      name: it.id,
      Router: Math.round(it.router.latency_ms),
      'Heavy Only': Math.round(it.heavy.latency_ms),
    }));
  }, [activeReport]);

  // Chart data for token usage comparison
  const tokenChartData = useMemo(() => {
    if (!activeReport) return [];
    return activeReport.items.slice(0, 15).map((it) => ({
      name: it.id,
      'Router Tokens': it.router.total_tokens,
      'Heavy Tokens': it.heavy.total_tokens,
    }));
  }, [activeReport]);

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-heading">
        <div className="page-heading-left">
          <div className="page-heading-tags">
            <p className="eyebrow"><Gauge size={13} /> Performance Lab</p>
            {isRunning ? (
              <span className="live-pill-pulse">
                <Pill tone="success">
                  <Activity size={11} className="spin-icon" /> RUNNING DUAL TEST
                </Pill>
              </span>
            ) : (
              <Pill>READY</Pill>
            )}
          </div>
          <h1 className="page-title">Auto-Router vs Heavy-Only Test Suite</h1>
          <p className="page-description">
            Feed N test cases simultaneously across two execution tracks: one auto-routed across tiers and one forced through the heavy-only LLM. Measure real latency efficiency, token overheads, throughput, and download comprehensive audit reports.
          </p>
        </div>

        {/* Action Controls */}
        <div className="benchmark-toolbar">
          {activeReport && (
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <Button
                className="download-button"
                onClick={() => setShowExportMenu(!showExportMenu)}
              >
                <ArrowDownToLine size={13} /> Export Report ▾
              </Button>
              {showExportMenu && (
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
                    minWidth: 165,
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
                      exportEvaluationPdf(activeReport);
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
                      exportEvaluationCsv(activeReport);
                    }}
                  >
                    <FileCode2 size={13} style={{ color: '#10b981' }} /> Export as CSV / Excel
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
                      exportEvaluationJson(activeReport);
                    }}
                  >
                    <FileJson size={13} style={{ color: '#eab308' }} /> Export as JSON
                  </button>
                </div>
              )}
            </div>
          )}

          {isRunning ? (
            <Button variant="danger" onClick={handleStop}>
              <StopCircle size={13} /> Abort Execution
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={handleStartEvaluation}
              disabled={preparedTestCases.length === 0}
            >
              <Play size={13} fill="currentColor" /> Run Dual Evaluation ({preparedTestCases.length} Cases)
            </Button>
          )}
        </div>
      </div>

      {/* Configuration Bar */}
      <Card style={{ marginBottom: 16 }}>
        <CardBody style={{ padding: '14px 18px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
              {/* Test count selector */}
              <div>
                <label style={{ display: 'block', fontSize: 11, color: 'var(--text-subtle)', marginBottom: 4, fontWeight: 500 }}>
                  Test Cases (N)
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[5, 10, 15, 20, 30].map((n) => (
                    <button
                      key={n}
                      type="button"
                      disabled={isRunning}
                      onClick={() => {
                        setTestMode('sample');
                        setTestCount(n);
                      }}
                      style={{
                        padding: '4px 10px',
                        fontSize: 12,
                        borderRadius: 4,
                        border: testMode === 'sample' && testCount === n ? '1px solid var(--accent)' : '1px solid var(--border)',
                        background: testMode === 'sample' && testCount === n ? 'color-mix(in srgb, var(--accent) 15%, var(--surface-1))' : 'var(--surface-2)',
                        color: testMode === 'sample' && testCount === n ? 'var(--accent)' : 'var(--text)',
                        cursor: isRunning ? 'not-allowed' : 'pointer',
                        fontWeight: testMode === 'sample' && testCount === n ? 600 : 400,
                      }}
                    >
                      {n}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={isRunning}
                    onClick={() => setTestMode(testMode === 'custom' ? 'sample' : 'custom')}
                    style={{
                      padding: '4px 10px',
                      fontSize: 12,
                      borderRadius: 4,
                      border: testMode === 'custom' ? '1px solid var(--accent)' : '1px solid var(--border)',
                      background: testMode === 'custom' ? 'color-mix(in srgb, var(--accent) 15%, var(--surface-1))' : 'var(--surface-2)',
                      color: testMode === 'custom' ? 'var(--accent)' : 'var(--text)',
                      cursor: isRunning ? 'not-allowed' : 'pointer',
                      fontWeight: testMode === 'custom' ? 600 : 400,
                    }}
                  >
                    Custom Prompts
                  </button>
                </div>
              </div>

              {/* Heavy Baseline Selector */}
              <div>
                <label style={{ display: 'block', fontSize: 11, color: 'var(--text-subtle)', marginBottom: 4, fontWeight: 500 }}>
                  Heavy LLM Baseline
                </label>
                <select
                  disabled={isRunning}
                  value={selectedHeavyModel}
                  onChange={(e) => setSelectedHeavyModel(e.target.value)}
                  className="settings-select"
                  style={{ minWidth: 190 }}
                >
                  {heavyModels.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name} ({m.tier})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: 'var(--text-muted)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <Zap size={13} color="var(--accent)" />
                <span>Auto: Multi-tier routing</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <Cpu size={13} color="#a855f7" />
                <span>Baseline: Forced Heavy</span>
              </div>
            </div>
          </div>

          {/* Custom prompts textarea */}
          {testMode === 'custom' && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <label style={{ display: 'block', fontSize: 11, color: 'var(--text-subtle)', marginBottom: 4 }}>
                Enter Custom Test Prompts (one prompt per line):
              </label>
              <textarea
                rows={4}
                value={customPromptInput}
                onChange={(e) => setCustomPromptInput(e.target.value)}
                placeholder="Write a poem about space&#10;Fix this python function: def add(a, b): return a - b&#10;Explain quantum entanglement"
                style={{
                  width: '100%',
                  background: 'var(--surface-1)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-xs)',
                  padding: '8px 12px',
                  color: 'var(--text)',
                  fontSize: 12,
                  fontFamily: 'var(--font-mono)',
                }}
              />
              <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
                {preparedTestCases.length} prompt(s) parsed.
              </span>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Progress Card when running */}
      {isRunning && currentProgress && (
        <Card style={{ marginBottom: 16, border: '1px solid var(--accent)', background: 'color-mix(in srgb, var(--accent) 5%, var(--surface-1))' }}>
          <CardHeader>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)', animation: 'pulse 1s infinite alternate' }} />
              <div>
                <h2 className="card-title" style={{ color: 'var(--accent)' }}>
                  Evaluating Case {currentProgress.currentIdx} of {currentProgress.total}
                </h2>
                <p className="card-subtitle">
                  Currently running: <strong style={{ color: currentProgress.activeBranch === 'router' ? 'var(--accent)' : '#a855f7' }}>
                    {currentProgress.activeBranch === 'router' ? '⚡ Auto-Selection Router' : '🧠 Heavy-Only LLM Baseline'}
                  </strong>
                </p>
              </div>
            </div>
            <Pill tone="success">
              {Math.round(((currentProgress.currentIdx - (currentProgress.activeBranch === 'router' ? 0.5 : 0)) / currentProgress.total) * 100)}% Complete
            </Pill>
          </CardHeader>
          <CardBody>
            <div style={{ width: '100%', height: 8, background: 'var(--surface-2)', borderRadius: 4, overflow: 'hidden', margin: '4px 0 10px' }}>
              <div
                style={{
                  width: `${Math.round(((currentProgress.currentIdx - (currentProgress.activeBranch === 'router' ? 0.5 : 0)) / currentProgress.total) * 100)}%`,
                  height: '100%',
                  background: 'var(--accent)',
                  transition: 'width 250ms ease-out',
                }}
              />
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
              <strong>Prompt:</strong> &ldquo;{currentProgress.promptPreview}&rdquo;
            </div>
          </CardBody>
        </Card>
      )}

      {/* Summary KPI Cards */}
      {activeReport && (
        <>
          <section className="benchmark-banner" style={{ marginBottom: 16 }}>
            <div>
              <div className="section-label">Dual Evaluation Efficiency Verdict</div>
              <p className="benchmark-verdict">{activeReport.summary.verdict}</p>
              <div className="benchmark-meta">
                {activeReport.test_count} test cases evaluated <span className="dot-separator">·</span> Baseline Model: {activeReport.heavy_model_used} <span className="dot-separator">·</span> {new Date(activeReport.created_at).toLocaleTimeString()}
              </div>
            </div>
            <div className="verdict-right">
              <Pill tone="success">
                <CheckCircle2 size={11} /> {activeReport.summary.latency_reduction_pct.toFixed(1)}% Latency Gain
              </Pill>
              <Pill tone="default">
                Score: {activeReport.summary.efficiency_score.toFixed(0)}/100
              </Pill>
            </div>
          </section>

          {/* KPI Bento Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, marginBottom: 16 }}>
            {/* Efficiency / Latency Reduction */}
            <Card>
              <CardBody style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                    Latency Efficiency
                  </span>
                  <TrendingDown size={16} color="var(--accent)" />
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent)' }}>
                  {activeReport.summary.latency_reduction_pct.toFixed(1)}% Faster
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 4 }}>
                  Router avg {formatDuration(activeReport.summary.router_avg_latency_ms)} vs Heavy avg {formatDuration(activeReport.summary.heavy_avg_latency_ms)}
                </p>
              </CardBody>
            </Card>

            {/* Token Usage Difference */}
            <Card>
              <CardBody style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                    Token Usage Difference
                  </span>
                  <Sparkles size={16} color="#38bdf8" />
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)' }}>
                  {Math.abs(activeReport.summary.token_usage_diff)} Tokens
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 4 }}>
                  {activeReport.summary.token_usage_diff >= 0 ? (
                    <span style={{ color: '#10b981' }}>Router consumed {activeReport.summary.token_usage_diff_pct.toFixed(1)}% fewer tokens</span>
                  ) : (
                    <span>Heavy consumed {Math.abs(activeReport.summary.token_usage_diff_pct).toFixed(1)}% fewer tokens</span>
                  )}
                </p>
              </CardBody>
            </Card>

            {/* Generation Throughput */}
            <Card>
              <CardBody style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                    Average Throughput
                  </span>
                  <Activity size={16} color="#10b981" />
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)' }}>
                  {activeReport.summary.router_avg_tok_per_sec.toFixed(1)} tok/s
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 4 }}>
                  vs Heavy {activeReport.summary.heavy_avg_tok_per_sec.toFixed(1)} tok/s baseline
                </p>
              </CardBody>
            </Card>

            {/* Tier Offloading */}
            <Card>
              <CardBody style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                    Workload Distribution
                  </span>
                  <Layers size={16} color="#eab308" />
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                  <div>
                    <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>Light:</span>{' '}
                    <strong style={{ color: 'var(--tier-light)' }}>{activeReport.summary.tier_counts.light}</strong>
                  </div>
                  <div>
                    <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>Code:</span>{' '}
                    <strong style={{ color: 'var(--tier-code)' }}>{activeReport.summary.tier_counts.code}</strong>
                  </div>
                  <div>
                    <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>Heavy:</span>{' '}
                    <strong style={{ color: 'var(--tier-heavy)' }}>{activeReport.summary.tier_counts.heavy}</strong>
                  </div>
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 6 }}>
                  {Math.round(((activeReport.summary.tier_counts.light + activeReport.summary.tier_counts.code) / activeReport.test_count) * 100)}% diverted from heavy tier
                </p>
              </CardBody>
            </Card>
          </div>

          {/* Visual Comparison Charts */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 16, marginBottom: 16 }}>
            {/* Latency Comparison Bar Chart */}
            <Card>
              <CardHeader>
                <div>
                  <h2 className="card-title">Per-Prompt Latency Comparison (ms)</h2>
                  <p className="card-subtitle">Lower is faster · Auto-Router vs Heavy-Only</p>
                </div>
              </CardHeader>
              <CardBody>
                <div style={{ width: '100%', height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={latencyChartData} margin={{ top: 10, right: 10, bottom: 20, left: -10 }}>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 5" vertical={false} />
                      <XAxis dataKey="name" tick={{ fill: 'var(--text-subtle)', fontSize: 10 }} />
                      <YAxis tick={{ fill: 'var(--text-subtle)', fontSize: 10 }} />
                      <Tooltip
                        contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 12 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="Router" fill="var(--accent)" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="Heavy Only" fill="#a855f7" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardBody>
            </Card>

            {/* Token Usage Comparison Bar Chart */}
            <Card>
              <CardHeader>
                <div>
                  <h2 className="card-title">Token Usage Breakdown</h2>
                  <p className="card-subtitle">Total Tokens (Prompt + Completion) by Test Case</p>
                </div>
              </CardHeader>
              <CardBody>
                <div style={{ width: '100%', height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={tokenChartData} margin={{ top: 10, right: 10, bottom: 20, left: -10 }}>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 5" vertical={false} />
                      <XAxis dataKey="name" tick={{ fill: 'var(--text-subtle)', fontSize: 10 }} />
                      <YAxis tick={{ fill: 'var(--text-subtle)', fontSize: 10 }} />
                      <Tooltip
                        contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 12 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="Router Tokens" fill="#38bdf8" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="Heavy Tokens" fill="#ec4899" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardBody>
            </Card>
          </div>

          {/* Detailed Itemized Audit Table */}
          <Card>
            <CardHeader>
              <div>
                <h2 className="card-title">Detailed Test Case Audit Report</h2>
                <p className="card-subtitle">Granular comparison across both tracks for each prompt</p>
              </div>
              <Pill>{activeReport.items.length} Evaluated Cases</Pill>
            </CardHeader>
            <CardBody className="table-card-body">
              <div className="table-scroll">
                <table className="metric-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Prompt</th>
                      <th>Router Model / Tier</th>
                      <th>Router Latency</th>
                      <th>Heavy Latency</th>
                      <th>Saved Latency</th>
                      <th>Router Tokens</th>
                      <th>Heavy Tokens</th>
                      <th>Token Diff</th>
                      <th>Efficiency Gain</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeReport.items.map((item, idx) => (
                      <tr key={item.id}>
                        <td><code>{idx + 1}</code></td>
                        <td style={{ maxWidth: 220 }}>
                          <span className="truncate" title={item.prompt} style={{ display: 'block', maxWidth: 220 }}>
                            {item.prompt}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span className={`tier-badge tier-${item.router.tier}`} style={{ fontSize: 10, padding: '1px 6px' }}>
                              {item.router.tier}
                            </span>
                            <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
                              {item.router.model}
                            </span>
                          </div>
                        </td>
                        <td>{formatDuration(item.router.latency_ms)}</td>
                        <td>{formatDuration(item.heavy.latency_ms)}</td>
                        <td>
                          <span style={{ color: item.latency_saved_ms >= 0 ? '#10b981' : 'var(--text-muted)' }}>
                            {item.latency_saved_ms >= 0 ? `+${formatDuration(item.latency_saved_ms)}` : formatDuration(item.latency_saved_ms)}
                          </span>
                        </td>
                        <td>
                          <span title={`${item.router.prompt_tokens} prompt + ${item.router.completion_tokens} compl`}>
                            {item.router.total_tokens}
                          </span>
                        </td>
                        <td>
                          <span title={`${item.heavy.prompt_tokens} prompt + ${item.heavy.completion_tokens} compl`}>
                            {item.heavy.total_tokens}
                          </span>
                        </td>
                        <td>
                          <span style={{ color: item.tokens_diff >= 0 ? '#10b981' : '#ec4899', fontWeight: 500 }}>
                            {item.tokens_diff > 0 ? `-${item.tokens_diff}` : item.tokens_diff === 0 ? '0' : `+${Math.abs(item.tokens_diff)}`}
                          </span>
                        </td>
                        <td>
                          <span style={{ color: item.latency_reduction_pct >= 20 ? '#10b981' : 'var(--text)' }}>
                            {item.latency_reduction_pct.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        </>
      )}

      {/* Empty State when no evaluation run has occurred */}
      {!activeReport && !isRunning && (
        <Card>
          <EmptyState
            icon={<Gauge size={22} />}
            title="Run Comparative Dual-Track Evaluation"
            description="Select N test cases and click 'Run Dual Evaluation'. Each prompt will be fired through both the auto-selection router and directly into the heavy LLM baseline to compute real speedup, token usage differences, and downloadable reports."
            action={
              <Button
                variant="primary"
                onClick={handleStartEvaluation}
                disabled={preparedTestCases.length === 0}
              >
                <Play size={13} fill="currentColor" /> Start {preparedTestCases.length}-Case Evaluation
              </Button>
            }
          />
        </Card>
      )}
    </div>
  );
};
