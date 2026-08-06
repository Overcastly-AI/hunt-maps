import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // The app shell is precached so a cold start with no signal still boots.
      // Map tiles are deliberately NOT precached here — they live in the OPFS
      // tile store, which the user fills explicitly per region. Letting the
      // service worker hoover up every tile the user happens to pan over would
      // fill their storage quota invisibly and then evict the regions they
      // actually chose to save.
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        runtimeCaching: [
          {
            // API reads: network first, but serve the last good response when
            // offline so the property, stands and sign are all still there.
            urlPattern: /\/api\/(properties|waypoints|observations|filters)/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'ridgeline-api',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
      manifest: {
        name: 'Ridgeline — Hunting Terrain Analytics',
        short_name: 'Ridgeline',
        description:
          'LiDAR terrain analysis, saved slope filters and movement corridors — offline first.',
        theme_color: '#0f1216',
        background_color: '#0f1216',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@hunt-maps/terrain': resolve(__dirname, '../../packages/terrain/src/index.ts'),
      '@hunt-maps/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL ?? 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  worker: {
    format: 'es',
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
