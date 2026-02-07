import { parseTimeToToday, addMinutes } from '../../scheduleUtils.js'

const LETTER_GROUP_MAP = {
  A: 'A - Novice',
  B: 'B - Intermediate',
  C: 'C - Advanced',
  D: 'D - Expert'
}
const BASE_GROUPS = [
  'A - Novice',
  'B - Intermediate',
  'C - Advanced',
  'D - Expert'
]
const GROUP_ORDER = [...BASE_GROUPS, 'OUT Motorsports', 'P&P']

export function normalizeHodText(value) {
  if (value == null) return ''
  return value
    .toString()
    .replace(/\u00A0|\u202F/g, ' ')
    .replace(/\u00E2\u20AC\u00AF/g, ' ')
    .replace(/\u2013|\u2014/g, '-')
    .replace(/\s*:\s*/g, ':')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeDayLabel(value) {
  const text = normalizeHodText(value).toLowerCase()
  if (!text) return null
  if (/\bmonday\b|\bmon\b/.test(text)) return 'Monday'
  if (/\btuesday\b|\btue\b/.test(text)) return 'Tuesday'
  if (/\bwednesday\b|\bwed\b/.test(text)) return 'Wednesday'
  if (/\bthursday\b|\bthu\b|\bthur\b|\bthurs\b/.test(text)) return 'Thursday'
  if (/\bfriday\b|\bfri\b/.test(text)) return 'Friday'
  if (/\bsaturday\b|\bsat\b/.test(text)) return 'Saturday'
  if (/\bsunday\b|\bsun\b/.test(text)) return 'Sunday'
  return null
}

export function inferDayLabelFromSource(sourceLabel) {
  if (!sourceLabel) return null
  return normalizeDayLabel(sourceLabel)
}

function extractMeridiem(text) {
  const match = normalizeHodText(text).toUpperCase().match(/\bAM\b|\bPM\b/)
  return match ? match[0] : null
}

function parseSingleTime(text, defaultMeridiem, dayOffset = 0) {
  const normalized = normalizeHodText(text).toUpperCase()
  if (!normalized) return null

  const meridiemMatch = normalized.match(/\bAM\b|\bPM\b/)
  const meridiem = meridiemMatch ? meridiemMatch[0] : defaultMeridiem
  let cleaned = normalized.replace(/\bAM\b|\bPM\b/g, '')
  cleaned = cleaned.replace(/\+$/g, '').trim()
  cleaned = cleaned.replace(/[^0-9:]/g, '')

  if (!cleaned) return null

  let hours = ''
  let minutes = ''

  if (cleaned.includes(':')) {
    const parts = cleaned.split(':')
    hours = parts[0]
    minutes = parts[1] || '00'
  } else if (cleaned.length >= 3) {
    hours = cleaned.slice(0, cleaned.length - 2)
    minutes = cleaned.slice(cleaned.length - 2)
  } else {
    hours = cleaned
    minutes = '00'
  }

  if (!hours) return null

  const hoursNumber = parseInt(hours, 10)
  if (Number.isNaN(hoursNumber)) return null

  const minutesText = `${minutes}`.padStart(2, '0')
  const timeStr = `${hoursNumber}:${minutesText}${meridiem ? ` ${meridiem}` : ''}`
  return parseTimeToToday(timeStr, dayOffset)
}

function diffMinutes(start, end) {
  if (!start || !end) return null
  let diff = (end.getTime() - start.getTime()) / 60000
  if (diff < 0) diff += 12 * 60
  if (diff < 0) diff += 24 * 60
  if (diff <= 0) return null
  return Math.round(diff)
}

export function parseHodTimeRange(value, dayOffset = 0) {
  const normalized = normalizeHodText(value)
  if (!normalized) return { start: null, end: null, duration: null }

  let text = normalized.toUpperCase()
  text = text.replace(/NOON/g, '12:00 PM')
  text = text.replace(/\s*\+\s*$/g, '')

  const parts = text.split(/\s*[-\u2013\u2014]\s*/).filter(Boolean)
  if (parts.length >= 2) {
    const endMeridiem = extractMeridiem(parts[1]) || extractMeridiem(parts[0])
    const start = parseSingleTime(parts[0], endMeridiem, dayOffset)
    const end = parseSingleTime(parts[1], endMeridiem, dayOffset)
    const duration = diffMinutes(start, end)
    return { start, end, duration }
  }

  const start = parseSingleTime(text, null, dayOffset)
  return { start, end: null, duration: null }
}

export function parseHodRunGroups(value) {
  const text = normalizeHodText(value).toUpperCase()
  if (!text) return { groups: [], isAll: false }

  const groups = new Set()
  let isAll = false

  if (/\bALL\b/.test(text) || /ALL DRIVERS/.test(text)) {
    isAll = true
  }

  if (/OUT\s*MOTORSPORTS/.test(text)) groups.add('OUT Motorsports')
  if (/P\s*&\s*P|P&P/.test(text)) groups.add('P&P')

  const tokens = text.replace(/[^A-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  tokens.forEach(token => {
    if (token === 'A1') {
      groups.add(LETTER_GROUP_MAP.A)
      return
    }
    if (LETTER_GROUP_MAP[token]) {
      groups.add(LETTER_GROUP_MAP[token])
      return
    }
    if (token === 'NOVICE' || token === 'NOVICES') {
      groups.add(LETTER_GROUP_MAP.A)
      return
    }
    if (token === 'INTERMEDIATE') {
      groups.add(LETTER_GROUP_MAP.B)
      return
    }
    if (token === 'ADVANCED') {
      groups.add(LETTER_GROUP_MAP.C)
      return
    }
    if (token === 'EXPERT') {
      groups.add(LETTER_GROUP_MAP.D)
    }
  })

  return { groups: sortHodGroups([...groups]), isAll }
}

export function sortHodGroups(groups) {
  const order = new Map(GROUP_ORDER.map((group, index) => [group, index]))
  return [...groups].sort((a, b) => {
    const aOrder = order.has(a) ? order.get(a) : 999
    const bOrder = order.has(b) ? order.get(b) : 999
    if (aOrder !== bOrder) return aOrder - bOrder
    return a.localeCompare(b)
  })
}

export function formatHodGroupLabel(groups) {
  if (!groups || groups.length === 0) return 'On Track'
  const ordered = sortHodGroups(groups)
  const onlyBaseGroups = ordered.every(group => BASE_GROUPS.includes(group))
  if (onlyBaseGroups) return ordered.join('/')
  if (ordered.length === 1) return ordered[0]
  return ordered.join(' + ')
}

export function extractHodRunGroups(sessions) {
  const groupSet = new Set(['All'])
  sessions.forEach(session => {
    const sessionGroups = Array.isArray(session.runGroupIds) ? session.runGroupIds : []
    sessionGroups.forEach(group => groupSet.add(group))
  })
  const groups = Array.from(groupSet)
  const sorted = sortHodGroups(groups.filter(group => group !== 'All'))
  return ['All', ...sorted]
}

export function resolveDayLabel({ rows, headerIndex, sourceLabel }) {
  const limit = headerIndex != null ? Math.min(headerIndex + 1, rows.length) : Math.min(rows.length, 10)
  for (let i = 0; i < limit; i += 1) {
    const row = rows[i] || []
    for (let j = 0; j < row.length; j += 1) {
      const day = normalizeDayLabel(row[j])
      if (day) return day
    }
  }
  const fromSource = inferDayLabelFromSource(sourceLabel)
  return fromSource || 'Day 1'
}

export function isMeetingRow(activityText, whoText) {
  const combined = `${activityText} ${whoText}`.toLowerCase()
  return /meeting|breakout/.test(combined)
}

export function isClassroomRow(activityText, whoText, whereText) {
  const combined = `${activityText} ${whoText} ${whereText}`.toLowerCase()
  return /classroom|novice/.test(combined)
}

const SPECIAL_LABELS = [
  { pattern: /party mode/i, label: 'Party Mode' },
  { pattern: /happy hour|\bhh\b/i, label: 'Happy Hour' },
  { pattern: /shush/i, label: 'Shush Session' },
  { pattern: /charity parade|parade laps/i, label: 'Charity Parade Laps' }
]

export function getSpecialOnTrackLabel(...values) {
  for (const raw of values) {
    if (!raw) continue
    const text = raw.toString()
    for (const entry of SPECIAL_LABELS) {
      if (entry.pattern.test(text)) return entry.label
    }
  }
  return null
}

export function isSpecialOnTrack(activityText, whoText, whereText) {
  return Boolean(getSpecialOnTrackLabel(activityText, whoText, whereText))
}

export function buildSessionTitle({ activityText, whoText, groups, specialLabel }) {
  if (specialLabel) return specialLabel
  if (!activityText || /on\s*track/i.test(activityText)) {
    if (groups && groups.length > 0) return formatHodGroupLabel(groups)
  }
  return activityText || whoText || 'On Track'
}

export function computeRowEnd(row) {
  if (!row.start || !row.duration) return row.end || null
  return addMinutes(row.start, row.duration)
}
