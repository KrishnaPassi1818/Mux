import type { ChatRequest, DoneEvent, ErrorEvent, MetaEvent, TokenEvent } from './client';
import { ApiError } from './client';

export interface ChatStreamHandlers {
  onMeta: (event: MetaEvent) => void;
  onToken: (event: TokenEvent) => void;
  onDone: (event: DoneEvent) => void;
  onError: (event: ErrorEvent) => void;
}

interface SseFrame { event: string; data: string }

/** Parse one complete SSE frame, ignoring comments and malformed lines safely. */
export const parseSseFrame = (source: string): SseFrame | null => {
  const lines = source.replace(/\r\n/gu, '\n').replace(/\r/gu, '\n').split('\n');
  let event = 'message';
  const data: string[] = [];
  for (const line of lines) {
    if (line.startsWith(':') || line.length === 0) continue;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /u, '');
    if (field === 'event') event = value;
    if (field === 'data') data.push(value);
  }
  return data.length ? { event, data: data.join('\n') } : null;
};

/** POST + ReadableStream SSE parser; handles arbitrary chunk boundaries, CRLF, comments and abort. */
export const streamChat = async (
  request: ChatRequest,
  handlers: ChatStreamHandlers,
  signal: AbortSignal,
): Promise<void> => {
  const apiBase = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';
  const response = await fetch(`${apiBase.replace(/\/$/u, '')}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { code?: string; message?: string; request_id?: string } } | null;
    throw new ApiError(payload?.error?.message ?? `Request failed with HTTP ${response.status}.`, payload?.error?.code ?? 'INTERNAL', response.status, payload?.error?.request_id);
  }
  if (!response.body) throw new ApiError('The server returned an empty stream.', 'UPSTREAM_UNAVAILABLE', response.status);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let terminal = false;
  const dispatch = (frameText: string): void => {
    const frame = parseSseFrame(frameText);
    if (!frame) return;
    let data: unknown;
    try { data = JSON.parse(frame.data) as unknown; } catch { return; }
    switch (frame.event) {
      case 'meta': handlers.onMeta(data as MetaEvent); break;
      case 'token': handlers.onToken(data as TokenEvent); break;
      case 'done': terminal = true; handlers.onDone(data as DoneEvent); break;
      case 'error': terminal = true; handlers.onError(data as ErrorEvent); break;
      default: break;
    }
  };

  try {
    while (!terminal) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let separator = buffer.search(/\r?\n\r?\n/u);
      while (separator >= 0) {
        const frame = buffer.slice(0, separator);
        const separatorLength = buffer.slice(separator).startsWith('\r\n\r\n') ? 4 : 2;
        buffer = buffer.slice(separator + separatorLength);
        dispatch(frame);
        if (terminal) break;
        separator = buffer.search(/\r?\n\r?\n/u);
      }
      if (done) {
        if (buffer.trim()) dispatch(buffer);
        break;
      }
    }
  } finally {
    if (signal.aborted) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (!terminal && !signal.aborted) throw new ApiError('The stream ended before a terminal event was received.', 'UPSTREAM_UNAVAILABLE', response.status);
};
