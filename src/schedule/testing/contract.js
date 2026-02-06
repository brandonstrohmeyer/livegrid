const DAY_ORDER = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime())
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function checkDayOrder(days) {
  const indices = days.map(day => DAY_ORDER.indexOf(day))
  if (indices.some(idx => idx < 0)) return true
  if (indices.length <= 1) return true

  const orderLength = DAY_ORDER.length
  for (let start = 0; start < orderLength; start += 1) {
    let lastPos = -1
    let valid = true
    for (let i = 0; i < indices.length; i += 1) {
      const pos = (indices[i] - start + orderLength) % orderLength
      if (pos < lastPos) {
        valid = false
        break
      }
      lastPos = pos
    }
    if (valid) return true
  }

  return false
}

export function validateScheduleContract(schedule) {
  const errors = []

  if (!schedule || typeof schedule !== 'object') {
    errors.push('Schedule is missing or not an object.')
    return { errors }
  }

  const { runGroups, sessions, activities, days } = schedule

  if (!Array.isArray(runGroups) || runGroups.length === 0) {
    errors.push('runGroups must be a non-empty array.')
  } else if (runGroups[0] !== 'All') {
    errors.push('runGroups must start with "All".')
  }

  if (!Array.isArray(sessions)) {
    errors.push('sessions must be an array.')
  } else {
    sessions.forEach((session, index) => {
      if (!session || typeof session !== 'object') {
        errors.push(`sessions[${index}] is not an object.`)
        return
      }
      if (!isNonEmptyString(session.session)) {
        errors.push(`sessions[${index}] is missing session title.`)
      }
      if (!isNonEmptyString(session.day)) {
        errors.push(`sessions[${index}] is missing day.`)
      }
      if (!isValidDate(session.start)) {
        errors.push(`sessions[${index}] is missing a valid start date.`)
      }
      if (typeof session.duration !== 'number' || Number.isNaN(session.duration)) {
        errors.push(`sessions[${index}] is missing a valid duration.`)
      }
      if (!Array.isArray(session.runGroupIds)) {
        errors.push(`sessions[${index}] is missing runGroupIds.`)
      }
    })
  }

  if (!Array.isArray(activities)) {
    errors.push('activities must be an array.')
  } else {
    activities.forEach((activity, index) => {
      if (!activity || typeof activity !== 'object') {
        errors.push(`activities[${index}] is not an object.`)
        return
      }
      if (!isNonEmptyString(activity.type)) {
        errors.push(`activities[${index}] is missing type.`)
      }
      if (!isNonEmptyString(activity.title)) {
        errors.push(`activities[${index}] is missing title.`)
      }
      if (!isNonEmptyString(activity.day)) {
        errors.push(`activities[${index}] is missing day.`)
      }
      if (!isValidDate(activity.start)) {
        errors.push(`activities[${index}] is missing a valid start date.`)
      }
      if (!Array.isArray(activity.relatedRunGroupIds)) {
        errors.push(`activities[${index}] is missing relatedRunGroupIds.`)
      }
    })
  }

  if (!Array.isArray(days)) {
    errors.push('days must be an array.')
  } else if (sessions && sessions.length > 0 && days.length === 0) {
    errors.push('days must be non-empty when sessions exist.')
  } else {
    const uniqueDays = new Set(days)
    if (uniqueDays.size !== days.length) {
      errors.push('days must not contain duplicates.')
    }
    if (!checkDayOrder(days)) {
      errors.push('days must be ordered consistently.')
    }
  }

  if (Array.isArray(days)) {
    sessions?.forEach((session, index) => {
      if (session?.day && !days.includes(session.day)) {
        errors.push(`sessions[${index}] day "${session.day}" is not present in days.`)
      }
    })
    activities?.forEach((activity, index) => {
      if (activity?.day && !days.includes(activity.day)) {
        errors.push(`activities[${index}] day "${activity.day}" is not present in days.`)
      }
    })
  }

  return { errors }
}
