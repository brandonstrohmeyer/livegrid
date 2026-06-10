import { test, expect } from '@playwright/test'

const SAVANNAH_SPREADSHEET_ID = '175rBaDl6dds924rlAcfHFvfIF98HC3jyH_OgvM45W6Q'
const SAVANNAH_SHEET_URL = `https://docs.google.com/spreadsheets/d/${SAVANNAH_SPREADSHEET_ID}/`

const savannahEvent = {
  id: 'nasa:savannah-sizzler',
  source: 'nasa',
  title: '2025 Savannah Sizzler',
  sheetUrl: SAVANNAH_SHEET_URL,
  spreadsheetId: SAVANNAH_SPREADSHEET_ID,
  startDateKey: '2026-09-04',
  endDateKey: '2026-09-05',
  dateSource: 'title',
  dateResolved: true
}

const savannahRows = [
  ['Friday', '', '', '', ''],
  ['7:30 AM', '20', 'Thunder Race #1', '', ''],
  ['8:00 AM', '20', 'HPDE 1', '', ''],
  ['Sunday', '', '', '', ''],
  ['7:30 AM', '20', 'Thunder Race #2', '', ''],
  ['8:00 AM', '20', 'HPDE 2', '', '']
]

async function fulfillJson(route, payload) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(payload)
  })
}

async function installSheetMocks(page) {
  await page.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname

    if (path.endsWith('/api/cached-events') || path.endsWith('/cachedEvents')) {
      await fulfillJson(route, { events: [savannahEvent] })
      return
    }

    if (path.includes('/sheets/resolve')) {
      await fulfillJson(route, { spreadsheetId: SAVANNAH_SPREADSHEET_ID })
      return
    }

    if (path.includes(`/sheets/${SAVANNAH_SPREADSHEET_ID}/tabs`)) {
      await fulfillJson(route, {
        spreadsheetId: SAVANNAH_SPREADSHEET_ID,
        spreadsheetTitle: '2025 Savannah Sizzler',
        tabs: [{ sheetId: 123, title: 'Schedule' }]
      })
      return
    }

    if (path.includes(`/sheets/${SAVANNAH_SPREADSHEET_ID}/tab/123`)) {
      await fulfillJson(route, {
        spreadsheetId: SAVANNAH_SPREADSHEET_ID,
        spreadsheetTitle: '2025 Savannah Sizzler',
        sheetTitle: 'Schedule',
        headers: [],
        rows: savannahRows
      })
      return
    }

    if (path.endsWith('/api/client-telemetry')) {
      await fulfillJson(route, { ok: true })
      return
    }

    if (path.includes('/syncScheduledNotifications')) {
      await fulfillJson(route, { result: { count: 0 } })
      return
    }

    await route.continue()
  })
}

test('loads a matched Google Sheet event without parser-date window drift or render crashes', async ({ page }) => {
  const runtimeErrors = []

  page.on('pageerror', error => {
    runtimeErrors.push(`pageerror: ${error.message}`)
  })
  page.on('console', message => {
    if (message.type() === 'error') {
      runtimeErrors.push(`console.error: ${message.text()}`)
    }
  })

  await page.clock.setFixedTime(new Date('2026-06-10T13:38:38Z'))
  await installSheetMocks(page)
  await page.addInitScript(({ customUrl }) => {
    window.localStorage.setItem(
      'nasaDashboardPrefs',
      JSON.stringify({
        customUrl,
        selectedDay: 'Sunday',
        autoScrollEnabled: false
      })
    )
  }, { customUrl: SAVANNAH_SHEET_URL })

  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible()
  await page.getByRole('button', { name: /open menu/i }).click()
  await page.getByRole('button', { name: /help/i }).click()
  await page.getByRole('button', { name: /debug/i }).click()

  const debugPanel = page.locator('.debug-controls')
  await expect(debugPanel).toContainText('Sheet Name: 2025 Savannah Sizzler - Schedule')
  await expect(debugPanel).toContainText('Parser: NASA-SE')
  await expect(debugPanel).toContainText('Match source: nasa (spreadsheetId)')
  await expect(debugPanel).toContainText('Selected day: Sunday')
  await expect(debugPanel).toContainText('Activation state: upcoming')
  await expect(debugPanel).toContainText('Day/date map: {"Friday":"2026-09-04"}')
  await expect(debugPanel).toContainText(/Anchored window start:\s*9\/4\/2026/)
  await expect(debugPanel).not.toContainText(/Anchored window start:\s*6\/10\/2026/)
  await expect(page.getByText('Thunder Race #2')).toBeVisible()

  expect(runtimeErrors).toEqual([])
})
