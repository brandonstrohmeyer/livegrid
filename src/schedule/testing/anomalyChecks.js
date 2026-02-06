function includesMeetingText(text) {
  if (!text) return false
  return /meeting/i.test(text)
}

function shouldSkipOverride(overrides, code, group) {
  if (!overrides) return false
  if (overrides.allowAllAnomalies) return true
  if (code === 'NO_CLASSROOM' && overrides.allowNoClassroom) return true
  if (code === 'NO_MEETINGS' && overrides.allowNoMeetings) return true
  if (code === 'EMPTY_SESSIONS' && overrides.allowEmptySessions) return true
  if (code === 'UNKNOWN_RUN_GROUP' && overrides.allowUnknownRunGroups) return true
  if (code === 'SINGLE_SESSION_GROUP') {
    if (overrides.allowSingleSessionGroup) return true
    if (Array.isArray(overrides.allowSingleSessionGroups)) {
      return overrides.allowSingleSessionGroups.includes(group)
    }
  }
  return false
}

function buildWarning(code, message, details = {}) {
  return { code, message, ...details }
}

export function runAnomalyChecks({ schedule, taxonomy, overrides = {} }) {
  const warnings = []
  if (!schedule) return warnings

  const activities = schedule.activities || []
  const sessions = schedule.sessions || []
  const runGroups = schedule.runGroups || []

  const classroomActivities = activities.filter(activity => activity.type === 'classroom')
  if (classroomActivities.length === 0 && !shouldSkipOverride(overrides, 'NO_CLASSROOM')) {
    warnings.push(buildWarning('NO_CLASSROOM', 'No classroom activities were detected.'))
  }

  const meetingActivities = activities.filter(activity => activity.type === 'meeting')
  const hasMeetingNotes = sessions.some(session =>
    includesMeetingText(session.note) || includesMeetingText(session.session)
  )
  if (hasMeetingNotes && meetingActivities.length === 0 && !shouldSkipOverride(overrides, 'NO_MEETINGS')) {
    warnings.push(buildWarning('NO_MEETINGS', 'Meeting notes exist but no meeting activities were detected.'))
  }

  if (schedule.days && schedule.days.length > 0 && sessions.length === 0 && !shouldSkipOverride(overrides, 'EMPTY_SESSIONS')) {
    warnings.push(buildWarning('EMPTY_SESSIONS', 'Days exist but no sessions were parsed.'))
  }

  const expectedPatterns = taxonomy?.expectedRunGroupPatterns || []
  if (expectedPatterns.length > 0) {
    runGroups
      .filter(group => group !== 'All')
      .forEach(group => {
        const matches = expectedPatterns.some(pattern => pattern.test(group))
        if (!matches && !shouldSkipOverride(overrides, 'UNKNOWN_RUN_GROUP', group)) {
          warnings.push(buildWarning('UNKNOWN_RUN_GROUP', `Unexpected run group label "${group}".`, { group }))
        }
      })
  }

  const groupCounts = new Map()
  runGroups
    .filter(group => group !== 'All')
    .forEach(group => groupCounts.set(group, 0))

  sessions.forEach(session => {
    const groups = Array.isArray(session.runGroupIds) ? session.runGroupIds : []
    groups.forEach(group => {
      if (!groupCounts.has(group)) groupCounts.set(group, 0)
      groupCounts.set(group, groupCounts.get(group) + 1)
    })
  })

  groupCounts.forEach((count, group) => {
    if (count === 1 && !shouldSkipOverride(overrides, 'SINGLE_SESSION_GROUP', group)) {
      warnings.push(buildWarning('SINGLE_SESSION_GROUP', `Run group "${group}" appears only once.`, { group }))
    }
  })

  return warnings
}
