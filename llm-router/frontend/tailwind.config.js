/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--bg)', surface: 'var(--surface-1)', 'surface-raised': 'var(--surface-2)',
        border: 'var(--border)', foreground: 'var(--text)', muted: 'var(--text-muted)', accent: 'var(--accent)',
      },
      borderRadius: { sm: 'var(--radius-sm)', md: 'var(--radius-md)', lg: 'var(--radius-lg)' },
    },
  },
  plugins: [],
};
