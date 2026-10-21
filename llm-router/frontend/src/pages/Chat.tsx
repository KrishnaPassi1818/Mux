import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDown,
  Code2,
  Layers,
  LockKeyhole,
  RotateCcw,
  Sparkles,
  Zap,
  ChevronDown,
  SlidersHorizontal,
  X
} from 'lucide-react';
import { getModels, previewRoute, type ChatRequest, type ErrorEvent, type Model, type RouteDecision } from '../api/client';
import { streamChat } from '../api/sse';
import { ChatMessage } from '../components/chat/ChatMessage';
import { PromptInput } from '../components/chat/PromptInput';
import { useChatStore } from '../store/chatStore';
import { useSettingsStore } from '../store/settingsStore';
import { ApiError } from '../api/client';

const emptyModels: Model[] = [];

// Interactive template suggestions inspired by Morva LLM / modern AI landing designs
const promptTemplates = [
  {
    category: 'System & Architecture',
    title: 'Explain NVMe vs RAM caching',
    prompt: 'What is the architectural difference between RAM and persistent NVMe storage in high-throughput local AI caching?',
    tier: 'light',
    icon: <Zap size={15} />
  },
  {
    category: 'Coding & Logic',
    title: 'Python palindrome checker with tests',
    prompt: 'Write a Python function to check whether a string is a palindrome, ignoring non-alphanumeric characters, with comprehensive pytest unit tests.',
    tier: 'code',
    icon: <Code2 size={15} />
  },
  {
    category: 'Distributed Systems',
    title: 'Compare Monolith vs Microservices',
    prompt: 'Compare the operational tradeoffs of monolithic and modular microservice architectures when running private AI inference pipelines.',
    tier: 'heavy',
    icon: <Layers size={15} />
  },
  {
    category: 'Optimization',
    title: 'Ollama local quantization guide',
    prompt: 'Explain the difference between Q4_K_M and Q8_0 Ollama GGUF quantizations regarding VRAM footprint and token generation throughput.',
    tier: 'light',
    icon: <Sparkles size={15} />
  }
];

const tierLabel = (tier: RouteDecision['tier']): string =>
  tier === 'light' ? 'Light' : tier === 'code' ? 'Code' : 'Heavy';

const tierIcon = (tier: RouteDecision['tier']) =>
  tier === 'light' ? <Zap size={13} /> : tier === 'code' ? <Code2 size={13} /> : <Layers size={13} />;

const contractErrorCode = (code?: string): ErrorEvent['code'] => {
  switch (code) {
    case 'INVALID_REQUEST': case 'RATE_LIMITED': case 'UPSTREAM_TIMEOUT': case 'UPSTREAM_UNAVAILABLE':
    case 'MODEL_NOT_FOUND': case 'QUEUE_FULL': case 'INTERNAL': return code;
    default: return 'UPSTREAM_UNAVAILABLE';
  }
};

