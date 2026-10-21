import { useEffect } from 'react';
import { useSettingsStore } from '../store/settingsStore';

export const useTheme = (): void => {
  const theme = useSettingsStore((state) => state.theme);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const apply = (): void => {
      const resolved = theme === 'system' ? (media.matches ? 'light' : 'dark') : theme;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
};
