import React from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './styles.css'
import { AuthProvider } from './contexts/AuthContext'
import { PreferencesProvider } from './contexts/PreferencesContext'
import { installGlobalTelemetryHandlers } from './telemetry'
import { log } from './logging.js'

if (typeof globalThis !== 'undefined') {
  globalThis.React = React
}

installGlobalTelemetryHandlers(log)

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <PreferencesProvider>
        <App />
      </PreferencesProvider>
    </AuthProvider>
  </React.StrictMode>
)

if (import.meta.env.PROD) {
  registerSW({ immediate: true })
}
