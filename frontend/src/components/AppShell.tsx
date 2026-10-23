import { useState, useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  Bot,
  Moon,
  Network,
  Sun,
  Settings2,
  Plus,
  MessageSquare,
  Trash2,
  Layers,
  PanelLeftOpen,
  Gauge,
} from 'lucide-react';
import { useHealth } from '../hooks/useHealth';
import { useTheme } from '../hooks/useTheme';
import { useSettingsStore } from '../store/settingsStore';
import { useChatStore } from '../store/chatStore';

export const AppShell = () => {
  useTheme();
  const location = useLocation();
  const health = useHealth();
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const messages = useChatStore((state) => state.messages);
  const clearChat = useChatStore((state) => state.clear);

  // Sidebar shrink/extend state (persisted in localStorage)
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem('llm_sidebar_collapsed') === 'true';
  });

  // Mobile sidebar drawer
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem('llm_sidebar_collapsed', String(collapsed));
  }, [collapsed]);

  // Close mobile drawer on route navigation
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const status = health.data?.status ?? (health.isError ? 'unavailable' : 'degraded');
  const nextTheme = theme === 'light' ? 'dark' : 'light';

  // Extract recent prompt session history snippet if messages exist
  const firstUserMessage = messages.find((m) => m.role === 'user')?.content;
  const sessionSnippet = firstUserMessage
    ? firstUserMessage.slice(0, 32) + (firstUserMessage.length > 32 ? '...' : '')
    : 'Current Session';

  return (
    <div className={`app-layout ${collapsed ? 'sidebar-collapsed' : 'sidebar-expanded'}`}>
      {/* Mobile Overlay */}
      {mobileOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Modern Collapsible Sidebar - Empty space click triggers expand/shrink */}
      <aside
        className={`app-sidebar ${mobileOpen ? 'mobile-open' : ''}`}
        onClick={(e) => {
          // If the click occurred directly on an interactive element (button, link, input), let it work normally
          const target = e.target as HTMLElement | null;
          if (target && target.closest('a, button, input, textarea, select')) {
            return;
          }
          // If user clicked anywhere on empty space in the sidebar, toggle collapsed/expanded
          setCollapsed(!collapsed);
        }}
        title={collapsed ? 'Click to expand sidebar' : undefined}
      >
        <div className="sidebar-header">
          {!collapsed ? (
            <Link to="/" className="sidebar-brand" aria-label="LLM Router home">
              <span className="brand-mark">
                <Network size={18} strokeWidth={2.4} />
              </span>
              <div className="brand-text">
                <span className="brand-name">LLM Router</span>
                <span className="brand-badge">Local Engine</span>
              </div>
            </Link>
          ) : (
            <div className="collapsed-header-brand" title="Click to expand sidebar">
              <span className="brand-mark">
                <Network size={18} strokeWidth={2.4} />
              </span>
            </div>
          )}
        </div>

        {/* New Chat Button */}
        <div className="sidebar-action-wrap">
          <Link
            to="/"
            onClick={() => {
              if (messages.length > 0) clearChat();
            }}
            className={`new-chat-btn ${collapsed ? 'collapsed' : ''}`}
            title="Start New Chat"
          >
            <Plus size={16} strokeWidth={2.2} />
            {!collapsed && <span>New Conversation</span>}
          </Link>
        </div>

        {/* Primary Navigation */}
        <div className="sidebar-section">
          {!collapsed && <span className="sidebar-section-title">Navigation</span>}
          <nav className="sidebar-nav" aria-label="Main Navigation">
            <NavLink
              to="/"
              end
              className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
              title="Chat"
            >
              <Bot size={17} />
              {!collapsed && <span>Chat</span>}
              {!collapsed && <span className="sidebar-link-pill">v1</span>}
            </NavLink>

            <NavLink
              to="/insights"
              className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
              title="Registry & System Info"
            >
              <Layers size={17} />
              {!collapsed && <span>Registry & Info</span>}
            </NavLink>

            <NavLink
              to="/dashboard"
              className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
              title="Observability Dashboard"
            >
              <Activity size={17} />
              {!collapsed && <span>Analytics</span>}
            </NavLink>

            <NavLink
              to="/benchmark"
              className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
              title="Model Benchmarks"
            >
              <BarChart3 size={17} />
              {!collapsed && <span>Benchmarks</span>}
            </NavLink>

            <NavLink
              to="/evaluation"
              className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
              title="Dual Test Suite (Auto vs Heavy)"
            >
              <Gauge size={17} />
              {!collapsed && <span>Test Suite</span>}
              {!collapsed && <span className="sidebar-link-pill" style={{ color: 'var(--accent)' }}>A/B</span>}
            </NavLink>
          </nav>
        </div>

        {/* Conversations / Recent Sessions */}
        {!collapsed && (
          <div className="sidebar-section sidebar-history-section">
            <div className="sidebar-section-title-row">
              <span className="sidebar-section-title">Active Session</span>
              {messages.length > 0 && (
                <button
                  type="button"
                  className="clear-history-btn"
                  onClick={clearChat}
                  title="Clear current conversation"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>

            <div className="sidebar-history-list">
              <Link to="/" className="sidebar-history-item active">
                <MessageSquare size={13} />
                <span className="truncate">{sessionSnippet}</span>
                <span className="session-msg-count">{messages.length}</span>
              </Link>
            </div>
          </div>
        )}

        {/* System Status and Hardware Pill (when expanded) */}
        {!collapsed && (
          <div className="sidebar-system-card">
            <div className="system-card-header">
              <span className={`status-indicator-dot ${status === 'healthy' ? 'healthy' : status === 'degraded' ? 'degraded' : 'offline'}`} />
              <span className="system-status-title">
                {status === 'healthy' ? 'Ollama Online' : status === 'degraded' ? 'Degraded Gateway' : 'Router Offline'}
              </span>
            </div>
            <p className="system-card-meta">Local inference · Zero cloud outbound</p>
          </div>
        )}

        {/* Footer / User Profile & Settings */}
        <div className="sidebar-footer">
          <NavLink
            to="/settings"
            className={({ isActive }) => `sidebar-link footer-link ${isActive ? 'active' : ''}`}
            title="Settings"
          >
            <Settings2 size={17} />
            {!collapsed && <span>Settings</span>}
          </NavLink>

          <button
            type="button"
            className="sidebar-link footer-link theme-button"
            onClick={() => setTheme(nextTheme)}
            title={`Switch to ${nextTheme} mode`}
            aria-label={`Switch to ${nextTheme} mode`}
          >
            {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
            {!collapsed && <span>{theme === 'light' ? 'Dark Mode' : 'Light Mode'}</span>}
          </button>

          {!collapsed && (
            <div className="sidebar-legal-links">
              <Link to="/privacy">Privacy</Link>
              <span>·</span>
              <Link to="/terms">Terms</Link>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="app-main-viewport">
        {/* Mobile Top Header */}
        <header className="mobile-header">
          <button
            type="button"
            className="mobile-menu-trigger"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation menu"
          >
            <PanelLeftOpen size={20} />
          </button>
          <div className="mobile-brand-title">
            <Network size={16} className="text-accent" />
            <span>LLM Router</span>
          </div>
          <button
            type="button"
            className="mobile-theme-trigger"
            onClick={() => setTheme(nextTheme)}
            aria-label="Toggle theme"
          >
            {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
          </button>
        </header>

        <main className="content-scroll-container">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
