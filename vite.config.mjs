import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

function manualChunks(id) {
  const normalized = id.replace(/\\/g, '/')
  if (!normalized.includes('/node_modules/')) return undefined

  if (normalized.includes('/node_modules/react/') || normalized.includes('/node_modules/react-dom/')) {
    return 'react'
  }
  if (normalized.includes('/node_modules/firebase/') || normalized.includes('/node_modules/@firebase/')) {
    return 'firebase'
  }
  if (normalized.includes('/node_modules/papaparse/') || normalized.includes('/node_modules/fast-xml-parser/')) {
    return 'schedule'
  }
  if (
    normalized.includes('/node_modules/react-icons/') ||
    normalized.includes('/node_modules/react-pro-sidebar/') ||
    normalized.includes('/node_modules/viewportify/')
  ) {
    return 'ui'
  }
  return 'vendor'
}

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
        description: 'Live track day session tracker with synced preferences and notifications.',
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
  build: {
    rollupOptions: {
      output: {
        manualChunks
      }
    }
  }
})
