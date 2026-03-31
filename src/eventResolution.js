import {
  extractSpreadsheetId,
  normalizeDateKey,
  parseDateKeyToLocalDate
} from './schedule/eventWindow.js'

function buildWindowFromEventDates(startDateKey, endDateKey) {
  const start = parseDateKeyToLocalDate(startDateKey)
  const end = parseDateKeyToLocalDate(endDateKey || startDateKey)
  if (!start || !end) return { windowStart: null, windowEnd: null }

  const windowStart = new Date(start)
  windowStart.setHours(0, 0, 0, 0)
  const windowEnd = new Date(end)
  windowEnd.setHours(23, 59, 59, 999)

  return { windowStart, windowEnd }
}

export function matchCachedEventForSheet(events, { customUrl, spreadsheetId } = {}) {
  const eventList = Array.isArray(events) ? events : []
  const resolvedSpreadsheetId = spreadsheetId || extractSpreadsheetId(customUrl)

  if (resolvedSpreadsheetId) {
    const spreadsheetMatch = eventList.find(event => {
      const eventSpreadsheetId = event?.spreadsheetId || extractSpreadsheetId(event?.sheetUrl || '')
      return Boolean(eventSpreadsheetId && eventSpreadsheetId === resolvedSpreadsheetId)
    })
    if (spreadsheetMatch) {
      return {
        event: spreadsheetMatch,
        matchType: 'spreadsheetId',
        spreadsheetId: resolvedSpreadsheetId
      }
    }
  }

  if (customUrl) {
    const rawUrlMatch = eventList.find(event => event?.sheetUrl === customUrl)
    if (rawUrlMatch) {
      return {
        event: rawUrlMatch,
        matchType: 'sheetUrl',
        spreadsheetId: resolvedSpreadsheetId || rawUrlMatch?.spreadsheetId || extractSpreadsheetId(rawUrlMatch?.sheetUrl || '')
      }
    }
  }

  return {
    event: null,
    matchType: 'none',
    spreadsheetId: resolvedSpreadsheetId || null
  }
}

export function resolveSelectedScheduleState({
  hasSelectedSchedule,
  isLocalDemoScheduleActive,
  matchedEvent,
  eventsLookupReady,
  anchoredWindowStart,
  anchoredWindowEnd,
  now
}) {
  if (!hasSelectedSchedule) {
    return {
      status: 'none',
      isScheduleActive: false,
      useFloatingFallback: false,
      inactiveReason: null,
      activeWindowStart: null,
      activeWindowEnd: null
    }
  }

  if (isLocalDemoScheduleActive) {
    return {
      status: 'active',
      isScheduleActive: true,
      useFloatingFallback: false,
      inactiveReason: null,
      activeWindowStart: anchoredWindowStart || null,
      activeWindowEnd: anchoredWindowEnd || null
    }
  }

  if (!matchedEvent) {
    return {
      status: eventsLookupReady ? 'unmatched' : 'resolving',
      isScheduleActive: false,
      useFloatingFallback: false,
      inactiveReason: eventsLookupReady
        ? 'Selected sheet is not linked to a known event.'
        : 'Resolving event date details.',
      activeWindowStart: null,
      activeWindowEnd: null
    }
  }

  const startDateKey = normalizeDateKey(matchedEvent.startDateKey || matchedEvent.startDate)
  const endDateKey = normalizeDateKey(matchedEvent.endDateKey || matchedEvent.endDate || startDateKey)
  const dateResolved = matchedEvent.dateResolved !== false && Boolean(startDateKey && endDateKey)

  if (!dateResolved) {
    return {
      status: 'unresolved',
      isScheduleActive: true,
      useFloatingFallback: true,
      inactiveReason: null,
      activeWindowStart: null,
      activeWindowEnd: null
    }
  }

  const fallbackWindow = buildWindowFromEventDates(startDateKey, endDateKey)
  const activeWindowStart = anchoredWindowStart || fallbackWindow.windowStart
  const activeWindowEnd = anchoredWindowEnd || fallbackWindow.windowEnd

  if (!activeWindowStart || !activeWindowEnd || !(now instanceof Date) || Number.isNaN(now.getTime())) {
    return {
      status: 'unresolved',
      isScheduleActive: true,
      useFloatingFallback: true,
      inactiveReason: null,
      activeWindowStart: null,
      activeWindowEnd: null
    }
  }

  if (now < activeWindowStart) {
    return {
      status: 'upcoming',
      isScheduleActive: false,
      useFloatingFallback: false,
      inactiveReason: 'Selected event has not started yet.',
      activeWindowStart,
      activeWindowEnd
    }
  }

  if (now > activeWindowEnd) {
    return {
      status: 'ended',
      isScheduleActive: false,
      useFloatingFallback: false,
      inactiveReason: 'Selected event has already ended.',
      activeWindowStart,
      activeWindowEnd
    }
  }

  return {
    status: 'active',
    isScheduleActive: true,
    useFloatingFallback: false,
    inactiveReason: null,
    activeWindowStart,
    activeWindowEnd
  }
}
