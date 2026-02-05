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
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [
          /^\/__\/auth\//,
          /^\/__\/firebase\//
        ]
      },
      manifest: {
        name: 'LiveGrid',
        short_name: 'LiveGrid',
        description: 'Live NASA session tracker with synced preferences and notifications.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#1f2630',
        background_color: '#1f2630',
        icons: [
          {
            src: 'livegrid-icon.png',
            sizes: '559x560',
            type: 'image/png'
          },
          {
            src: 'livegrid-icon-maskable.png',
            sizes: '808x810',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ],
})
