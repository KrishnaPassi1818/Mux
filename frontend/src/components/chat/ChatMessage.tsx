import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import rehypeHighlight from 'rehype-highlight';
import { Bot, Check, Copy, UserRound } from 'lucide-react';
import type { ChatMessage as ChatMessageModel } from '../../store/chatStore';
import { formatRelativeTime } from '../../lib/format';
import { RouteBadge } from './RouteBadge';
import { CacheBadge } from './CacheBadge';
import { UsageFooter } from './UsageFooter';
import { ErrorBanner } from '../ui/ErrorBanner';

export const ChatMessage = ({ message }: { message: ChatMessageModel }) => {
  const [copied, setCopied] = useState(false);
  const assistant = message.role === 'assistant';
  const copyMessage = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1300);
    } catch {
      setCopied(false);
    }
  };

  return (
    <article className={`chat-message ${assistant ? `message-assistant${message.meta?.cache === 'hit' ? ' cached' : ''}` : 'message-user'}`}>
      <div className={`message-avatar ${assistant ? 'assistant' : ''}`} aria-hidden="true">{assistant ? <Bot size={15} /> : <UserRound size={15} />}</div>
      <div className="message-content">
        <div className="message-topline">
          <span className="message-author">{assistant ? 'Router assistant' : 'You'} <span className="message-time">· {formatRelativeTime(message.createdAt)}</span></span>
          {message.content && <div className="message-tools"><button className="icon-button tiny-icon-button" type="button" onClick={() => void copyMessage()} aria-label="Copy message" title="Copy message">{copied ? <Check size={13} /> : <Copy size={13} />}</button></div>}
        </div>
        {assistant && message.meta && <div className="message-badges"><RouteBadge meta={message.meta} /><CacheBadge meta={message.meta} ttftMs={message.usage?.ttft_ms} /></div>}
        {message.content ? <div className="message-text">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize, rehypeHighlight]} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{message.content}</ReactMarkdown>
          {message.status === 'streaming' && <span className="stream-caret" aria-hidden="true" />}
        </div> : assistant && message.status === 'streaming' ? <div className="thinking-line"><span className="thinking-pulse" />{message.meta ? `Generating with ${message.meta.model}…` : 'Classifying prompt and selecting a local model…'}</div> : null}
        {assistant && message.status === 'error' && message.error && <div className="inline-chat-error"><ErrorBanner title={message.error.code} message={message.error.message} requestId={message.error.request_id} /></div>}
        {assistant && message.status === 'stopped' && <p className="stopped-copy">Generation stopped.</p>}
        {assistant && message.usage && <UsageFooter usage={message.usage} />}
      </div>
    </article>
  );
};
