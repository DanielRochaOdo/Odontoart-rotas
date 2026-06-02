import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  envPrefix: ['VITE_'],
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon-v4.ico',
        'favicon-pin.svg',
        'favicon-16x16-v4.png',
        'favicon-32x32-v4.png',
        'apple-touch-icon-v4.png',
        'pin-192x192-v4.png',
        'pin-512x512-v4.png',
      ],
      manifest: {
        id: '/?app=odontoart-agenda-v4',
        name: 'Odontoart Agenda+',
        short_name: 'Odontoart',
        description: 'Gestao interna de agenda e rotas comerciais',
        lang: 'pt-BR',
        theme_color: '#0c6f3d',
        background_color: '#f3fbf6',
        display: 'standalone',
        scope: '/',
        start_url: '/?source=pwa-v4',
        icons: [
          {
            src: '/pin-192x192-v4.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pin-512x512-v4.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pin-512x512-v4.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable any',
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallbackAllowlist: [/^\/.*$/],
      },
    }),
  ],
})
