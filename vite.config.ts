import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// The web app is served by the local quickdo server on 127.0.0.1:7777 (see src/server).
// `vite` (dev) proxies /api to a running server; `vite build` emits dist/web which the server serves.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/*.png', 'icon.svg'],
      manifest: {
        name: 'Quickdo',
        short_name: 'Quickdo',
        description: 'Keyboard-first todo list with a science-based daily method built in.',
        start_url: '/',
        display: 'standalone',
        background_color: '#f6f7f4',
        theme_color: '#0f6e63',
        icons: [
          { src: '/icons/192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/oauth\//],
        globPatterns: ['**/*.{js,css,html,svg,png,json}'],
        runtimeCaching: [],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: { outDir: 'dist/web', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:7777', changeOrigin: false } },
  },
});
