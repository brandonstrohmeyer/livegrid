import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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

function buildSheetsTabResponse() {
  return {
    spreadsheetTitle: 'Test Weekend',
    tabs: [{ sheetId: 123, title: 'Saturday' }]
  }
}

function buildSheetsValuesResponse() {
  return {
    spreadsheetTitle: 'Test Weekend',
    sheetTitle: 'Saturday',
    headers: ['Time', 'Duration', 'Session', 'Classroom', 'Notes'],
    rows: [
      ['Saturday', '', '', '', ''],
      ['8:00 AM', '20', 'HPDE 1', '', ''],
      ['8:20 AM', '20', 'HPDE 2', '', '']
    ]
  }
}

async function renderAppWithEvent({
  customUrl = 'https://docs.google.com/spreadsheets/d/TEST_SHEET_ID/edit#gid=123',
  events = []
} = {}) {
  window.localStorage.setItem(
    'nasaDashboardPrefs',
    JSON.stringify({
      customUrl
    })
  )

  globalThis.fetch = vi.fn(async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || ''

    if (url.includes('cached-events') || url.includes('cachedEvents')) {
      return {
        ok: true,
        json: async () => ({ events })
      }
    }

    if (url.includes('sheets/resolve')) {
      return {
        ok: true,
        json: async () => ({ spreadsheetId: 'TEST_SHEET_ID' })
      }
    }

    if (url.includes('/sheets/TEST_SHEET_ID/tabs')) {
      return {
        ok: true,
        json: async () => buildSheetsTabResponse()
      }
    }

    if (url.includes('/sheets/TEST_SHEET_ID/tab/123')) {
      return {
        ok: true,
        json: async () => buildSheetsValuesResponse()
      }
    }

    throw new Error(`Unhandled fetch in test: ${url} (${init?.method || 'GET'})`)
  })

  const { default: App } = await import('./App')
  render(
    <AuthProvider>
      <PreferencesProvider>
        <App />
      </PreferencesProvider>
    </AuthProvider>
  )

  expect(await screen.findByText('Sessions')).toBeInTheDocument()
  fireEvent.click(await screen.findByRole('button', { name: /open menu/i }))
  fireEvent.click(await screen.findByRole('button', { name: /help/i }))
  fireEvent.click(await screen.findByRole('button', { name: /debug/i }))
}

describe('App event window state', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows an upcoming matched event as inactive in the debug panel', async () => {
    vi.setSystemTime(new Date(2026, 3, 1, 12, 0, 0))

    await renderAppWithEvent({
      events: [
        {
          id: 'nasa:event-1',
          source: 'nasa',
          title: 'Test Weekend',
          sheetUrl: 'https://docs.google.com/spreadsheets/d/TEST_SHEET_ID/edit#gid=999',
          spreadsheetId: 'TEST_SHEET_ID',
          startDateKey: '2026-04-03',
          endDateKey: '2026-04-05',
          dateSource: 'title',
          dateResolved: true
        }
      ]
    })

    expect(await screen.findByText(/Activation state: upcoming/i)).toBeInTheDocument()
    expect(screen.getByText(/Inactive reason: Selected event has not started yet\./i)).toBeInTheDocument()
    expect(screen.getByText(/Spreadsheet id: TEST_SHEET_ID/i)).toBeInTheDocument()
  })

  it('shows an active matched event with anchored current-session timing', async () => {
    vi.setSystemTime(new Date(2026, 3, 4, 8, 10, 0))

    await renderAppWithEvent({
      events: [
        {
          id: 'nasa:event-2',
          source: 'nasa',
          title: 'Test Weekend',
          sheetUrl: 'https://docs.google.com/spreadsheets/d/TEST_SHEET_ID/edit',
          spreadsheetId: 'TEST_SHEET_ID',
          startDateKey: '2026-04-03',
          endDateKey: '2026-04-05',
          dateSource: 'title',
          dateResolved: true
        }
      ]
    })

    expect(await screen.findByText(/Activation state: active/i)).toBeInTheDocument()
    expect(screen.getByText(/Current session: HPDE 1/i)).toBeInTheDocument()
    expect(screen.getByText(/Anchored window start:/i).textContent).toContain('4/4/2026')
  })

  it('shows an ended matched event as inactive after the weekend', async () => {
    vi.setSystemTime(new Date(2026, 3, 6, 12, 0, 0))

    await renderAppWithEvent({
      events: [
        {
          id: 'nasa:event-3',
          source: 'nasa',
          title: 'Test Weekend',
          sheetUrl: 'https://docs.google.com/spreadsheets/d/TEST_SHEET_ID/edit',
          spreadsheetId: 'TEST_SHEET_ID',
          startDateKey: '2026-04-03',
          endDateKey: '2026-04-05',
          dateSource: 'title',
          dateResolved: true
        }
      ]
    })

    expect(await screen.findByText(/Activation state: ended/i)).toBeInTheDocument()
    expect(screen.getByText(/Inactive reason: Selected event has already ended\./i)).toBeInTheDocument()
  })

  it('keeps unmatched pasted sheets inactive', async () => {
    vi.setSystemTime(new Date(2026, 3, 1, 12, 0, 0))

    await renderAppWithEvent({ events: [] })

    expect(await screen.findByText(/Activation state: unmatched/i)).toBeInTheDocument()
    expect(screen.getByText(/Match source: none/i)).toBeInTheDocument()
  })

  it('shows fallback mode for known-source events with unresolved dates', async () => {
    vi.setSystemTime(new Date(2026, 2, 31, 7, 50, 0))

    await renderAppWithEvent({
      events: [
        {
          id: 'nasa:event-4',
          source: 'nasa',
          title: 'Unresolved Weekend',
          sheetUrl: 'https://docs.google.com/spreadsheets/d/TEST_SHEET_ID/edit',
          spreadsheetId: 'TEST_SHEET_ID',
          dateSource: null,
          dateResolved: false
        }
      ]
    })

    expect(await screen.findByText(/Activation state: unresolved/i)).toBeInTheDocument()
    expect(screen.getByText(/Fallback mode: floating weekday fallback/i)).toBeInTheDocument()
  })
})
