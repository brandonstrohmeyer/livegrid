import Papa from 'papaparse'
import { nasaSeParser } from './nasaSeParser.js'
import { hodMaParser } from './hodMaParser.js'

export const SCHEDULE_PARSERS = [nasaSeParser, hodMaParser]
export const DEFAULT_SCHEDULE_PARSER_ID = SCHEDULE_PARSERS[0]?.id || 'nasa-se'

const AUTO_DETECT_ERROR = 'Unable to determine parser automatically. Ensure the sheet matches NASA-SE or HOD-MA formats.'

function normalizeCell(value) {
  return (value || '')
    .toString()
    .replace(/\u00A0|\u202F/g, ' ')
    .replace(/\u2013|\u2014/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
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

export function detectParserId({ csvText } = {}) {
  if (typeof csvText !== 'string' || csvText.trim().length === 0) {
    throw new Error(AUTO_DETECT_ERROR)
  }

  const parsed = Papa.parse(csvText, { skipEmptyLines: true })
  const rows = parsed.data || []

  for (const row of rows) {
    const cells = (row || []).map(normalizeCell)
    const hasActivity = cells.includes('activity') || cells.includes('event')
    const hasTime = cells.includes('time') || cells.includes('start time') || cells.includes('start')
    if (hasActivity && hasTime) {
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
