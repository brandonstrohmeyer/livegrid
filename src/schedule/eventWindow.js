const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime())
}

export function extractSpreadsheetId(value) {
  if (!value || typeof value !== 'string') return null
  const trimmed = value.trim()
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  if (match) return match[1]
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed
  return null
}

export function normalizeDateKey(value) {
  if (!value) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
    const isoDate = new Date(trimmed)
    if (!Number.isNaN(isoDate.getTime())) {
      return [
        isoDate.getUTCFullYear(),
        String(isoDate.getUTCMonth() + 1).padStart(2, '0'),
        String(isoDate.getUTCDate()).padStart(2, '0')
      ].join('-')
    }
    return null
  }
  if (isValidDate(value)) {
    return [
      value.getUTCFullYear(),
      String(value.getUTCMonth() + 1).padStart(2, '0'),
      String(value.getUTCDate()).padStart(2, '0')
    ].join('-')
  }
  return null
}

export function parseDateKeyToLocalDate(dateKey) {
  if (!dateKey || typeof dateKey !== 'string') return null
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  const day = Number(match[3])
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || !Number.isFinite(day)) return null
  return new Date(year, monthIndex, day, 0, 0, 0, 0)
}

function toLocalDateKey(date) {
  if (!isValidDate(date)) return null
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
}

function getDayIndex(dayLabel) {
  if (!dayLabel) return -1
  return DAY_NAMES.indexOf(dayLabel)
}

