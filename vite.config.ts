import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// BASE_PATH is set by the GitHub Pages workflow (e.g. "/uniffy/").
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  // WASM-only ONNX Runtime build: smaller, and we never load the WebGPU binaries.
  resolve: { alias: [{ find: /^onnxruntime-web$/, replacement: 'onnxruntime-web/wasm' }] },
  worker: { format: 'es' },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'uniffy — 단위 렌즈',
        short_name: 'uniffy',
        description: '찍으면 lb·°F·inch가 kg·°C·cm로 바뀌어 보이는 카메라',
        lang: 'ko',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b0d10',
        theme_color: '#0b0d10',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        // App shell is precached; the big OCR files (~30MB of models + WASM) are
        // cached on first use.
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,webmanifest}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        globIgnores: ['ocr/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/ocr/') || url.pathname.endsWith('.wasm'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'uniffy-ocr',
              expiration: { maxEntries: 10 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
