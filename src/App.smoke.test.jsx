import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { AuthProvider } from './contexts/AuthContext'
import { PreferencesProvider } from './contexts/PreferencesContext'

vi.mock('./firebaseClient', () => ({
  auth: null,
  firestore: null,
  functions: null,
  isFirebaseConfigured: false,
  ensureFirestorePersistence: () => Promise.resolve()
}))

describe('App smoke', () => {
  beforeAll(() => {
    globalThis.fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : input?.url || ''
      if (url.includes('cached-events')) {
        return {
          ok: true,
          json: async () => ({ events: [] })
        }
      }
      if (url.endsWith('schedule.csv') || url.includes('/test-schedules/')) {
        return {
          ok: true,
          text: async () => 'Time,HPDE 1\n8:00 AM,HPDE 1\n'
        }
      }
      return {
        ok: false,
        status: 404,
        text: async () => 'not found'
      }
    })
  })

  beforeEach(() => {
    window.localStorage.clear()
  })

  it('renders without crashing and shows the sessions header', async () => {
    const { default: App } = await import('./App')
    render(
      <AuthProvider>
        <PreferencesProvider>
          <App />
        </PreferencesProvider>
      </AuthProvider>
    )
    expect(await screen.findByText('Sessions')).toBeInTheDocument()
  })
})
