import Papa from 'papaparse'
import {
  normalizeHodText,
  parseHodTimeRange,
  parseHodRunGroups,
  extractHodRunGroups,
  resolveDayLabel,
  isMeetingRow,
  isClassroomRow,
  getSpecialOnTrackLabel,
  buildSessionTitle,
  computeRowEnd,
  sortHodGroups
} from './hodMaRules.js'
import { hodMaGroupTaxonomy } from './hod-ma/groupTaxonomy.js'

function findHeaderRow(rows) {
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] || []
    const normalized = row.map(cell => normalizeHodText(cell).toLowerCase())

    const activityIdx = normalized.findIndex(cell => cell === 'activity' || cell === 'event' || cell === 'session')
    const timeIdx = normalized.findIndex(cell => cell === 'time' || cell === 'start time')
    const startIdx = normalized.findIndex(cell => cell === 'start')
    const endIdx = normalized.findIndex(cell => cell === 'end' || cell === 'end time')
    const whoIdx = normalized.findIndex(cell => cell === 'who')
    const whereIdx = normalized.findIndex(cell => (
      cell.startsWith('where') || cell.startsWith('location') || cell.includes('notes')
    ))

    const hasRangeHeader = activityIdx !== -1 && (timeIdx !== -1 || startIdx !== -1)
    const hasSplitHeader = startIdx !== -1 && endIdx !== -1
    if (!hasRangeHeader && !hasSplitHeader) continue

    const resolvedActivityIdx = activityIdx !== -1 ? activityIdx : 0
    const resolvedTimeIdx = timeIdx !== -1 ? timeIdx : startIdx
    const resolvedWhoIdx = whoIdx === -1 ? resolvedActivityIdx + 1 : whoIdx
    const resolvedWhereIdx = whereIdx === -1 ? resolvedActivityIdx + 3 : whereIdx

    return {
      headerIndex: i,
      columns: {
        activityIdx: resolvedActivityIdx,
        timeIdx: resolvedTimeIdx,
        startIdx,
        endIdx,
        timeMode: hasSplitHeader && timeIdx === -1 ? 'split' : 'range',
        whoIdx: resolvedWhoIdx,
        whereIdx: resolvedWhereIdx
      }
    }
  }

  return {
    headerIndex: null,
    columns: {
      activityIdx: 0,
      timeIdx: 1,
      startIdx: 1,
      endIdx: -1,
      timeMode: 'range',
      whoIdx: 2,
      whereIdx: 3
    }
  }
}

function fillDurations(rows) {
  const sorted = [...rows].sort((a, b) => (a.start && b.start ? a.start - b.start : 0))

  sorted.forEach((row, index) => {
    if (row.duration != null) return
    let nextStart = null
    for (let i = index + 1; i < sorted.length; i += 1) {
      if (sorted[i].start && sorted[i].start > row.start) {
        nextStart = sorted[i].start
        break
      }
    }
    if (nextStart) {
      const diff = Math.round((nextStart.getTime() - row.start.getTime()) / 60000)
      row.duration = diff > 0 ? diff : 20
    } else {
      row.duration = 20
    }
  })

  rows.forEach(row => {
    row.end = computeRowEnd(row)
  })
}

function dedupeActivities(activities) {
  const seen = new Set()
  const result = []

  activities.forEach(activity => {
    if (!activity || !activity.start) return
    const key = `${activity.type}|${activity.title}|${activity.day}|${activity.start.toISOString()}`
    if (seen.has(key)) return
    seen.add(key)
    result.push(activity)
  })

  return result
}

function resolveGroupInfo({ whoText, activityText, whereText }) {
  const merged = new Set()
  let isAll = false

  const mergeInfo = info => {
    if (!info) return
    if (info.isAll) isAll = true
    ;(info.groups || []).forEach(group => merged.add(group))
  }

  mergeInfo(parseHodRunGroups(whoText))
  mergeInfo(parseHodRunGroups(activityText))
  mergeInfo(parseHodRunGroups(whereText))

  return { groups: sortHodGroups([...merged]), isAll }
}

