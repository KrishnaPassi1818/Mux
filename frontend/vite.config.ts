import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

interface ViteDefaults {
  dev_server: { host: string; port: number; gateway_url: string };
  preview_server: { host: string; port: number };
}
const here = dirname(fileURLToPath(import.meta.url));
const viteDefaults = parse(readFileSync(resolve(here, '../config/frontend.yaml'), 'utf8')) as ViteDefaults;

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, resolve(here, '..'), '');
  const devHost = environment.VITE_DEV_HOST ?? viteDefaults.dev_server.host;
  const devPort = Number(environment.VITE_DEV_PORT ?? viteDefaults.dev_server.port);
  const previewHost = environment.VITE_PREVIEW_HOST ?? viteDefaults.preview_server.host;
  const previewPort = Number(environment.VITE_PREVIEW_PORT ?? viteDefaults.preview_server.port);
  const gatewayUrl = environment.VITE_GATEWAY_URL ?? viteDefaults.dev_server.gateway_url;

  return {
    plugins: [react(), tailwindcss()],
    envDir: resolve(here, '..'),
    server: {
      host: devHost,
      port: devPort,
      strictPort: true,
      allowedHosts: true,
      proxy: {
        '/api': { target: gatewayUrl, changeOrigin: true },
      },
    },
    preview: { host: previewHost, port: previewPort, allowedHosts: true },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('/node_modules/recharts/') || id.includes('/node_modules/d3-')) return 'charts';
            if (id.includes('/node_modules/react-markdown/') || id.includes('/node_modules/rehype-') || id.includes('/node_modules/remark-')) return 'markdown';
            if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/') || id.includes('/node_modules/scheduler/')) return 'react-vendor';
            return undefined;
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      css: true,
      globals: true,
    },
  };
});