function buildRangeDateKeys(startDateKey, endDateKey) {
  const start = parseDateKeyToLocalDate(startDateKey)
  const end = parseDateKeyToLocalDate(endDateKey || startDateKey)
  if (!isValidDate(start) || !isValidDate(end) || start > end) return []

  const keys = []
  const cursor = new Date(start)
  while (cursor <= end && keys.length < 10) {
    keys.push(toLocalDateKey(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return keys.filter(Boolean)
}

function findDateKeyForDayLabel(dayLabel, startDateKey, endDateKey) {
  const expectedDayIndex = getDayIndex(dayLabel)
  if (expectedDayIndex < 0) return null
  const rangeKeys = buildRangeDateKeys(startDateKey, endDateKey)
  return rangeKeys.find(key => {
    const date = parseDateKeyToLocalDate(key)
    return date && date.getDay() === expectedDayIndex
  }) || null
}

function anchorDateToKey(date, dateKey) {
  if (!isValidDate(date) || !dateKey) return isValidDate(date) ? new Date(date) : null
  const anchored = parseDateKeyToLocalDate(dateKey)
  if (!anchored) return new Date(date)
  anchored.setHours(date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds())
  return anchored
}

function computeAnchoredEnd(entry, anchoredStart, dateKey) {
  if (!anchoredStart) return null
  if (isValidDate(entry?.end)) {
    const anchoredEnd = anchorDateToKey(entry.end, dateKey)
    if (anchoredEnd && anchoredEnd >= anchoredStart) return anchoredEnd
    if (isValidDate(entry?.start)) {
      const diffMs = entry.end.getTime() - entry.start.getTime()
      if (diffMs > 0) return new Date(anchoredStart.getTime() + diffMs)
    }
  }
  if (Number.isFinite(entry?.duration) && entry.duration > 0) {
    return new Date(anchoredStart.getTime() + entry.duration * 60000)
  }
  return null
}

function sortByStart(a, b) {
  const aTime = isValidDate(a?.start) ? a.start.getTime() : Number.POSITIVE_INFINITY
  const bTime = isValidDate(b?.start) ? b.start.getTime() : Number.POSITIVE_INFINITY
  return aTime - bTime
}

function buildWindowFromDateKeys(startDateKey, endDateKey) {
  const start = parseDateKeyToLocalDate(startDateKey)
  const end = parseDateKeyToLocalDate(endDateKey || startDateKey)
  if (!start || !end) return { windowStart: null, windowEnd: null }

  const windowStart = new Date(start)
  windowStart.setHours(0, 0, 0, 0)
  const windowEnd = new Date(end)
  windowEnd.setHours(23, 59, 59, 999)

  return { windowStart, windowEnd }
}

function anchorEntry(entry, dayDateMap, singleDayFallbackKey) {
  const dateKey = entry?.day ? dayDateMap[entry.day] || null : singleDayFallbackKey
  const anchoredStart = anchorDateToKey(entry?.start, dateKey)
  const anchoredEnd = computeAnchoredEnd(entry, anchoredStart, dateKey)
  return {
    ...entry,
    start: anchoredStart,
    end: anchoredEnd
  }
}

export function anchorScheduleToEventDates(schedule, eventMeta = {}) {
  const baseSchedule = schedule || {
    runGroups: ['All'],
    sessions: [],
    activities: [],
    days: [],
    warnings: []
  }

  const startDateKey = normalizeDateKey(eventMeta.startDateKey || eventMeta.startDate)
  const endDateKey = normalizeDateKey(eventMeta.endDateKey || eventMeta.endDate || startDateKey)
  if (!startDateKey || !endDateKey) {
    return {
      schedule: baseSchedule,
      startDateKey: null,
      endDateKey: null,
      dayDateMap: {},
      windowStart: null,
      windowEnd: null,
      windowSource: 'none',
      anchoredSessionCount: 0,
      anchoredActivityCount: 0
    }
  }

  const dayLabels = new Set()
  ;(baseSchedule.days || []).forEach(day => {
    if (day) dayLabels.add(day)
  })
  ;(baseSchedule.sessions || []).forEach(session => {
    if (session?.day) dayLabels.add(session.day)
  })
  ;(baseSchedule.activities || []).forEach(activity => {
    if (activity?.day) dayLabels.add(activity.day)
  })

  const dayDateMap = {}
  Array.from(dayLabels).forEach(day => {
    const key = findDateKeyForDayLabel(day, startDateKey, endDateKey)
    if (key) dayDateMap[day] = key
  })

  const singleDayFallbackKey = startDateKey === endDateKey ? startDateKey : null
  const anchoredSessions = (baseSchedule.sessions || [])
    .map(session => anchorEntry(session, dayDateMap, singleDayFallbackKey))
    .sort(sortByStart)
  const anchoredActivities = (baseSchedule.activities || [])
    .map(activity => anchorEntry(activity, dayDateMap, singleDayFallbackKey))
    .sort(sortByStart)

  let windowStart = null
  let windowEnd = null

  ;[...anchoredSessions, ...anchoredActivities].forEach(entry => {
    if (isValidDate(entry?.start)) {
      if (!windowStart || entry.start < windowStart) windowStart = entry.start
      const effectiveEnd = isValidDate(entry?.end)
        ? entry.end
        : Number.isFinite(entry?.duration) && entry.duration > 0
          ? new Date(entry.start.getTime() + entry.duration * 60000)
          : entry.start
      if (!windowEnd || effectiveEnd > windowEnd) windowEnd = effectiveEnd
    }
  })

  let windowSource = 'schedule'
  if (!windowStart || !windowEnd) {
    const fallbackWindow = buildWindowFromDateKeys(startDateKey, endDateKey)
    windowStart = fallbackWindow.windowStart
    windowEnd = fallbackWindow.windowEnd
    windowSource = windowStart && windowEnd ? 'event-dates' : 'none'
  }

  return {
    schedule: {
      ...baseSchedule,
      sessions: anchoredSessions,
      activities: anchoredActivities
    },
    startDateKey,
    endDateKey,
    dayDateMap,
    windowStart,
    windowEnd,
    windowSource,
    anchoredSessionCount: anchoredSessions.filter(entry => isValidDate(entry?.start)).length,
    anchoredActivityCount: anchoredActivities.filter(entry => isValidDate(entry?.start)).length
  }
}
