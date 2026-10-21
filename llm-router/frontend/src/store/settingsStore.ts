import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

type Theme = 'dark' | 'light' | 'system';

interface SettingsState {
  theme: Theme;
  bypassCache: boolean;
  previewEnabled: boolean;
  modelMode: 'auto' | 'force';
  selectedModel: string;
  setTheme: (theme: Theme) => void;
  setBypassCache: (bypassCache: boolean) => void;
  setPreviewEnabled: (previewEnabled: boolean) => void;
  setModelMode: (mode: 'auto' | 'force') => void;
  setSelectedModel: (model: string) => void;
}

export const useSettingsStore = create<SettingsState>()(persist((set) => ({
  theme: 'dark',
  bypassCache: false,
  previewEnabled: true,
  modelMode: 'auto',
  selectedModel: '',
  setTheme: (theme) => set({ theme }),
  setBypassCache: (bypassCache) => set({ bypassCache }),
  setPreviewEnabled: (previewEnabled) => set({ previewEnabled }),
  setModelMode: (modelMode) => set({ modelMode }),
  setSelectedModel: (selectedModel) => set({ selectedModel }),
}), { name: 'llm-router-settings', storage: createJSONStorage(() => localStorage), partialize: (state) => ({ theme: state.theme, bypassCache: state.bypassCache, previewEnabled: state.previewEnabled, modelMode: state.modelMode, selectedModel: state.selectedModel }) }));