export const ChatPage = () => {
  const messages = useChatStore((state) => state.messages);
  const addMessage = useChatStore((state) => state.addMessage);
  const setMeta = useChatStore((state) => state.setMeta);
  const appendToken = useChatStore((state) => state.appendToken);
  const finish = useChatStore((state) => state.finish);
  const fail = useChatStore((state) => state.fail);
  const stop = useChatStore((state) => state.stop);
  const clear = useChatStore((state) => state.clear);

  const bypassCache = useSettingsStore((state) => state.bypassCache);
  const setBypassCache = useSettingsStore((state) => state.setBypassCache);
  const previewEnabled = useSettingsStore((state) => state.previewEnabled);
  const modelMode = useSettingsStore((state) => state.modelMode);
  const setModelMode = useSettingsStore((state) => state.setModelMode);
  const selectedModel = useSettingsStore((state) => state.selectedModel);
  const setSelectedModel = useSettingsStore((state) => state.setSelectedModel);

  const [draft, setDraft] = useState('');
  const [preview, setPreview] = useState<RouteDecision | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [jumpLatest, setJumpLatest] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);

  const modelQuery = useQuery({
    queryKey: ['models'],
    queryFn: getModels,
    staleTime: 30_000,
    refetchInterval: 30_000
  });

  const models = modelQuery.data ?? emptyModels;
  const modelChoices = useMemo(() => models.filter((m) => m.available || m.loaded), [models]);
  const activeStream = messages.some((m) => m.role === 'assistant' && m.status === 'streaming');

  const previewMessages = useMemo(
    () => (draft.trim() ? [{ role: 'user' as const, content: draft.trim() }] : []),
    [draft]
  );

  useEffect(() => {
    if (!previewEnabled || previewMessages.length === 0 || (modelMode === 'force' && !selectedModel)) {
      setPreview(null);
      setPreviewError(false);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void previewRoute(previewMessages, modelMode, modelMode === 'force' ? selectedModel : undefined)
        .then((result) => {
          if (active) {
            setPreview(result);
            setPreviewError(false);
          }
        })
        .catch(() => {
          if (active) {
            setPreview(null);
            setPreviewError(true);
          }
        });
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [modelMode, previewEnabled, previewMessages, selectedModel]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (nearBottomRef.current) {
      element.scrollTop = element.scrollHeight;
      setJumpLatest(false);
    } else {
      setJumpLatest(true);
    }
  }, [messages]);

  const stopStream = (): void => {
    abortRef.current?.abort();
    abortRef.current = null;
    const currentAssistant = [...useChatStore.getState().messages]
      .reverse()
      .find((m) => m.role === 'assistant' && m.status === 'streaming');
    if (currentAssistant) stop(currentAssistant.id);
  };

  const submit = async (): Promise<void> => {
    const content = draft.trim();
    if (!content || activeStream || new TextEncoder().encode(content).length > 32768) return;
    setDraft('');

    const userId = addMessage({ role: 'user', content, status: 'complete', meta: null, usage: null, error: null });
    const assistantId = addMessage({ role: 'assistant', content: '', status: 'streaming', meta: null, usage: null, error: null });

    // Filter history to exclude error/stopped messages or empty messages so invalid turns are not resent
    const history = [
      ...messages.filter((m) => m.status === 'complete' && m.content.trim().length > 0),
      { id: userId, role: 'user' as const, content },
    ].map(({ role, content: text }) => ({
      role,
      content: text,
    }));

    const controller = new AbortController();
    abortRef.current = controller;

    const isForceMode = modelMode === 'force' && Boolean(selectedModel);
    const body: ChatRequest = {
      messages: history,
      mode: isForceMode ? 'force' : 'auto',
      ...(isForceMode && selectedModel ? { model: selectedModel } : {}),
      options: { temperature: 0.2, top_p: 0.9, num_ctx: 4096 },
      use_cache: !bypassCache,
    };

    try {
      await streamChat(
        body,
        {
          onMeta: (event) => setMeta(assistantId, event),
          onToken: (event) => appendToken(assistantId, event.text),
          onDone: (event) => finish(assistantId, event.usage),
          onError: (event) => fail(assistantId, event),
        },
        controller.signal
      );
    } catch (error) {
      if (controller.signal.aborted) {
        stop(assistantId);
      } else {
        const apiError = error instanceof ApiError ? error : null;
        fail(assistantId, {
          code: contractErrorCode(apiError?.code),
          message: apiError?.message ?? 'The router is unreachable. Check that the gateway is running.',
          request_id: apiError?.requestId ?? crypto.randomUUID(),
        });
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const clearChat = (): void => {
    if (!activeStream) clear();
  };

  return (
    <div className="minimal-chat-container">
      {/* Top Bar inside Chat View */}
      <div className="minimal-chat-header">
        <div className="header-model-pill">
          <div className="header-model-indicator">
            <span className="live-dot" />
            <span className="header-model-text">
              {modelMode === 'auto' ? 'Auto Router Active' : `Forced: ${selectedModel || 'Select Model'}`}
            </span>
          </div>

          {/* Quick Model Selector Dropdown */}
          <div className="model-select-wrapper">
            <select
              className="model-select-clean"
              value={modelMode === 'auto' ? 'auto' : selectedModel || 'auto'}
              onChange={(e) => {
                const val = e.target.value;
                if (val === 'auto') {
                  setModelMode('auto');
                } else {
                  setModelMode('force');
                  setSelectedModel(val);
                }
              }}
              aria-label="Model routing mode"
            >
              <option value="auto">✨ Auto Dynamic Router</option>
              {modelChoices.map((m) => (
                <option key={m.name} value={m.name}>
                  {tierLabel(m.tier)} · {m.name}
                </option>
              ))}
            </select>
            <ChevronDown size={13} className="select-arrow" />
          </div>
        </div>

        <div className="header-actions">
          <button
            type="button"
            className="config-toggle-btn"
            onClick={() => setShowConfigModal(!showConfigModal)}
            title="Chat Parameters & Routing Config"
          >
            <SlidersHorizontal size={14} />
            <span className="hidden-sm">Parameters</span>
          </button>

          {messages.length > 0 && (
            <button
              type="button"
              className="chat-action-btn"
              disabled={activeStream}
              onClick={clearChat}
              title="Reset conversation"
            >
              <RotateCcw size={14} />
              <span className="hidden-sm">Clear</span>
            </button>
          )}
        </div>
      </div>

      {/* Floating Parameters Panel if toggled */}
      {showConfigModal && (
        <div className="config-drawer">
          <div className="config-drawer-header">
            <h4>Inference Parameters</h4>
            <button
              type="button"
              className="icon-button tiny-icon-button"
              onClick={() => setShowConfigModal(false)}
            >
              <X size={14} />
            </button>
          </div>
          <div className="config-drawer-body">
            <label className="config-row-checkbox">
              <input
                type="checkbox"
                checked={bypassCache}
                onChange={(e) => setBypassCache(e.target.checked)}
              />
              <div>
                <strong>Bypass Redis Cache</strong>
                <p>Force model inference on every prompt even if previously cached.</p>
              </div>
            </label>

            <div className="config-item">
              <span className="config-label">Model Routing Mode</span>
              <div className="mode-toggle-group">
                <button
                  type="button"
                  className={`mode-btn ${modelMode === 'auto' ? 'active' : ''}`}
                  onClick={() => setModelMode('auto')}
                >
                  Auto Classify
                </button>
                <button
                  type="button"
                  className={`mode-btn ${modelMode === 'force' ? 'active' : ''}`}
                  onClick={() => {
                    setModelMode('force');
                    if (!selectedModel && modelChoices[0]) setSelectedModel(modelChoices[0].name);
                  }}
                >
                  Manual Pin
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Conversation Stream or Minimal Landing Hero */}
      <div
        className="minimal-scroll-area"
        ref={scrollRef}
        role="log"
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          nearBottomRef.current = near;
          if (near) setJumpLatest(false);
        }}
      >
        {messages.length === 0 ? (
          <div className="minimal-hero">
            <div className="minimal-hero-sparkle">
              <Sparkles size={28} strokeWidth={1.8} />
            </div>
            <h1 className="minimal-hero-title">Where knowledge begins.</h1>
            <p className="minimal-hero-subtitle">
              Ask any question, generate code, or design architecture. The local router automatically selects the ideal local model.
            </p>

            {/* Prompt Template Cards */}
            <div className="minimal-templates-grid">
              {promptTemplates.map((item) => (
                <button
                  key={item.title}
                  type="button"
                  className="template-card"
                  onClick={() => setDraft(item.prompt)}
                >
                  <div className="template-card-top">
                    <span className="template-icon">{item.icon}</span>
                    <span className="template-category">{item.category}</span>
                  </div>
                  <h3 className="template-title">{item.title}</h3>
                  <p className="template-snippet">{item.prompt}</p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="chat-thread">
            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}
          </div>
        )}
      </div>

      {jumpLatest && (
        <button
          className="jump-latest-floating"
          type="button"
          onClick={() => {
            if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            nearBottomRef.current = true;
            setJumpLatest(false);
          }}
        >
          <ArrowDown size={14} /> Back to bottom
        </button>
      )}

      {/* Floating Centered Modern Composer (ChatGPT / Gemini / Claude Style) */}
      <div className="minimal-composer-outer">
        <div className="minimal-composer-box">
          {/* Subtle Live Route Preview Pill right above/inside input */}
          {draft.trim() && preview && (
            <div className="composer-live-pill">
              <span className={`route-tier-chip tier-${preview.tier}`}>
                {tierIcon(preview.tier)} {tierLabel(preview.tier)}
              </span>
              <span className="route-model-name">{preview.model}</span>
              <span className="route-score-badge">Score {preview.score}/100</span>
            </div>
          )}
          {draft.trim() && previewError && (
            <div className="composer-live-pill" style={{ opacity: 0.7 }}>
              <span className="route-model-name">Preview unavailable</span>
            </div>
          )}

          <PromptInput
            value={draft}
            onChange={setDraft}
            onSubmit={() => void submit()}
            onStop={stopStream}
            streaming={activeStream}
            disabled={modelMode === 'force' && !selectedModel}
          />

          <div className="minimal-composer-footer">
            <span className="composer-privacy-tag">
              <LockKeyhole size={11} /> 100% on-device private inference
            </span>
            <span className="composer-char-count">
              {draft.length > 0 && `${draft.length} chars`}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
