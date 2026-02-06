/**
 * Generic schedule parsing utilities (organization-agnostic)
 */

// ============================================================================
// TIME UTILITIES - Date and time parsing and formatting
// ============================================================================

/**
 * Parse time string like "8:30 AM" to today's date with that time
 * If AM/PM is not specified, uses smart defaults: 12:xx is PM (noon), otherwise assumes based on context
 */
export function parseTimeToToday(timeStr, dayOffset = 0) {
  if (!timeStr) return null
  const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)?/i)
  if (!match) return null
  
  let [, hours, minutes, ampm] = match
  hours = parseInt(hours)
  minutes = parseInt(minutes)
  
  // If AM/PM is specified, use it
  if (ampm) {
    if (ampm.toUpperCase() === 'PM' && hours !== 12) hours += 12
    if (ampm.toUpperCase() === 'AM' && hours === 12) hours = 0
  } else {
    // No AM/PM specified: smart defaults for meeting times
    // 12:xx without AM/PM is noon (PM)
    // Times before 8 AM are assumed to be PM (like 1:00 = 1:00 PM)
    // Times 8:00 - 11:59 are assumed to be AM
    if (hours === 12) {
      hours = 12 // noon
    } else if (hours >= 8 && hours < 12) {
      // 8:00 - 11:59 assumed AM (no change needed)
    } else if (hours < 8) {
      // 1:00 - 7:59 assumed PM
      hours += 12
    }
    // hours >= 13 are already in 24-hour format, no change needed
  }
  
  const date = new Date()
  date.setHours(hours, minutes, 0, 0)
  
  if (dayOffset !== 0) {
    date.setTime(date.getTime() + dayOffset * 86400000)
  }
  
  return date
}

/**
 * Add minutes to a date
 */
export function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000)
}

/**
 * Check if a CSV row represents a time-based entry
 */
export function isTimeRow(row) {
  if (!row || row.length === 0) return false
  const firstCol = (row[0] || '').toString().trim()
  return /\d{1,2}(:\d{2})?\s*(AM|PM|am|pm)?/.test(firstCol)
}