export function parseHodMaCsv({ csvText, dayOffset = 0, sourceLabel } = {}) {
  if (typeof csvText !== 'string') {
    throw new Error('CSV text is required to parse schedule.')
  }

  const parsed = Papa.parse(csvText, { skipEmptyLines: true })
  const warnings = (parsed.errors || [])
    .map(err => err?.message)
    .filter(Boolean)

  const rows = parsed.data || []
  const { headerIndex, columns } = findHeaderRow(rows)
  const day = resolveDayLabel({ rows, headerIndex, sourceLabel })

  const rawRows = []
  const startIndex = headerIndex != null ? headerIndex + 1 : 0

  for (let i = startIndex; i < rows.length; i += 1) {
    const row = rows[i] || []
    const activity = normalizeHodText(row[columns.activityIdx])
    let timeText = normalizeHodText(row[columns.timeIdx])
    const who = normalizeHodText(row[columns.whoIdx])
    const where = normalizeHodText(row[columns.whereIdx])

    if (columns.timeMode === 'split') {
      const startText = normalizeHodText(row[columns.startIdx])
      const endText = normalizeHodText(row[columns.endIdx])
      const combined = [startText, endText].filter(Boolean).join(' - ')
      if (combined) {
        timeText = combined
      }
    }

    if (!timeText) continue

    const { start, end, duration } = parseHodTimeRange(timeText, dayOffset)
    if (!start) continue

    rawRows.push({
      activity,
      timeText,
      who,
      where,
      start,
      end,
      duration,
      day
    })
  }

  fillDurations(rawRows)

  const sessions = []

  rawRows.forEach(row => {
    const activityText = row.activity
    const whoText = row.who
    const whereText = row.where

    if (!activityText && !whoText && !whereText) return

    const groupInfo = resolveGroupInfo({ whoText, activityText, whereText })
    const meeting = isMeetingRow(activityText, whoText)
    const classroom = isClassroomRow(activityText, whoText, whereText)
    const specialLabel = getSpecialOnTrackLabel(activityText, whoText, whereText)

    if (meeting || classroom) return

    const sessionTitle = buildSessionTitle({
      activityText,
      whoText,
      groups: groupInfo.groups,
      specialLabel
    })

    sessions.push({
      session: sessionTitle,
      day: row.day || null,
      start: row.start || null,
      duration: row.duration ?? 20,
      end: row.end || null,
      runGroupIds: groupInfo.groups || [],
      note: whereText || '',
      classroom: ''
    })
  })

  const runGroups = extractHodRunGroups(sessions)
  const allRunGroups = runGroups.filter(group => group !== 'All')

  const activities = []

  rawRows.forEach(row => {
    const activityText = row.activity
    const whoText = row.who
    const whereText = row.where

    if (!activityText && !whoText && !whereText) return

    const groupInfo = resolveGroupInfo({ whoText, activityText, whereText })
    const meeting = isMeetingRow(activityText, whoText)
    const classroom = isClassroomRow(activityText, whoText, whereText)

    if (!meeting && !classroom) return

    if (meeting) {
      const relatedRunGroupIds = groupInfo.isAll || groupInfo.groups.length === 0
        ? allRunGroups
        : groupInfo.groups

      activities.push({
        type: 'meeting',
        title: activityText || 'Meeting',
        day: row.day || null,
        start: row.start || null,
        duration: row.duration ?? 0,
        relatedRunGroupIds,
        note: whereText || ''
      })
      return
    }

    if (classroom) {
      activities.push({
        type: 'classroom',
        title: activityText || 'Classroom',
        day: row.day || null,
        start: row.start || null,
        duration: row.duration ?? 0,
        relatedRunGroupIds: ['A - Novice'],
        note: whereText || ''
      })
    }
  })

  const sortedSessions = [...sessions].sort((a, b) => (a.start && b.start ? a.start - b.start : 0))
  const sortedActivities = dedupeActivities(activities).sort((a, b) => (a.start && b.start ? a.start - b.start : 0))

  const normalizedRunGroups = ['All', ...sortHodGroups(runGroups.filter(group => group !== 'All'))]

  return {
    runGroups: normalizedRunGroups,
    sessions: sortedSessions,
    activities: sortedActivities,
    days: [day],
    warnings
  }
}

export const hodMaParser = {
  id: 'hod-ma',
  name: 'HOD-MA',
  parseCsv: parseHodMaCsv,
  groupTaxonomy: hodMaGroupTaxonomy
}
