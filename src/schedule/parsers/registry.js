import Papa from 'papaparse'
import { nasaSeParser } from './nasaSeParser.js'
import { hodMaParser } from './hodMaParser.js'

export const SCHEDULE_PARSERS = [nasaSeParser, hodMaParser]
export const DEFAULT_SCHEDULE_PARSER_ID = SCHEDULE_PARSERS[0]?.id || 'nasa-se'

const AUTO_DETECT_ERROR = 'Unable to determine parser automatically. Ensure the sheet matches NASA-SE or HOD-MA formats.'

const HOD_ACTIVITY_PATTERNS = [
  /\bactivity\b/,
  /\bactivities\b/,
  /\bevent\b/,
  /\bsession\b/
]
const HOD_TIME_PATTERNS = [
  /\btime\b/,
  /\bstart\b/
]
const HOD_END_PATTERNS = [
  /\bend\b/,
  /\bend time\b/
]
const HOD_WHO_PATTERNS = [
  /\bwho\b/
]
const HOD_WHERE_PATTERNS = [
  /\bwhere\b/,
  /\blocation\b/,
  /\bnotes?\b/
]

function normalizeCell(value) {
  return (value || '')
    .toString()
    .replace(/\uFEFF/g, '')
    .replace(/\u00A0|\u202F/g, ' ')
    .replace(/\u2013|\u2014/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function normalizeHeaderCell(value) {
  return normalizeCell(value)
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cellHasPattern(cell, patterns) {
  if (!cell) return false
  return patterns.some(pattern => pattern.test(cell))
}

function hasLabelHint(label) {
  if (!label) return false
  return /hod|hooked on driving|live scheduler|scheduler template/.test(label)
}

function isDayLabel(text) {
  if (!text) return false
  if (/\bmonday\b|\bmon\b/.test(text)) return true
  if (/\btuesday\b|\btue\b|\btues\b/.test(text)) return true
  if (/\bwednesday\b|\bwed\b/.test(text)) return true
  if (/\bthursday\b|\bthu\b|\bthur\b|\bthurs\b/.test(text)) return true
  if (/\bfriday\b|\bfri\b/.test(text)) return true
  if (/\bsaturday\b|\bsat\b/.test(text)) return true
  if (/\bsunday\b|\bsun\b/.test(text)) return true
  return false
}

function isTime(value) {
  if (!value) return false
  return /\d{1,2}(:\d{2})?\s*(AM|PM|am|pm)?/.test(value)
}

export function detectParserId({ csvText, sourceLabel } = {}) {
  if (typeof csvText !== 'string' || csvText.trim().length === 0) {
    throw new Error(AUTO_DETECT_ERROR)
  }

  const parsed = Papa.parse(csvText, { skipEmptyLines: true })
  const rows = parsed.data || []

  for (const row of rows) {
    const cells = (row || []).map(normalizeHeaderCell)
    const hasActivity = cells.some(cell => cellHasPattern(cell, HOD_ACTIVITY_PATTERNS))
    const hasTime = cells.some(cell => cellHasPattern(cell, HOD_TIME_PATTERNS))
    const hasEnd = cells.some(cell => cellHasPattern(cell, HOD_END_PATTERNS))
    const hasWho = cells.some(cell => cellHasPattern(cell, HOD_WHO_PATTERNS))
    const hasWhere = cells.some(cell => cellHasPattern(cell, HOD_WHERE_PATTERNS))
    if (hasTime && (hasActivity || (hasEnd && hasWhere) || (hasWho && hasWhere))) {
      return { parserId: 'hod-ma', reason: 'header-row' }
    }
  }

  let dayLabelCount = 0
  let timeRowCount = 0

  rows.forEach(row => {
    const firstCell = normalizeCell((row || [])[0])
    if (isDayLabel(firstCell)) dayLabelCount += 1

    if (isTime(firstCell)) {
      const durationCell = normalizeCell((row || [])[1])
      if (durationCell && /\d+/.test(durationCell)) {
        timeRowCount += 1
      }
    }
  })

  if (dayLabelCount >= 1 && timeRowCount >= 3) {
    return { parserId: 'nasa-se', reason: `days:${dayLabelCount}, timeRows:${timeRowCount}` }
  }

  const normalizedLabel = normalizeCell(sourceLabel || '')
  if (hasLabelHint(normalizedLabel)) {
    return { parserId: 'hod-ma', reason: 'source-label' }
  }

  throw new Error(AUTO_DETECT_ERROR)
}

export function getParserById(parserId) {
  if (!parserId) return SCHEDULE_PARSERS[0] || null
  return SCHEDULE_PARSERS.find(parser => parser.id === parserId) || SCHEDULE_PARSERS[0] || null
}

export function parseCsvSchedule({ csvText, parserId = DEFAULT_SCHEDULE_PARSER_ID, dayOffset = 0, sourceLabel }) {
  const parser = getParserById(parserId)
  if (!parser) {
    throw new Error('No schedule parsers are available.')
  }
  return parser.parseCsv({ csvText, dayOffset, sourceLabel })
}
