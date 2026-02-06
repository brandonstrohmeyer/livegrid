import { parseTimeToToday } from '../../scheduleUtils.js'

const TT_GROUPS = ['TT Alpha', 'TT Omega']
const RACE_GROUPS = ['Thunder Race', 'Lightning Race']
const TOYOTA_GROUP = 'Toyota GR'
const INSTRUCTOR_CLINIC_GROUP = 'Instructor Clinic'
const HPDE_INTRO_GROUP = 'HPDE-Intro'

/**
 * Apply common typo corrections to session names.
 */
export function fixSessionNameTypos(sessionName) {
  if (!sessionName) return sessionName
  return sessionName.replace(/HDPE/gi, 'HPDE')
}

/**
 * Determine if a session should be displayed as an on-track session.
 */
export function isOnTrackSession(session) {
  return session.session && session.session.trim().length > 0 && session.duration > 0
}

/**
 * Get priority for session deduplication.
 */
export function getSessionPriority(sessionName) {
  if (/Lunch/i.test(sessionName)) return 1
  if (/HPDE\s*\d+/i.test(sessionName)) return 2
  if (/HPDE/i.test(sessionName)) return 3
  if (/TT|Race/i.test(sessionName)) return 4
  return 5
}

/**
 * Deduplicate sessions at the same time, keeping higher priority.
 */
export function deduplicateSessions(sessions) {
  const timeMap = new Map()

  sessions.forEach(session => {
    if (!session.start) return
    const timeKey = session.start.getTime()
    const existing = timeMap.get(timeKey)

    if (!existing) {
      timeMap.set(timeKey, session)
    } else {
      const existingPriority = getSessionPriority(existing.session)
      const newPriority = getSessionPriority(session.session)

      if (newPriority < existingPriority) {
        timeMap.set(timeKey, session)
      }
    }
  })

  return Array.from(timeMap.values()).sort((a, b) => a.start - b.start)
}

/**
 * Check if a session name should be excluded from run group extraction.
 */
export function shouldExcludeFromRunGroups(sessionName) {
  if (!sessionName || /Lunch/i.test(sessionName)) return true
  if (/ALL\s+RACERS\s+WARMUP/i.test(sessionName)) return true
  if (/MEETING/i.test(sessionName)) return true
  if (/Instructors/i.test(sessionName)) return true
  if (/Awards/i.test(sessionName)) return true
  if (/TT\s+ALL/i.test(sessionName)) return true
  if (/TT\s+Drivers/i.test(sessionName)) return true
  return false
}

function normalizeRunGroupName(sessionName) {
  if (!sessionName) return sessionName
  if (/intro\s*\/\s*toyota/i.test(sessionName)) return 'Intro/Toyota'
  if (/toyota/i.test(sessionName)) return TOYOTA_GROUP
  if (/hpde[-\s]*intro/i.test(sessionName)) return HPDE_INTRO_GROUP
  if (/instructor clinic|^ic$/i.test(sessionName.trim())) return INSTRUCTOR_CLINIC_GROUP
  if (sessionName.includes('Thunder')) return 'Thunder Race'
  if (sessionName.includes('Lightning')) return 'Lightning Race'
  if (/tt\s*laps/i.test(sessionName)) return 'TT Alpha'
  if (/^tt\s*group\s*a$/i.test(sessionName)) return 'TT Alpha'
  if (/^tt\s*group\s*b$/i.test(sessionName)) return 'TT Omega'
  if (/tt\s*practice|warmup/i.test(sessionName)) return 'TT Alpha'
  if (/^tt$/i.test(sessionName.trim())) return 'TT Alpha'
  if (/test\s*&\s*tune/i.test(sessionName)) return 'Test/Tune'
  if (/test\s*\/\s*tune/i.test(sessionName)) return 'Test/Tune'
  if (/TT.*Alpha|TTU\/a/i.test(sessionName)) return 'TT Alpha'
  if (/TT.*Omega|TTU\/b/i.test(sessionName)) return 'TT Omega'
  return sessionName
}

/**
 * Extract run group labels from a session name.
 */
