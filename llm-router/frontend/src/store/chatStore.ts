import { create } from 'zustand';
import type { components } from '../api/types/api.generated';

type Role = components['schemas']['Role'];
type MetaEvent = components['schemas']['MetaEvent'];
type Usage = components['schemas']['Usage'];
type ErrorEvent = components['schemas']['ErrorEvent'];

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  status: 'complete' | 'streaming' | 'error' | 'stopped';
  meta: MetaEvent | null;
  usage: Usage | null;
  error: ErrorEvent | null;
  createdAt: string;
}

interface ChatState {
  messages: ChatMessage[];
  addMessage: (message: Omit<ChatMessage, 'id' | 'createdAt'>) => string;
  setMeta: (id: string, meta: MetaEvent) => void;
  appendToken: (id: string, text: string) => void;
  finish: (id: string, usage: Usage) => void;
  fail: (id: string, error: ErrorEvent) => void;
  stop: (id: string) => void;
  clear: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  addMessage: (message) => {
    const id = crypto.randomUUID();
    set((state) => ({ messages: [...state.messages, { ...message, id, createdAt: new Date().toISOString() }] }));
    return id;
  },
  setMeta: (id, meta) => set((state) => ({ messages: state.messages.map((item) => item.id === id ? { ...item, meta } : item) })),
  appendToken: (id, text) => set((state) => ({ messages: state.messages.map((item) => item.id === id ? { ...item, content: item.content + text } : item) })),
  finish: (id, usage) => set((state) => ({ messages: state.messages.map((item) => item.id === id ? { ...item, status: 'complete', usage } : item) })),
  fail: (id, error) => set((state) => ({ messages: state.messages.map((item) => item.id === id ? { ...item, status: 'error', error } : item) })),
  stop: (id) => set((state) => ({ messages: state.messages.map((item) => item.id === id ? { ...item, status: 'stopped' } : item) })),
  clear: () => set({ messages: [] }),
}));
