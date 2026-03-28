import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { getFirebaseClientHealth } from './scripts/firebaseEnvRequirements.mjs'

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

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch (err) {
    return null
  }
}

function buildHealthAssetPlugin(buildEnv) {
  const packageJson = readJson(resolve(process.cwd(), 'package.json')) || {}
  const buildJson = readJson(resolve(process.cwd(), 'build.json')) || {}

  return {
    name: 'livegrid-health-asset',
    generateBundle() {
      const { ok, missingKeys } = getFirebaseClientHealth(buildEnv)
      const payload = {
        status: ok ? 'ok' : 'degraded',
        generatedAt: new Date().toISOString(),
        version: buildJson.version || packageJson.version || '0.0.0',
        checks: {
          firebaseClientConfig: {
            status: ok ? 'ok' : 'degraded',
            missingKeys
          }
        }
      }

      this.emitFile({
        type: 'asset',
        fileName: 'healthz.json',
        source: `${JSON.stringify(payload, null, 2)}\n`
      })
    }
  }
}

export default defineConfig(({ mode }) => {
  const buildEnv = {
    ...process.env,
    ...loadEnv(mode, process.cwd(), '')
  }

  return {
    plugins: [
      react(),
      buildHealthAssetPlugin(buildEnv),
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
  }
})
