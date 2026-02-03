import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico'],
      workbox: {
        navigateFallback: '/index.html'
      },
      manifest: {
        name: 'LiveGrid',
        short_name: 'LiveGrid',
        description: 'Live NASA session tracker with synced preferences and notifications.',
        start_url: 'https://livegrid.stro.io/',
        display: 'standalone',
        theme_color: '#1f2630',
        background_color: '#1f2630',
        icons: [
          {
            src: 'pwa-icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'pwa-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable any'
          }
        ]
      }
    })
  ],
})