export function extractRunGroupsFromSessionName(sessionName) {
  let normalizedName = (sessionName || '').toString().trim()
  if (!normalizedName) return []

  normalizedName = normalizedName.replace(/test\s*&\s*tune/gi, 'Test/Tune')

  if (/mock\s*race|all\s+racers\s+warmup/i.test(normalizedName)) {
    return [...RACE_GROUPS]
  }

  if (/tt\s+all|all\s*time\s*trial|tt\s*practice|tt\s*warmup|^tt$|tt\s*laps/i.test(normalizedName)) {
    return [...TT_GROUPS]
  }

  if (/fun race/i.test(normalizedName)) return [...RACE_GROUPS]

  if (shouldExcludeFromRunGroups(normalizedName)) return []

  const groups = new Set()
  const hpdeMatches = [...normalizedName.matchAll(/HPDE\s*\d+/ig)]

  if (normalizedName.includes('&') && !/TT.*Alpha|TT.*Omega|Thunder|Lightning/i.test(normalizedName)) {
    const parts = normalizedName.split('&').map(p => p.trim()).filter(Boolean)
    let lastPrefix = null
    parts.forEach(part => {
      if (/mock\s*race|all\s+racers\s+warmup/i.test(part)) {
        RACE_GROUPS.forEach(group => groups.add(group))
        return
      }
      if (/tt\s*practice|warmup|^tt$/i.test(part)) {
        TT_GROUPS.forEach(group => groups.add(group))
        return
      }

      const numericOnly = part.match(/^(\d+)\*?$/)
      if (numericOnly && lastPrefix === 'HPDE') {
        groups.add(`HPDE ${numericOnly[1]}`)
        return
      }

      const partHpdeMatches = [...part.matchAll(/HPDE\s*(\d+)/ig)]
      if (partHpdeMatches.length > 0) {
        partHpdeMatches.forEach(match => groups.add(`HPDE ${match[1]}`))
        lastPrefix = 'HPDE'
        return
      }

      if (/^test$/i.test(part)) {
        groups.add('Test/Tune')
        return
      }
      if (/^tune$/i.test(part)) {
        groups.add('Test/Tune')
        return
      }

      const normalizedPart = normalizeRunGroupName(part)
      if (!shouldExcludeFromRunGroups(normalizedPart)) {
        groups.add(normalizedPart)
      }
    })
  } else if (hpdeMatches.length > 0) {
    hpdeMatches.forEach(match => groups.add(match[0].toUpperCase().replace(/\s+/g, ' ')))
  } else {
    groups.add(normalizeRunGroupName(normalizedName))
  }

  return Array.from(groups)
}

/**
 * Extract and normalize run groups from sessions.
 */
export function extractRunGroups(sessions) {
  const groupSet = new Set(['All'])

  sessions.forEach(session => {
    const sessionName = session.session || ''
    const sessionGroups = extractRunGroupsFromSessionName(sessionName)
    sessionGroups.forEach(group => groupSet.add(group))
  })

  const groups = Array.from(groupSet)
  return ['All', ...groups.slice(1).sort((a, b) => a.localeCompare(b))]
}

function extractLeadingTime(text) {
  if (!text) return null
  const match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)?/)
  if (!match) return null
  const hours = match[1]
  const minutes = match[2] || '00'
  const ampm = match[3] ? match[3].toUpperCase() : ''
  return `${hours}:${minutes}${ampm ? ` ${ampm}` : ''}`.trim()
}

function dedupeActivities(activities) {
  const seen = new Set()
  const result = []
  activities.forEach(activity => {
    if (!activity || !activity.start) return
    const key = `${activity.type}|${activity.title}|${activity.day || ''}|${activity.start.toISOString()}`
    if (seen.has(key)) return
    seen.add(key)
    result.push(activity)
  })
  return result
}

/**
 * Build meeting activities (HPDE, TT Drivers, All Racers).
 */
export function buildMeetingActivities(rows, runGroups, dayOffset = 0) {
  const hpdeGroups = runGroups.filter(g => /^HPDE/i.test(g))
  const ttGroups = runGroups.filter(g => TT_GROUPS.includes(g))
  const raceGroups = runGroups.filter(g => RACE_GROUPS.includes(g))
  const activities = []

  rows.forEach(row => {
    const sessionText = (row.session || '').toString()
    const noteText = (row.note || '').toString()
    const noteTime = extractLeadingTime(noteText)
    const sessionTime = extractLeadingTime(sessionText)
    const timeStr = noteTime || sessionTime || null
    const start = timeStr ? parseTimeToToday(timeStr, dayOffset) : row.start

    if (/hpde meeting/i.test(sessionText)) {
      if (hpdeGroups.length === 0 || !start) return
      activities.push({
        type: 'meeting',
        title: 'HPDE Meeting',
        day: row.day || null,
        start,
        duration: row.duration || null,
        relatedRunGroupIds: hpdeGroups,
        note: noteText || ''
      })
      return
    }

    if (/tt drivers/i.test(noteText) || /tt drivers/i.test(sessionText)) {
      if (ttGroups.length === 0 || !start) return
      activities.push({
        type: 'meeting',
        title: 'TT Drivers Meeting',
        day: row.day || null,
        start,
        duration: row.duration || null,
        relatedRunGroupIds: ttGroups,
        note: noteText || ''
      })
      return
    }

    if (/all racers meeting/i.test(noteText) || /all racers meeting/i.test(sessionText)) {
      if (raceGroups.length === 0 || !start) return
      activities.push({
        type: 'meeting',
        title: 'All Racers Meeting',
        day: row.day || null,
        start,
        duration: row.duration || null,
        relatedRunGroupIds: raceGroups,
        note: noteText || ''
      })
    }
  })

  return dedupeActivities(activities)
}

/**
 * Build classroom activities from classroom column data.
 */
export function buildClassroomActivities(rows) {
  const activities = []

  rows.forEach(row => {
    const classroomCell = (row.classroomCell || '').toString().trim()
    if (!classroomCell) return
    if (!row.start) return

    const relatedRunGroupIds = extractRunGroupsFromSessionName(classroomCell)
    if (relatedRunGroupIds.length === 0) return

    activities.push({
      type: 'classroom',
      title: `Classroom: ${classroomCell}`,
      day: row.day || null,
      start: row.start,
      duration: row.duration || null,
      relatedRunGroupIds,
      note: row.note || ''
    })
  })

  return dedupeActivities(activities)
}
