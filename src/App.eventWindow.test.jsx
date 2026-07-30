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

function buildSheetsTabResponse({
  spreadsheetTitle = 'Test Weekend',
  tabs = [{ sheetId: 123, title: 'Saturday' }]
} = {}) {
  return {
    spreadsheetTitle,
    tabs
  }
}

function buildSheetsValuesResponse({
  spreadsheetTitle = 'Test Weekend',
  sheetTitle = 'Saturday',
  rows = [
    ['Saturday', '', '', '', ''],
    ['8:00 AM', '20', 'HPDE 1', '', ''],
    ['8:20 AM', '20', 'HPDE 2', '', '']
  ]
} = {}) {
  return {
    spreadsheetTitle,
    sheetTitle,
    headers: ['Time', 'Duration', 'Session', 'Classroom', 'Notes'],
    rows
  }
}

async function renderAppWithEvent({
  customUrl = 'https://docs.google.com/spreadsheets/d/TEST_SHEET_ID/edit#gid=123',
  spreadsheetId = 'TEST_SHEET_ID',
  events = [],
  prefs = {},
  locationSearch = '',
  tabsResponse,
  valuesResponse
} = {}) {
  window.history.replaceState({}, '', locationSearch ? `/${locationSearch}` : '/')
  window.localStorage.setItem(
    'nasaDashboardPrefs',
    JSON.stringify({
      customUrl,
      ...prefs
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
        json: async () => ({ spreadsheetId })
      }
    }

    if (url.includes(`/sheets/${spreadsheetId}/tabs`)) {
      return {
        ok: true,
        json: async () => buildSheetsTabResponse(tabsResponse)
      }
    }

    if (url.includes(`/sheets/${spreadsheetId}/tab/123`)) {
      return {
        ok: true,
        json: async () => buildSheetsValuesResponse(valuesResponse)
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
    window.history.replaceState({}, '', '/')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows an upcoming matched event as inactive with a user-facing date message', async () => {
    vi.setSystemTime(new Date(2026, 3, 1, 12, 0, 0))

    await renderAppWithEvent({
      prefs: { selectedDay: 'Saturday' },
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
    expect(screen.getByText('Event selected')).toBeInTheDocument()
    expect(screen.getByText(/Test Weekend is selected, but the live schedule has not started yet\. Event dates: Apr 3 - Apr 5, 2026\./i)).toBeInTheDocument()
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
    expect(screen.getByText('Event selected')).toBeInTheDocument()
    expect(screen.getByText(/Test Weekend is selected, but this event has already ended\./i)).toBeInTheDocument()
  })

  it('keeps unmatched pasted sheets inactive', async () => {
    vi.setSystemTime(new Date(2026, 3, 1, 12, 0, 0))

    await renderAppWithEvent({ events: [] })

    expect(await screen.findByText(/Activation state: unmatched/i)).toBeInTheDocument()
    expect(screen.getByText(/Match source: none/i)).toBeInTheDocument()
  })

  it('prefills the selected schedule from a Google Sheet URL query parameter', async () => {
    const querySheetUrl = 'https://docs.google.com/spreadsheets/d/QUERY_SHEET_ID/edit#gid=123'
    vi.setSystemTime(new Date(2026, 3, 1, 12, 0, 0))

    await renderAppWithEvent({
      customUrl: 'https://docs.google.com/spreadsheets/d/SAVED_SHEET_ID/edit#gid=123',
      spreadsheetId: 'QUERY_SHEET_ID',
      locationSearch: `?sheetUrl=${encodeURIComponent(querySheetUrl)}`,
      events: [
        {
          id: 'hod:query-event',
          source: 'hod',
          title: 'QR Weekend',
          sheetUrl: querySheetUrl,
          spreadsheetId: 'QUERY_SHEET_ID',
          dateSource: null,
          dateResolved: false
        }
      ]
    })

    expect(await screen.findByText(/Spreadsheet id: QUERY_SHEET_ID/i)).toBeInTheDocument()
    expect(screen.getByText(/Match source: hod \(spreadsheetId\)/i)).toBeInTheDocument()
    const fetchedUrls = globalThis.fetch.mock.calls.map(([input]) => (
      typeof input === 'string' ? input : input?.url || ''
    ))
    expect(fetchedUrls.some(url => url.includes('/sheets/QUERY_SHEET_ID/tabs'))).toBe(true)
    expect(fetchedUrls.some(url => url.includes('/sheets/SAVED_SHEET_ID/tabs'))).toBe(false)
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

  it('does not offer past resolved events in the event selector', async () => {
    vi.setSystemTime(new Date(2026, 5, 9, 12, 0, 0))

    await renderAppWithEvent({
      customUrl: '',
      events: [
        {
          id: 'nasa:past-event',
          source: 'nasa',
          title: 'Past Weekend',
          sheetUrl: 'https://docs.google.com/spreadsheets/d/PAST_SHEET_ID/edit',
          spreadsheetId: 'PAST_SHEET_ID',
          startDateKey: '2026-06-06',
          endDateKey: '2026-06-07',
          dateSource: 'title',
          dateResolved: true
        },
        {
          id: 'nasa:active-event',
          source: 'nasa',
          title: 'Active Weekend',
          sheetUrl: 'https://docs.google.com/spreadsheets/d/ACTIVE_SHEET_ID/edit',
          spreadsheetId: 'ACTIVE_SHEET_ID',
          startDateKey: '2026-06-09',
          endDateKey: '2026-06-10',
          dateSource: 'title',
          dateResolved: true
        },
        {
          id: 'hod:unresolved-event',
          source: 'hod',
          title: 'Unresolved Weekend',
          sheetUrl: 'https://docs.google.com/spreadsheets/d/UNRESOLVED_SHEET_ID/edit',
          spreadsheetId: 'UNRESOLVED_SHEET_ID',
          dateSource: null,
          dateResolved: false
        }
      ]
    })

    expect(await screen.findByRole('option', { name: /\[NASA-SE\] Active Weekend/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /\[HOD-MA\] Unresolved Weekend/i })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /\[NASA-SE\] Past Weekend/i })).not.toBeInTheDocument()
  })

  it('renders an unmapped selected sheet day without using parser dates for the event window', async () => {
    const savannahSheetId = '175rBaDl6dds924rlAcfHFvfIF98HC3jyH_OgvM45W6Q'
    vi.setSystemTime(new Date(2026, 5, 10, 9, 38, 38))

    await renderAppWithEvent({
      customUrl: `https://docs.google.com/spreadsheets/d/${savannahSheetId}/`,
      spreadsheetId: savannahSheetId,
      prefs: { selectedDay: 'Sunday' },
      tabsResponse: {
        spreadsheetTitle: '2025 Savannah Sizzler',
        tabs: [{ sheetId: 123, title: 'Schedule' }]
      },
      valuesResponse: {
        spreadsheetTitle: '2025 Savannah Sizzler',
        sheetTitle: 'Schedule',
        rows: [
          ['Friday', '', '', '', ''],
          ['7:30 AM', '600', 'Thunder Race #1', '', ''],
          ['Sunday', '', '', '', ''],
          ['7:30 AM', '30', 'Thunder Race #2', '', '']
        ]
      },
      events: [
        {
          id: 'nasa:savannah-sizzler',
          source: 'nasa',
          title: '2025 Savannah Sizzler',
          sheetUrl: `https://docs.google.com/spreadsheets/d/${savannahSheetId}/`,
          spreadsheetId: savannahSheetId,
          startDateKey: '2026-09-04',
          endDateKey: '2026-09-05',
          dateSource: 'title',
          dateResolved: true
        }
      ]
    })

    expect(await screen.findByText(/Activation state: upcoming/i)).toBeInTheDocument()
    expect(screen.getAllByText(/2025 Savannah Sizzler - Schedule/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/Anchored window start:/i).textContent).toContain('9/4/2026')
    expect(screen.getByText(/Anchored window start:/i).textContent).not.toContain('6/10/2026')
  })
})
