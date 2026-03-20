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
  let fetchMock

  beforeAll(() => {
    fetchMock = vi.fn(async (input) => {
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
    globalThis.fetch = fetchMock
  })

  beforeEach(() => {
    window.localStorage.clear()
    fetchMock.mockClear()
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

  it('does not load schedule.csv outside demo mode when a stale csv preference exists', async () => {
    window.localStorage.setItem(
      'nasaDashboardPrefs',
      JSON.stringify({
        selectedCsvFile: 'schedule.csv'
      })
    )

    const { default: App } = await import('./App')
    render(
      <AuthProvider>
        <PreferencesProvider>
          <App />
        </PreferencesProvider>
      </AuthProvider>
    )

    expect(await screen.findByText('Sessions')).toBeInTheDocument()

    const requestedUrls = fetchMock.mock.calls.map(([input]) => (
      typeof input === 'string' ? input : input?.url || ''
    ))
    expect(requestedUrls.some(url => url.endsWith('schedule.csv'))).toBe(false)
    expect(requestedUrls.some(url => url.includes('/test-schedules/'))).toBe(false)
  })
})
