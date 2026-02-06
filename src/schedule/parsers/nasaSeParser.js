import Papa from 'papaparse'
import { parseTimeToToday, addMinutes, isTimeRow } from '../../scheduleUtils.js'
import {
  fixSessionNameTypos,
  isOnTrackSession,
  deduplicateSessions,
  extractRunGroups,
  extractRunGroupsFromSessionName,
  buildMeetingActivities,
  buildClassroomActivities
} from './nasaSeRules.js'
import { nasaSeGroupTaxonomy } from './nasa-se/groupTaxonomy.js'

const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function normalizeDayLabel(value) {
  const text = (value || '').toString().toLowerCase()
  if (text.includes('monday') || /\bmon\b/.test(text)) return 'Monday'
  if (text.includes('tuesday') || /\btue\b/.test(text)) return 'Tuesday'
  if (text.includes('wednesday') || /\bwed\b/.test(text)) return 'Wednesday'
  if (text.includes('thursday') || /\bthu\b/.test(text) || /\bthur\b/.test(text) || /\bthurs\b/.test(text)) {
    return 'Thursday'
  }
  if (text.includes('friday') || /\bfri\b/.test(text)) return 'Friday'
  if (text.includes('saturday') || /\bsat\b/.test(text)) return 'Saturday'
  if (text.includes('sunday') || /\bsun\b/.test(text)) return 'Sunday'
  return null
}

/**
 * Parse NASA-SE CSV schedule into the normalized schedule model.
 */
export function parseNasaSeCsv({ csvText, dayOffset = 0 }) {
  if (typeof csvText !== 'string') {
    throw new Error('CSV text is required to parse schedule.')
  }

  const parsed = Papa.parse(csvText, { skipEmptyLines: true })
  const warnings = (parsed.errors || [])
    .map(err => err?.message)
    .filter(Boolean)

  const rawRows = []
  let currentDay = null

  parsed.data.forEach(row => {
    const firstCol = (row[0] || '').toString().trim()
    const detectedDay = normalizeDayLabel(firstCol)
    if (detectedDay) currentDay = detectedDay

    if (!isTimeRow(row)) return

    let start = parseTimeToToday(firstCol, dayOffset)
    const duration = row[1] && /\d+/.test(row[1]) ? parseInt(row[1], 10) : null
    const end = start && duration ? addMinutes(start, duration) : null
    const sessionName = fixSessionNameTypos((row[2] || '').toString().trim())
    const note = (row[4] || row[5] || '').toString().trim()
    const classroomCell = (row[3] || '').toString().trim()

    rawRows.push({
      raw: row,
      start,
      duration,
      end,
      session: sessionName,
      note,
      classroomCell,
      day: currentDay
    })
  })

  rawRows.sort((a, b) => (a.start && b.start ? a.start - b.start : 0))

  const days = [...new Set(rawRows.map(r => r.day).filter(Boolean))]
  const orderedDays = DAY_LABELS.filter(day => days.includes(day)).concat(
    days.filter(day => !DAY_LABELS.includes(day))
  )

  const sessions = rawRows
    .filter(isOnTrackSession)
    .map(row => ({
      session: row.session,
      day: row.day || null,
      start: row.start || null,
      duration: row.duration || null,
      end: row.end || null,
      runGroupIds: extractRunGroupsFromSessionName(row.session),
      note: row.note || '',
      classroom: row.classroomCell || ''
    }))

  const dedupedSessions = []
  orderedDays.forEach(day => {
    const daySessions = sessions.filter(session => session.day === day)
    dedupedSessions.push(...deduplicateSessions(daySessions))
  })

  const runGroups = extractRunGroups(dedupedSessions)
  const activities = [
    ...buildMeetingActivities(rawRows, runGroups, dayOffset),
    ...buildClassroomActivities(rawRows)
  ].sort((a, b) => (a.start && b.start ? a.start - b.start : 0))

  return {
    runGroups,
    sessions: dedupedSessions,
    activities,
    days: orderedDays,
    warnings
  }
}

export const nasaSeParser = {
  id: 'nasa-se',
  name: 'NASA-SE',
  parseCsv: parseNasaSeCsv,
  groupTaxonomy: nasaSeGroupTaxonomy
}
